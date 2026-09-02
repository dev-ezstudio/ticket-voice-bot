/**
 * lib/reply.js — ตัวช่วยตอบ interaction ที่ใช้ร่วมกันทั้ง 2 ระบบ
 *
 * ปัญหาที่แก้: interaction ของ Discord ตอบได้ครั้งเดียว ถ้าเผลอ reply ซ้ำจะได้
 * error "InteractionAlreadyReplied" ซึ่งทำให้ handler พังกลางทาง
 * ฟังก์ชันในไฟล์นี้เลือกวิธีตอบให้ถูกอัตโนมัติ (reply / editReply / followUp)
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');

/** โทนสีที่ใช้ทั่วบอท */
const COLORS = {
  success: 0x57f287,
  error: 0xed4245,
  warning: 0xfee75c,
  info: 0x5865f2,
  neutral: 0x2b2d31,
};

/**
 * ตอบ interaction แบบปลอดภัย เลือกวิธีตอบให้ถูกตามสถานะของ interaction
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').InteractionReplyOptions} payload
 */
async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred) return await interaction.editReply(payload);
    if (interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (err) {
    // 10062 = Unknown interaction (หมดอายุ 15 นาที หรือถูกตอบไปแล้ว)
    // 40060 = Interaction has already been acknowledged
    if (err.code === 10062 || err.code === 40060) {
      console.warn(`⚠️  ตอบ interaction ไม่ทัน (code ${err.code}) — ข้ามไป`);
      return null;
    }
    throw err;
  }
}

/** ตอบข้อความสำเร็จ (สีเขียว) — ปกติเป็น ephemeral เห็นคนเดียว */
function ok(interaction, description, { title = null, ephemeral = true, ...rest } = {}) {
  const embed = new EmbedBuilder().setColor(COLORS.success).setDescription(`✅ ${description}`);
  if (title) embed.setTitle(title);
  return safeReply(interaction, {
    embeds: [embed],
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    ...rest,
  });
}

/** ตอบข้อความผิดพลาด (สีแดง) */
function fail(interaction, description, { title = null, ephemeral = true, ...rest } = {}) {
  const text = String(description).startsWith('❌') ? String(description) : `❌ ${description}`;
  const embed = new EmbedBuilder().setColor(COLORS.error).setDescription(text);
  if (title) embed.setTitle(title);
  return safeReply(interaction, {
    embeds: [embed],
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    ...rest,
  });
}

/** ตอบข้อความเตือน (สีเหลือง) */
function warn(interaction, description, { ephemeral = true, ...rest } = {}) {
  const embed = new EmbedBuilder().setColor(COLORS.warning).setDescription(`⚠️ ${description}`);
  return safeReply(interaction, {
    embeds: [embed],
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    ...rest,
  });
}

/** ตอบข้อความข้อมูลทั่วไป (สีน้ำเงิน) */
function info(interaction, description, { title = null, ephemeral = true, ...rest } = {}) {
  const embed = new EmbedBuilder().setColor(COLORS.info).setDescription(description);
  if (title) embed.setTitle(title);
  return safeReply(interaction, {
    embeds: [embed],
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    ...rest,
  });
}

module.exports = { COLORS, safeReply, ok, fail, warn, info };
