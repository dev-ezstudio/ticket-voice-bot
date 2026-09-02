/**
 * commands/ticket/ticket-stats.js — /ticket-stats (Admin เท่านั้น)
 *
 * แสดงสถิติของระบบตั๋ว: จำนวนทั้งหมด / เปิดอยู่ / ปิดแล้ว
 * และอันดับ staff ที่รับเรื่องเยอะสุด
 */

const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const repo = require('../../lib/ticket/repo');
const { COLORS, fail, safeReply } = require('../../lib/reply');
const { discordTime } = require('../../lib/discordUtils');
const { DatabaseError } = require('../../supabase');

/** เหรียญรางวัลตามอันดับ */
const MEDALS = ['🥇', '🥈', '🥉'];

/** แปลงนาทีเป็นข้อความไทยอ่านง่าย */
function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return 'ยังไม่มีข้อมูล';
  if (minutes < 60) return `${minutes} นาที`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours < 24) return rest > 0 ? `${hours} ชั่วโมง ${rest} นาที` : `${hours} ชั่วโมง`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} วัน ${restHours} ชั่วโมง` : `${days} วัน`;
}

/** สร้างแถบ progress bar ด้วยอักขระบล็อก */
function progressBar(value, total, width = 12) {
  if (!total) return '─'.repeat(width);
  const filled = Math.round((value / total) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

module.exports = {
  system: 'ticket',

  data: new SlashCommandBuilder()
    .setName('ticket-stats')
    .setDescription('ดูสถิติระบบตั๋วสนับสนุนของเซิร์ฟเวอร์นี้')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) return fail(interaction, 'คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์เท่านั้น');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ----- โหลดข้อมูล -----
    let settings;
    let stats;

    try {
      [settings, stats] = await Promise.all([
        repo.getSettings(guild.id),
        repo.getStats(guild.id),
      ]);
    } catch (err) {
      console.error('❌ [ticket-stats] โหลดสถิติไม่สำเร็จ:', err);
      return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
    }

    if (!settings) {
      return fail(
        interaction,
        'เซิร์ฟเวอร์นี้ยังไม่ได้ตั้งค่าระบบตั๋ว\nใช้คำสั่ง `/setup-ticket` เพื่อตั้งค่าก่อน',
      );
    }

    if (stats.total === 0) {
      return safeReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.neutral)
            .setTitle('📊 สถิติระบบตั๋ว')
            .setDescription(
              'ยังไม่มีตั๋วในเซิร์ฟเวอร์นี้\n\n' +
                `ผู้ใช้เปิดตั๋วได้จาก <#${settings.panelChannelId}> โดยกดปุ่ม **📩 เปิดตั๋ว**`,
            )
            .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined }),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ----- อันดับ staff -----
    const rankingLines = stats.claimedRanking.slice(0, 10).map((entry, index) => {
      const medal = MEDALS[index] ?? `\`${String(index + 1).padStart(2, ' ')}.\``;
      const percent = Math.round((entry.count / stats.total) * 100);
      return `${medal} <@${entry.staffId}> — **${entry.count}** ใบ (${percent}%)`;
    });

    const topStaff = stats.claimedRanking[0];

    // ----- ตั๋วล่าสุด -----
    const recentLines = stats.recentTickets.map((t) => {
      const icon = t.status === 'open' ? '🟢' : '⚪';
      const claim = t.claimedBy ? `<@${t.claimedBy}>` : '_ยังไม่มีผู้รับ_';
      return `${icon} **#${t.ticketNumber ?? '-'}** <@${t.userId}> · ${claim} · ${discordTime(t.createdAt, 'R')}`;
    });

    const closedPercent = stats.total > 0 ? Math.round((stats.closed / stats.total) * 100) : 0;

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('📊 สถิติระบบตั๋วสนับสนุน')
      .setDescription(
        `สรุปข้อมูลตั๋วทั้งหมดของ **${guild.name}**\n` +
          `\`\`\`\nทั้งหมด   ${String(stats.total).padStart(4)} ใบ\n` +
          `เปิดอยู่   ${String(stats.open).padStart(4)} ใบ  ${progressBar(stats.open, stats.total)}\n` +
          `ปิดแล้ว    ${String(stats.closed).padStart(4)} ใบ  ${progressBar(stats.closed, stats.total)}\n\`\`\``,
      )
      .addFields(
        { name: '🎫 ตั๋วทั้งหมด', value: `**${stats.total}** ใบ`, inline: true },
        { name: '🟢 เปิดอยู่', value: `**${stats.open}** ใบ`, inline: true },
        { name: '⚪ ปิดแล้ว', value: `**${stats.closed}** ใบ (${closedPercent}%)`, inline: true },
        {
          name: '⏳ รอทีมงานรับเรื่อง',
          value: stats.unclaimedOpen > 0 ? `⚠️ **${stats.unclaimedOpen}** ใบ` : '✅ ไม่มีตั๋วค้าง',
          inline: true,
        },
        {
          name: '⏱️ เวลาจัดการเฉลี่ย',
          value: formatMinutes(stats.avgHandleMinutes),
          inline: true,
        },
        {
          name: '🏆 ทีมงานอันดับ 1',
          value: topStaff ? `<@${topStaff.staffId}> (${topStaff.count} ใบ)` : 'ยังไม่มีข้อมูล',
          inline: true,
        },
        {
          name: `🙋 อันดับทีมงานที่รับเรื่อง (${stats.claimedRanking.length} คน)`,
          value:
            rankingLines.length > 0
              ? rankingLines.join('\n')
              : '_ยังไม่มีทีมงานคนไหนกดรับเรื่อง_',
          inline: false,
        },
        {
          name: '🕒 ตั๋ว 5 ใบล่าสุด',
          value: recentLines.length > 0 ? recentLines.join('\n') : '_ไม่มีข้อมูล_',
          inline: false,
        },
      )
      .setFooter({
        text: `${guild.name} • เลขตั๋วล่าสุด #${settings.ticketCounter}`,
        iconURL: guild.iconURL() ?? undefined,
      })
      .setTimestamp();

    return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
