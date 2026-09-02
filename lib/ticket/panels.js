/**
 * lib/ticket/panels.js — แผงควบคุม 3 หน้าของระบบตั๋ว
 *
 * แบ่งตามคนดู เพื่อให้แต่ละกลุ่มเห็นแต่ปุ่มที่ตัวเองใช้:
 *
 *   1. หน้าเปิดตั๋ว (user)    — ทุกคนเห็น มีปุ่มเดียว: เปิดตั๋ว
 *   2. หน้าทีมงาน (staff)     — staff เห็น: ดูตั๋วค้าง / ตั๋วของฉัน / รับเรื่องใบเก่าสุด / สถิติฉัน
 *   3. หน้าแอดมินใหญ่ (admin) — แอดมินเห็น: สถิติรวม / ตั๋วทั้งหมด / ดูการตั้งค่า / เก็บกวาด
 *
 * หน้า 1 อยู่ที่ lib/ticket/ui.js (panelEmbed / panelRow) เพราะใช้ตอนเปิดตั๋วด้วย
 * ไฟล์นี้ดูแลหน้า 2 และ 3
 *
 * ข้อความทั้งหมดดึงจาก messages.json ผ่าน M.t() — แก้ได้โดยไม่ต้องแตะไฟล์นี้
 * customId ทุกตัวขึ้นต้นด้วย "ticket:" เพื่อให้ handler ของระบบตั๋วรับไป
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const M = require('../messages');
const { COLORS } = require('../reply');
const { discordTime } = require('../discordUtils');

/** customId ของปุ่มบนหน้าทีมงานและหน้าแอดมิน */
const IDS = {
  // ---- หน้าทีมงาน ----
  STAFF_OPEN_LIST: 'ticket:staff:openlist',   // ดูตั๋วที่ยังไม่มีคนรับ
  STAFF_MY_TICKETS: 'ticket:staff:mine',      // ตั๋วที่ฉันรับเรื่องอยู่
  STAFF_CLAIM_OLDEST: 'ticket:staff:oldest',  // รับเรื่องใบที่รอนานสุด
  STAFF_MY_STATS: 'ticket:staff:mystats',     // สถิติของฉัน

  // ---- หน้าแอดมินใหญ่ ----
  ADMIN_STATS: 'ticket:admin:stats',          // สถิติรวมทั้งเซิร์ฟเวอร์
  ADMIN_ALL_TICKETS: 'ticket:admin:all',      // ตั๋วที่เปิดอยู่ทั้งหมด
  ADMIN_SETTINGS: 'ticket:admin:settings',    // ดูการตั้งค่าระบบ
  ADMIN_STAFF_BOARD: 'ticket:admin:board',    // อันดับทีมงาน
  ADMIN_CLEANUP: 'ticket:admin:cleanup',      // เก็บกวาดตั๋วค้าง
};

/** เหรียญรางวัลตามอันดับ */
const MEDALS = ['🥇', '🥈', '🥉'];

// =====================================================================
//  หน้า 2 — แผงควบคุมทีมงาน
// =====================================================================

/**
 * embed หน้าทีมงาน
 * @param {import('discord.js').Guild} guild
 * @param {object} stats สถิติจาก repo.getStats()
 * @param {string} staffRoleId
 */
