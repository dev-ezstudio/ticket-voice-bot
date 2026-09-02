/**
 * lib/ticket/ui.js — embed และปุ่มทั้งหมดของ "ระบบตั๋ว"
 *
 * ข้อความทั้งหมดดึงจาก messages.json ผ่าน M.t() — แก้ข้อความได้โดยไม่ต้องแตะไฟล์นี้
 * customId ของทุกปุ่มขึ้นต้นด้วย "ticket:" เพื่อไม่ให้ชนกับระบบห้องเสียง ("voice:")
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const M = require('../messages');
const { COLORS } = require('../reply');
const { discordTime, humanDuration } = require('../discordUtils');

/** customId ของทุกปุ่มในระบบตั๋ว */
const IDS = {
  OPEN: 'ticket:open',
  CLAIM: 'ticket:claim',
  CLOSE: 'ticket:close',
  CLOSE_CONFIRM: 'ticket:close:confirm',
  CLOSE_CANCEL: 'ticket:close:cancel',
};

/** แปลงชื่อสีใน messages.json เป็นค่าสีจริง */
function resolveColor(name, fallback) {
  return COLORS[String(name ?? '').toLowerCase()] ?? fallback;
}

// ---------------------------------------------------------------------
// panel (embed ที่วางไว้ในห้องสาธารณะ)
// ---------------------------------------------------------------------

/**
 * embed panel สำหรับกดเปิดตั๋ว
 * @param {import('discord.js').Guild} guild
 */
function panelEmbed(guild) {
  return new EmbedBuilder()
    .setColor(resolveColor(M.raw('ticket.panel.color'), COLORS.info))
    .setTitle(M.t('ticket.panel.title'))
    .setDescription(M.t('ticket.panel.description'))
    .setFooter({
      text: M.t('ticket.panel.footer', { guildName: guild?.name ?? '' }),
      iconURL: guild?.iconURL() ?? undefined,
    });
}

/** ปุ่ม "เปิดตั๋ว" — อยู่คู่กับ panelEmbed */
function panelRow() {
  const button = new ButtonBuilder()
    .setCustomId(IDS.OPEN)
    .setLabel(M.t('ticket.panel.buttonLabel'))
    .setStyle(ButtonStyle.Primary);

  const emoji = M.t('ticket.panel.buttonEmoji');
  if (emoji) button.setEmoji(emoji);

  return new ActionRowBuilder().addComponents(button);
}

// ---------------------------------------------------------------------
// ห้องตั๋ว (embed ต้อนรับ)
// ---------------------------------------------------------------------

/**
 * embed ต้อนรับในห้องตั๋ว — สะท้อนสถานะปัจจุบันของตั๋ว
 * เรียกซ้ำได้เมื่อสถานะเปลี่ยน (เช่นมีคนกดรับเรื่อง) แล้วเอาไป editMessage
 *
 * @param {object} ticket ข้อมูลตั๋วจากฐานข้อมูล
 * @param {object} opts
 * @param {import('discord.js').User} [opts.opener] ผู้เปิดตั๋ว
 * @param {string} opts.staffRoleId
 */
function welcomeEmbed(ticket, { opener, staffRoleId } = {}) {
  const claimed = Boolean(ticket.claimedBy);
  const userMention = `<@${opener?.id ?? ticket.userId}>`;

  const embed = new EmbedBuilder()
    .setColor(claimed ? COLORS.success : COLORS.info)
    .setTitle(M.t('ticket.welcome.title', { ticketNumber: ticket.ticketNumber ?? '-' }))
    .setDescription(
      M.t('ticket.welcome.description', {
        userMention,
        staffRoleMention: `<@&${staffRoleId}>`,
      }),
    )
    .addFields(
      {
        name: M.t('ticket.welcome.fieldOpener'),
        value: `<@${ticket.userId}>`,
        inline: true,
      },
      {
        name: M.t('ticket.welcome.fieldStatus'),
        value: claimed
          ? M.t('ticket.welcome.statusClaimed', { staffMention: `<@${ticket.claimedBy}>` })
          : M.t('ticket.welcome.statusWaiting'),
        inline: true,
      },
      {
        name: M.t('ticket.welcome.fieldOpenedAt'),
        value: ticket.createdAt ? discordTime(ticket.createdAt, 'R') : 'เมื่อสักครู่',
        inline: true,
      },
    )
    .setFooter({ text: M.t('ticket.welcome.footer') })
    .setTimestamp();

  if (opener) {
    embed.setAuthor({
      name: opener.tag ?? opener.username ?? 'ผู้ใช้',
      iconURL: opener.displayAvatarURL?.() ?? undefined,
    });
  }

  return embed;
}

/**
 * ปุ่มในห้องตั๋ว — ปุ่มรับเรื่องเปลี่ยนข้อความตามสถานะ
 * @param {object} ticket
 */
