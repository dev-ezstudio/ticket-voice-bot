/**
 * lib/voice/guards.js — ตัวตรวจสิทธิ์ของ "ระบบห้องเสียง"
 *
 * ทุกปุ่มบนแผงควบคุมต้องผ่านด่านเดียวกัน: ผู้ใช้อยู่ในห้องเสียงชั่วคราวไหม
 * และเป็นเจ้าของห้องนั้นไหม แยกมาไว้ที่นี่เพื่อไม่ให้ทุกปุ่มเขียนเช็คซ้ำกัน
 *
 * สำคัญ: ต้องเรียกทุกครั้งที่กดปุ่ม (ไม่ใช่แค่ครั้งแรก) เพราะระหว่างที่
 * modal หรือเมนูเลือกคนเปิดอยู่ ห้องอาจถูกลบ หรือเจ้าของอาจเปลี่ยนไปแล้ว
 *
 * ข้อความทั้งหมดดึงจาก messages.json ผ่าน M.t()
 */

const repo = require('./repo');
const M = require('../messages');

/**
 * หาห้องเสียงชั่วคราวที่ผู้ใช้กำลังอยู่ พร้อมตรวจสิทธิ์
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} [options]
 * @param {boolean} [options.requireOwner=true] ต้องเป็นเจ้าของห้องไหม (ปุ่ม "ยึดห้อง" ตั้ง false)
 * @returns {Promise<{ok: true, channel: import('discord.js').VoiceChannel, record: object}
 *                 | {ok: false, reason: string}>}
 */
async function requireOwnedTempChannel(interaction, options = {}) {
  const { requireOwner = true } = options;

  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  // ชื่อห้อง creator ใช้ในข้อความหลายที่ ดึงมาครั้งเดียว
  const creatorChannelName = M.t('voice.setup.creatorChannelName');

  if (!voiceChannel) {
    return { ok: false, reason: M.t('voice.replies.notInVoice', { creatorChannelName }) };
  }

  let record;
  try {
    record = await repo.getTempChannel(voiceChannel.id);
  } catch (err) {
    return { ok: false, reason: err.userMessage ?? M.t('common.dbError') };
  }

  if (!record) {
    return { ok: false, reason: M.t('voice.replies.notTempChannel', { creatorChannelName }) };
  }

  if (requireOwner && record.ownerId !== member.id) {
    return {
      ok: false,
      reason: M.t('voice.replies.ownerOnly', { ownerMention: `<@${record.ownerId}>` }),
    };
  }

  return { ok: true, channel: voiceChannel, record };
}

/**
 * ตรวจว่าเจ้าของห้องยังอยู่ในห้องหรือไม่ — ใช้กับปุ่ม "ยึดห้อง"
 * @param {import('discord.js').VoiceChannel} channel
 * @param {string} ownerId
 * @returns {boolean} true = เจ้าของยังอยู่ (ยึดห้องไม่ได้)
 */
function isOwnerStillInChannel(channel, ownerId) {
  return channel.members.has(ownerId);
}

module.exports = { requireOwnedTempChannel, isOwnerStillInChannel };