function staffPanelEmbed(guild, stats, staffRoleId) {
  const waiting = stats.unclaimedOpen;

  const status = waiting > 0
    ? M.t('ticket.staffPanel.hasWaiting', { count: waiting })
    : M.t('ticket.staffPanel.noWaiting');

  return new EmbedBuilder()
    .setColor(waiting > 0 ? COLORS.warning : COLORS.success)
    .setTitle(M.t('ticket.staffPanel.title'))
    .setDescription(
      `${M.t('ticket.staffPanel.description', { staffRoleMention: `<@&${staffRoleId}>` })}\n\n${status}`,
    )
    .addFields(
      { name: M.t('ticket.staffPanel.fieldOpen'), value: `**${stats.open}** ใบ`, inline: true },
      {
        name: M.t('ticket.staffPanel.fieldWaiting'),
        value: waiting > 0 ? `⚠️ **${waiting}** ใบ` : M.t('ticket.staffPanel.valueNone'),
        inline: true,
      },
      { name: M.t('ticket.staffPanel.fieldClosed'), value: `**${stats.closed}** ใบ`, inline: true },
    )
    .setFooter({
      text: M.t('ticket.staffPanel.footer', { guildName: guild.name }),
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTimestamp();
}

/** ปุ่มหน้าทีมงาน */
function staffPanelRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(IDS.STAFF_OPEN_LIST)
        .setLabel(M.t('ticket.staffPanel.buttonOpenList'))
        .setEmoji('📋')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(IDS.STAFF_CLAIM_OLDEST)
        .setLabel(M.t('ticket.staffPanel.buttonClaimOldest'))
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(IDS.STAFF_MY_TICKETS)
        .setLabel(M.t('ticket.staffPanel.buttonMyTickets'))
        .setEmoji('🙋')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(IDS.STAFF_MY_STATS)
        .setLabel(M.t('ticket.staffPanel.buttonMyStats'))
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// =====================================================================
//  หน้า 3 — แผงควบคุมแอดมินใหญ่
// =====================================================================

/**
 * embed หน้าแอดมินใหญ่
 * @param {import('discord.js').Guild} guild
 * @param {object} stats
 * @param {object} settings
 */
function superPanelEmbed(guild, stats, settings) {
  const closedPercent = stats.total > 0 ? Math.round((stats.closed / stats.total) * 100) : 0;

  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(M.t('ticket.superPanel.title'))
    .setDescription(M.t('ticket.superPanel.description'))
    .addFields(
      { name: M.t('ticket.superPanel.fieldTotal'), value: `**${stats.total}** ใบ`, inline: true },
      { name: M.t('ticket.superPanel.fieldOpen'), value: `**${stats.open}** ใบ`, inline: true },
      {
        name: M.t('ticket.superPanel.fieldClosed'),
        value: `**${stats.closed}** ใบ (${closedPercent}%)`,
        inline: true,
      },
      {
        name: M.t('ticket.superPanel.fieldWaiting'),
        value: stats.unclaimedOpen > 0
          ? `⚠️ **${stats.unclaimedOpen}** ใบ`
          : M.t('ticket.staffPanel.valueNone'),
        inline: true,
      },
      {
        name: M.t('ticket.superPanel.fieldStaffCount'),
        value: `**${stats.claimedRanking.length}** คน`,
        inline: true,
      },
      {
        name: M.t('ticket.superPanel.fieldCounter'),
        value: `#${settings?.ticketCounter ?? 0}`,
        inline: true,
      },
    )
    .setFooter({
      text: M.t('ticket.superPanel.footer', { guildName: guild.name }),
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTimestamp();
}

/** ปุ่มหน้าแอดมินใหญ่ */
function superPanelRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(IDS.ADMIN_STATS)
        .setLabel(M.t('ticket.superPanel.buttonStats'))
        .setEmoji('📊')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(IDS.ADMIN_ALL_TICKETS)
        .setLabel(M.t('ticket.superPanel.buttonAllTickets'))
        .setEmoji('📂')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(IDS.ADMIN_STAFF_BOARD)
        .setLabel(M.t('ticket.superPanel.buttonStaffBoard'))
        .setEmoji('🏆')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(IDS.ADMIN_SETTINGS)
        .setLabel(M.t('ticket.superPanel.buttonSettings'))
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(IDS.ADMIN_CLEANUP)
        .setLabel(M.t('ticket.superPanel.buttonCleanup'))
        .setEmoji('🧹')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

// =====================================================================
//  embed ผลลัพธ์ที่ปุ่มต่างๆ ตอบกลับ (ephemeral เห็นคนเดียว)
// =====================================================================

/**
 * รายการตั๋ว — ใช้ทั้งหน้าทีมงานและหน้าแอดมิน
 * @param {string} title
 * @param {Array} tickets
 * @param {object} [opts]
 * @param {boolean} [opts.showClaimer=true] แสดงว่าใครรับเรื่อง
 * @param {string} [opts.emptyText]
 */
function ticketListEmbed(title, tickets, opts = {}) {
  const { showClaimer = true, emptyText = M.t('ticket.panelReplies.listEmpty') } = opts;

  // Discord จำกัด description 4096 ตัว — ตัดที่ 20 ใบเพื่อความปลอดภัย
  const MAX = 20;
  const shown = tickets.slice(0, MAX);

  const lines = shown.map((t) => {
    const claim = !showClaimer
      ? ''
      : t.claimedBy
        ? ` · 🙋 <@${t.claimedBy}>`
        : ` · ${M.t('ticket.panelReplies.noClaimer')}`;

    return (
      `**#${t.ticketNumber ?? '-'}** <#${t.channelId}> · <@${t.userId}>${claim}\n` +
      `└ เปิด ${discordTime(t.createdAt, 'R')}`
    );
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(title)
    .setDescription(lines.length > 0 ? lines.join('\n\n') : emptyText)
    .setTimestamp();

  if (tickets.length > MAX) {
    embed.setFooter({ text: `แสดง ${MAX} จาก ${tickets.length} ใบ (เรียงจากเก่าไปใหม่)` });
  } else if (tickets.length > 0) {
    embed.setFooter({ text: `ทั้งหมด ${tickets.length} ใบ` });
  }

  return embed;
}

/**
 * สถิติของ staff คนหนึ่ง
 * @param {import('discord.js').User} user
 * @param {object} stats
 */
function myStatsEmbed(user, stats) {
  const mine = stats.claimedRanking.find((r) => r.staffId === user.id);
  const count = mine?.count ?? 0;
  const rank = stats.claimedRanking.findIndex((r) => r.staffId === user.id) + 1;
  const percent = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;

  return new EmbedBuilder()
    .setColor(count > 0 ? COLORS.success : COLORS.neutral)
    .setTitle(M.t('ticket.panelReplies.myStatsTitle'))
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .addFields(
      {
        name: M.t('ticket.panelReplies.myStatsClaimed'),
        value: `**${count}** ใบ`,
        inline: true,
      },
      {
        name: M.t('ticket.panelReplies.myStatsRank'),
        value: rank > 0
          ? `${MEDALS[rank - 1] ?? ''} อันดับ **${rank}** จาก ${stats.claimedRanking.length} คน`
          : M.t('ticket.panelReplies.myStatsNoRank'),
        inline: true,
      },
      {
        name: M.t('ticket.panelReplies.myStatsShare'),
        value: `${percent}% ของตั๋วทั้งหมด`,
        inline: true,
      },
    )
    .setFooter({
      text: count === 0
        ? M.t('ticket.panelReplies.myStatsFooterNone')
        : M.t('ticket.panelReplies.myStatsFooter'),
    })
    .setTimestamp();
}

/**
 * อันดับทีมงาน
 * @param {object} stats
 */
function staffBoardEmbed(stats) {
  const lines = stats.claimedRanking.slice(0, 15).map((entry, i) => {
    const medal = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
    const percent = stats.total > 0 ? Math.round((entry.count / stats.total) * 100) : 0;
    return `${medal} <@${entry.staffId}> — **${entry.count}** ใบ (${percent}%)`;
  });

  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(M.t('ticket.panelReplies.boardTitle'))
    .setDescription(
      lines.length > 0 ? lines.join('\n') : M.t('ticket.panelReplies.boardEmpty'),
    )
    .setFooter({ text: `ทีมงานที่ทำงาน ${stats.claimedRanking.length} คน` })
    .setTimestamp();
}

/**
 * แสดงการตั้งค่าระบบตั๋วปัจจุบัน
 * @param {object} settings
 * @param {import('discord.js').Guild} guild
 */
function settingsEmbed(settings, guild) {
  const notSet = M.t('ticket.panelReplies.notSet');
  const ch = (id) => (id ? `<#${id}>` : notSet);

  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(M.t('ticket.panelReplies.settingsTitle'))
    .setDescription(M.t('ticket.panelReplies.settingsDescription'))
    .addFields(
      {
        name: M.t('ticket.panelReplies.settingsFieldPanel1'),
        value: ch(settings.panelChannelId),
        inline: true,
      },
      {
        name: M.t('ticket.panelReplies.settingsFieldPanel2'),
        value: ch(settings.adminPanelChannelId),
        inline: true,
      },
      {
        name: M.t('ticket.panelReplies.settingsFieldPanel3'),
        value: ch(settings.superPanelChannelId),
        inline: true,
      },
      { name: M.t('ticket.panelReplies.settingsFieldCategory'), value: ch(settings.categoryId), inline: true },
      {
        name: M.t('ticket.panelReplies.settingsFieldStaffRole'),
        value: settings.staffRoleId ? `<@&${settings.staffRoleId}>` : notSet,
        inline: true,
      },
      {
        name: M.t('ticket.panelReplies.settingsFieldAdminRole'),
        value: settings.adminRoleId
          ? `<@&${settings.adminRoleId}>`
          : M.t('ticket.panelReplies.adminRoleFallback'),
        inline: true,
      },
      { name: M.t('ticket.panelReplies.settingsFieldCounter'), value: `#${settings.ticketCounter}`, inline: true },
      {
        name: M.t('ticket.panelReplies.settingsFieldCreatedAt'),
        value: settings.createdAt ? discordTime(settings.createdAt, 'f') : notSet,
        inline: true,
      },
      {
        name: M.t('ticket.panelReplies.settingsFieldUpdatedAt'),
        value: settings.updatedAt ? discordTime(settings.updatedAt, 'R') : notSet,
        inline: true,
      },
    )
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();
}

module.exports = {
  IDS,
  staffPanelEmbed,
  staffPanelRows,
  superPanelEmbed,
  superPanelRows,
  ticketListEmbed,
  myStatsEmbed,
  staffBoardEmbed,
  settingsEmbed,
};