function ticketRow(ticket) {
  const claimed = Boolean(ticket.claimedBy);

  const claimButton = new ButtonBuilder()
    .setCustomId(IDS.CLAIM)
    .setLabel(
      claimed ? M.t('ticket.welcome.buttonUnclaimLabel') : M.t('ticket.welcome.buttonClaimLabel'),
    )
    .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Success);

  const claimEmoji = claimed
    ? M.t('ticket.welcome.buttonUnclaimEmoji')
    : M.t('ticket.welcome.buttonClaimEmoji');
  if (claimEmoji) claimButton.setEmoji(claimEmoji);

  const closeButton = new ButtonBuilder()
    .setCustomId(IDS.CLOSE)
    .setLabel(M.t('ticket.welcome.buttonCloseLabel'))
    .setStyle(ButtonStyle.Danger);

  const closeEmoji = M.t('ticket.welcome.buttonCloseEmoji');
  if (closeEmoji) closeButton.setEmoji(closeEmoji);

  return new ActionRowBuilder().addComponents(claimButton, closeButton);
}

// ---------------------------------------------------------------------
// ยืนยันการปิดตั๋ว
// ---------------------------------------------------------------------

/** embed ถามยืนยันก่อนปิดตั๋ว */
function closeConfirmEmbed(ticket) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(M.t('ticket.closeConfirm.title'))
    .setDescription(
      M.t('ticket.closeConfirm.description', { ticketNumber: ticket.ticketNumber ?? '-' }),
    )
    .setFooter({ text: M.t('ticket.closeConfirm.footer') });
}

/** ปุ่มยืนยัน / ยกเลิกการปิดตั๋ว */
function closeConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.CLOSE_CONFIRM)
      .setLabel(M.t('ticket.closeConfirm.buttonConfirmLabel'))
      .setEmoji('✅')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(IDS.CLOSE_CANCEL)
      .setLabel(M.t('ticket.closeConfirm.buttonCancelLabel'))
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** embed แจ้งว่ากำลังปิดตั๋ว แสดงในห้องก่อนลบ */
function closingEmbed(closedBy) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(M.t('ticket.closing.title'))
    .setDescription(
      M.t('ticket.closing.description', {
        closedByMention: `<@${closedBy.id}>`,
        seconds: M.num('ticket.closing.deleteDelaySeconds', { min: 1, max: 60 }),
      }),
    )
    .setTimestamp();
}

/**
 * embed สรุปตั๋วที่ปิดแล้ว
 *
 * ⚠️ ไม่ได้ใช้งานแล้ว — เดิมใช้ส่ง DM ให้ผู้เปิดตั๋วพร้อมไฟล์ transcript
 * แต่ transcript มีบทสนทนาที่ทีมงานคุยกันด้วย จึงเปลี่ยนไปส่งเฉพาะห้องแอดมินใหญ่
 * (ดู archiveEmbed) เก็บฟังก์ชันนี้ไว้เผื่ออนาคตต้องการแจ้งผู้เปิดตั๋วแบบไม่แนบไฟล์
 *
 * @param {object} ticket ข้อมูลตั๋วหลังปิด
 * @param {import('discord.js').Guild} guild
 */
function closedSummaryEmbed(ticket, guild, { messageCount = 0 } = {}) {
  const unknown = M.t('ticket.closedSummary.unknown');

  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(M.t('ticket.closedSummary.title', { ticketNumber: ticket.ticketNumber ?? '-' }))
    .setDescription(
      M.t('ticket.closedSummary.description', { guildName: guild?.name ?? unknown }),
    )
    .addFields(
      {
        name: M.t('ticket.closedSummary.fieldClaimedBy'),
        value: ticket.claimedBy
          ? `<@${ticket.claimedBy}>`
          : M.t('ticket.closedSummary.noClaimer'),
        inline: true,
      },
      {
        name: M.t('ticket.closedSummary.fieldClosedBy'),
        value: ticket.closedBy ? `<@${ticket.closedBy}>` : unknown,
        inline: true,
      },
      {
        name: M.t('ticket.closedSummary.fieldDuration'),
        value:
          ticket.createdAt && ticket.closedAt
            ? humanDuration(ticket.createdAt, ticket.closedAt)
            : unknown,
        inline: true,
      },
      {
        name: M.t('ticket.closedSummary.fieldMessageCount'),
        value: M.t('ticket.closedSummary.messageCountValue', { count: messageCount }),
        inline: true,
      },
    )
    .setTimestamp();

  if (guild?.iconURL()) embed.setThumbnail(guild.iconURL());

  return embed;
}

/**
 * embed เก็บบันทึกตั๋วในห้องแผงควบคุม (ให้ทีมงานย้อนดู)
 * @param {object} ticket
 * @param {import('discord.js').User} closedBy
 * @param {number} messageCount
 */
function archiveEmbed(ticket, closedBy, messageCount) {
  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(M.t('ticket.archive.title', { ticketNumber: ticket.ticketNumber ?? '-' }))
    .setDescription(
      M.t('ticket.archive.description', {
        userMention: `<@${ticket.userId}>`,
        claimedBy: ticket.claimedBy
          ? `<@${ticket.claimedBy}>`
          : M.t('ticket.closedSummary.noClaimer'),
        closedByMention: `<@${closedBy.id}>`,
        duration:
          ticket.createdAt && ticket.closedAt
            ? humanDuration(ticket.createdAt, ticket.closedAt)
            : M.t('ticket.closedSummary.unknown'),
        messageCount,
      }),
    )
    .setFooter({ text: M.t('ticket.archive.footer') })
    .setTimestamp();
}

module.exports = {
  IDS,
  panelEmbed,
  panelRow,
  welcomeEmbed,
  ticketRow,
  closeConfirmEmbed,
  closeConfirmRow,
  closingEmbed,
  closedSummaryEmbed,
  archiveEmbed,
};
