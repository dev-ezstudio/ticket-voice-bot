/**
 * lib/voice/ui.js — embed ของ "ระบบห้องเสียงชั่วคราว"
 *
 * ข้อความทั้งหมดดึงจาก messages.json ผ่าน M.t() — แก้ข้อความได้โดยไม่ต้องแตะไฟล์นี้
 * แยกจาก lib/ticket/ui.js ชัดเจน แก้หน้าตาระบบหนึ่งไม่กระทบอีกระบบ
 */

const { EmbedBuilder } = require('discord.js');

const M = require('../messages');
const { COLORS } = require('../reply');
const { discordTime, humanDuration } = require('../discordUtils');

/**
 * embed คู่มือที่โพสต์ไว้ในห้องข้อความของ category ห้องเสียง
 * @param {import('discord.js').VoiceChannel} creatorChannel
 */
function guideEmbed(creatorChannel) {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(M.t('voice.guide.title'))
    .setDescription(M.t('voice.guide.description', { creatorChannel: String(creatorChannel) }))
    .addFields(
      {
        name: M.t('voice.guide.fieldSettingsName'),
        value: M.t('voice.guide.fieldSettingsValue'),
        inline: false,
      },
      {
        name: M.t('voice.guide.fieldMembersName'),
        value: M.t('voice.guide.fieldMembersValue'),
        inline: false,
      },
      {
        name: M.t('voice.guide.fieldOwnerName'),
        value: M.t('voice.guide.fieldOwnerValue'),
        inline: false,
      },
      {
        name: M.t('voice.guide.fieldSummonName'),
        value: M.t('voice.guide.fieldSummonValue'),
        inline: false,
      },
    )
    .setFooter({ text: M.t('voice.guide.footer') });
}

/**
 * embed ต้อนรับแบบไม่มีปุ่ม
 * ปัจจุบันห้องที่สร้างใหม่ใช้แผงควบคุมจาก lib/voice/panel.js แทน
 * เก็บฟังก์ชันนี้ไว้เผื่อต้องการ embed เปล่าๆ ที่ไม่มีปุ่ม
 * @param {import('discord.js').GuildMember} owner
 */
function newRoomEmbed(owner) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(M.t('voice.newRoom.title'))
    .setDescription(M.t('voice.newRoom.description', { ownerMention: `<@${owner.id}>` }))
    .setThumbnail(owner.displayAvatarURL())
    .setFooter({ text: M.t('voice.newRoom.footer') })
    .setTimestamp();
}

/**
 * embed แสดงข้อมูลห้อง (ปุ่ม "ดูข้อมูลห้อง")
 * @param {import('discord.js').VoiceChannel} channel
 * @param {object} record ข้อมูลห้องจากฐานข้อมูล
 * @param {string[]} blockedIds รายการ user id ที่ถูกบล็อก
 */
function infoEmbed(channel, record, blockedIds = []) {
  const memberList = [...channel.members.values()]
    .map((m) => (m.id === record.ownerId ? `👑 ${m}` : `• ${m}`))
    .join('\n');

  const blockedList =
    blockedIds.length > 0
      ? blockedIds.map((id) => `• <@${id}>`).join('\n')
      : M.t('voice.info.noBlocked');

  const unknown = M.t('voice.info.unknown');

  return new EmbedBuilder()
    .setColor(record.isLocked ? COLORS.warning : COLORS.info)
    .setTitle(`🔊 ${channel.name}`)
    .addFields(
      { name: M.t('voice.info.fieldOwner'), value: `<@${record.ownerId}>`, inline: true },
      {
        name: M.t('voice.info.fieldStatus'),
        value: record.isLocked
          ? M.t('voice.info.statusLocked')
          : M.t('voice.info.statusUnlocked'),
        inline: true,
      },
      {
        name: M.t('voice.info.fieldMemberCount'),
        value:
          record.userLimit > 0
            ? M.t('voice.info.limitSet', { count: channel.members.size, limit: record.userLimit })
            : M.t('voice.info.limitUnlimited', { count: channel.members.size }),
        inline: true,
      },
      {
        name: M.t('voice.info.fieldCreatedAt'),
        value: record.createdAt ? discordTime(record.createdAt, 'R') : unknown,
        inline: true,
      },
      {
        name: M.t('voice.info.fieldAge'),
        value: record.createdAt ? humanDuration(record.createdAt) : unknown,
        inline: true,
      },
      {
        name: M.t('voice.info.fieldChannelId'),
        value: `\`${channel.id}\``,
        inline: true,
      },
      {
        name: M.t('voice.info.fieldMembers', { count: channel.members.size }),
        value: memberList || M.t('voice.info.noMembers'),
        inline: false,
      },
      {
        name: M.t('voice.info.fieldBlocked', { count: blockedIds.length }),
        value: blockedList,
        inline: false,
      },
    )
    .setFooter({ text: M.t('voice.info.footer') })
    .setTimestamp();
}

module.exports = { guideEmbed, newRoomEmbed, infoEmbed };
