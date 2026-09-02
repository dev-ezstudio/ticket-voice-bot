/**
 * events/ticket/panelButtons.js — ปุ่มบนหน้าทีมงานและหน้าแอดมินใหญ่
 *
 * แยกจาก events/ticket/interactionCreate.js เพราะไฟล์นั้นดูแลปุ่มใน "ห้องตั๋ว"
 * (เปิด/รับเรื่อง/ปิด) ส่วนไฟล์นี้ดูแลปุ่มบน "แผงควบคุม" ที่วางในห้องสาธารณะ
 *
 * ทุกปุ่มตอบแบบ ephemeral (เห็นคนเดียว) เพื่อไม่ให้ห้องแผงควบคุมรกด้วยผลลัพธ์
 *
 * ปุ่มหน้าทีมงาน (ต้องเป็น staff):
 *   ticket:staff:openlist  -> ตั๋วที่รอรับเรื่อง
 *   ticket:staff:oldest    -> รับเรื่องใบที่รอนานสุด (แบบกันแย่ง)
 *   ticket:staff:mine      -> ตั๋วที่ฉันรับอยู่
 *   ticket:staff:mystats   -> สถิติของฉัน
 *
 * ปุ่มหน้าแอดมินใหญ่ (ต้องเป็น admin):
 *   ticket:admin:stats     -> สถิติรวม
 *   ticket:admin:all       -> ตั๋วที่เปิดอยู่ทั้งหมด
 *   ticket:admin:board     -> อันดับทีมงาน
 *   ticket:admin:settings  -> ดูการตั้งค่าระบบ
 *   ticket:admin:cleanup   -> เก็บกวาดตั๋วค้าง (ห้องถูกลบแต่สถานะยัง open)
 */

const { Events, MessageFlags } = require('discord.js');

const repo = require('../../lib/ticket/repo');
const panels = require('../../lib/ticket/panels');
const ui = require('../../lib/ticket/ui');
const M = require('../../lib/messages');
const { isStaff, isAdmin, denyMessage } = require('../../lib/ticket/guards');
const { ok, fail, safeReply, COLORS } = require('../../lib/reply');
const { fetchChannelSafe, fetchMemberSafe, isGone } = require('../../lib/discordUtils');
const { DatabaseError } = require('../../supabase');

/** กัน race: guild ที่กำลังเก็บกวาดอยู่ */
const cleaning = new Set();

/** แปลง error เป็นข้อความไทย */
function describeError(err) {
  if (err instanceof DatabaseError) return err.userMessage;
  if (isGone(err)) return M.t('common.goneError');
  return M.t('common.unexpectedError', { message: err.message });
}

// =====================================================================
//  ปุ่มหน้าทีมงาน
// =====================================================================

/** ตั๋วที่รอรับเรื่อง */
async function staffOpenList(interaction, { guild }) {
  const tickets = await repo.listUnclaimedTickets(guild.id);

  return safeReply(interaction, {
    embeds: [
      panels.ticketListEmbed(M.t('ticket.panelReplies.openListTitle'), tickets, {
        showClaimer: false,
        emptyText: M.t('ticket.panelReplies.openListEmpty'),
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

/** รับเรื่องใบที่รอนานสุด */
async function staffClaimOldest(interaction, { guild, settings }) {
  const tickets = await repo.listUnclaimedTickets(guild.id);

  if (tickets.length === 0) {
    return fail(interaction, M.t('ticket.panelReplies.noWaitingTicket'));
  }

  // ไล่จากใบเก่าสุด — เผื่อใบแรกถูกคนอื่นแย่งไปพอดี ก็ลองใบถัดไป
  for (const candidate of tickets) {
    const channel = await fetchChannelSafe(guild, candidate.channelId);

    // ห้องถูกลบไปแล้ว แต่ฐานข้อมูลยัง open -> ปิดให้แล้วข้ามไปใบถัดไป
    if (!channel) {
      await repo
        .closeTicket(candidate.channelId, {
          closedBy: null,
          reason: 'ห้องถูกลบด้วยมือ ระบบปิดให้ตอนทีมงานกดรับเรื่อง',
        })
        .catch(() => {});
      continue;
    }

    // รับเรื่องแบบ atomic — ถ้าคนอื่นรับไปก่อนจะได้ null
    const claimed = await repo.claimTicketIfUnclaimed(candidate.channelId, interaction.user.id);

    if (!claimed) continue; // มีคนแย่งไปแล้ว ลองใบถัดไป

    // อัปเดต embed ในห้องตั๋วให้แสดงว่ามีคนรับแล้ว
    try {
      const opener = await fetchMemberSafe(guild, claimed.userId);
      const pinned = await channel.messages.fetchPinned().catch(() => null);

      const welcomeMsg = pinned?.find(
        (m) =>
          m.author.id === interaction.client.user.id &&
          m.components?.some((row) =>
            row.components?.some((c) => String(c.customId ?? '') === ui.IDS.CLAIM),
          ),
      );

      if (welcomeMsg) {
        await welcomeMsg.edit({
          embeds: [
            ui.welcomeEmbed(claimed, { opener: opener?.user, staffRoleId: settings.staffRoleId }),
          ],
          components: [ui.ticketRow(claimed)],
        });
      }
    } catch (err) {
      if (!isGone(err)) console.warn(`⚠️  [panel] อัปเดต embed ในห้องตั๋วไม่สำเร็จ: ${err.message}`);
    }

    // แจ้งในห้องตั๋วให้ผู้เปิดตั๋วรู้
    await channel
      .send({
        embeds: [
          {
            color: COLORS.success,
            description: M.t('ticket.claim.claimed', {
              staffMention: `<@${interaction.user.id}>`,
            }),
          },
        ],
      })
      .catch(() => {});

    return ok(
      interaction,
      M.t('ticket.panelReplies.claimedOldest', {
        ticketNumber: claimed.ticketNumber ?? '-',
        channelMention: `<#${claimed.channelId}>`,
      }),
    );
  }

  return fail(interaction, M.t('ticket.panelReplies.allTaken'));
}

/** ตั๋วที่ฉันรับเรื่องอยู่ */
async function staffMyTickets(interaction, { guild }) {
  const tickets = await repo.listTicketsClaimedBy(guild.id, interaction.user.id);

  return safeReply(interaction, {
    embeds: [
      panels.ticketListEmbed(M.t('ticket.panelReplies.myTicketsTitle'), tickets, {
        showClaimer: false,
        emptyText: M.t('ticket.panelReplies.myTicketsEmpty'),
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

/** สถิติของฉัน */
async function staffMyStats(interaction, { guild }) {
  const stats = await repo.getStats(guild.id);

  return safeReply(interaction, {
    embeds: [panels.myStatsEmbed(interaction.user, stats)],
    flags: MessageFlags.Ephemeral,
  });
}

// =====================================================================
//  ปุ่มหน้าแอดมินใหญ่
// =====================================================================

/** สถิติรวม */
async function adminStats(interaction, { guild, settings }) {
  const stats = await repo.getStats(guild.id);

  return safeReply(interaction, {
    embeds: [panels.superPanelEmbed(guild, stats, settings)],
    flags: MessageFlags.Ephemeral,
  });
}

/** ตั๋วที่เปิดอยู่ทั้งหมด */
async function adminAllTickets(interaction, { guild }) {
  const tickets = await repo.listOpenTickets(guild.id);

  // เรียงเก่าไปใหม่ ให้ใบที่ค้างนานสุดอยู่บนสุด
  tickets.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return safeReply(interaction, {
    embeds: [
      panels.ticketListEmbed(M.t('ticket.panelReplies.allTicketsTitle'), tickets, {
        emptyText: M.t('ticket.panelReplies.allTicketsEmpty'),
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

/** อันดับทีมงาน */
async function adminStaffBoard(interaction, { guild }) {
  const stats = await repo.getStats(guild.id);

  return safeReply(interaction, {
    embeds: [panels.staffBoardEmbed(stats)],
    flags: MessageFlags.Ephemeral,
  });
}

/** ดูการตั้งค่าระบบ */
async function adminSettings(interaction, { guild, settings }) {
  return safeReply(interaction, {
    embeds: [panels.settingsEmbed(settings, guild)],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * เก็บกวาดตั๋วค้าง — ตั๋วที่สถานะ open แต่ห้องถูกลบไปแล้ว
 *
 * ทำไมต้องมีปุ่มนี้: unique index กัน 1 คน 1 ตั๋วเปิด ถ้าห้องถูกลบตอนบอทออฟไลน์
 * คนนั้นจะเปิดตั๋วใหม่ไม่ได้จนกว่าจะมีการเก็บกวาด
 * (ปกติบอทเก็บกวาดเองตอนเริ่มทำงาน ปุ่มนี้ให้แอดมินสั่งได้ทันทีไม่ต้องรีสตาร์ท)
 */
async function adminCleanup(interaction, { guild }) {
  if (cleaning.has(guild.id)) {
    return fail(interaction, M.t('ticket.panelReplies.cleanupBusy'));
  }

  cleaning.add(guild.id);

  try {
    const tickets = await repo.listOpenTickets(guild.id);

    let cleaned = 0;
    let alive = 0;
    const failedIds = [];

    for (const ticket of tickets) {
      const channel = await fetchChannelSafe(guild, ticket.channelId);

      if (channel) {
        alive += 1;
        continue;
      }

      try {
        await repo.closeTicket(ticket.channelId, {
          closedBy: interaction.user.id,
          reason: 'ห้องถูกลบไปแล้ว แอดมินสั่งเก็บกวาดจากแผงควบคุม',
        });
        cleaned += 1;
      } catch (err) {
        console.error(`❌ [panel cleanup] ปิดตั๋ว ${ticket.channelId} ไม่สำเร็จ: ${err.message}`);
        failedIds.push(ticket.ticketNumber ?? ticket.channelId);
      }
    }

    const lines = [
      `**ตรวจตั๋วที่เปิดอยู่** ${tickets.length} ใบ`,
      `**ห้องยังอยู่** ${alive} ใบ (ไม่แตะ)`,
      `**ปิดตั๋วค้างให้** ${cleaned} ใบ`,
    ];

    if (failedIds.length > 0) {
      lines.push(`⚠️ **ปิดไม่สำเร็จ** ${failedIds.length} ใบ: ${failedIds.join(', ')}`);
    }

    if (cleaned === 0 && failedIds.length === 0) {
      return ok(
        interaction,
        `${M.t('ticket.panelReplies.cleanupNothing')}\n\n${lines.join('\n')}`,
      );
    }

    return ok(interaction, `${M.t('ticket.panelReplies.cleanupDone')}\n\n${lines.join('\n')}`);
  } finally {
    cleaning.delete(guild.id);
  }
}

// =====================================================================
//  ตารางปุ่ม
// =====================================================================

const HANDLERS = {
  // หน้าทีมงาน
  [panels.IDS.STAFF_OPEN_LIST]: { run: staffOpenList, level: 'staff' },
  [panels.IDS.STAFF_CLAIM_OLDEST]: { run: staffClaimOldest, level: 'staff' },
  [panels.IDS.STAFF_MY_TICKETS]: { run: staffMyTickets, level: 'staff' },
  [panels.IDS.STAFF_MY_STATS]: { run: staffMyStats, level: 'staff' },

  // หน้าแอดมินใหญ่
  [panels.IDS.ADMIN_STATS]: { run: adminStats, level: 'admin' },
  [panels.IDS.ADMIN_ALL_TICKETS]: { run: adminAllTickets, level: 'admin' },
  [panels.IDS.ADMIN_STAFF_BOARD]: { run: adminStaffBoard, level: 'admin' },
  [panels.IDS.ADMIN_SETTINGS]: { run: adminSettings, level: 'admin' },
  [panels.IDS.ADMIN_CLEANUP]: { run: adminCleanup, level: 'admin' },
};

module.exports = {
  name: Events.InteractionCreate,
  system: 'ticket',

  /**
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(interaction) {
    if (!interaction.isButton()) return;

    const entry = HANDLERS[interaction.customId];
    if (!entry) return; // ไม่ใช่ปุ่มของแผงควบคุม ปล่อยให้ handler อื่นจัดการ

    if (!interaction.guild) return fail(interaction, M.t('common.buttonGuildOnly'));

    try {
      // ----- โหลดการตั้งค่า -----
      let settings;
      try {
        settings = await repo.getSettings(interaction.guild.id);
      } catch (err) {
        return fail(interaction, describeError(err));
      }

      if (!settings) {
        return fail(interaction, M.t('ticket.replies.notSetup'));
      }

      // ----- ตรวจสิทธิ์ -----
      const allowed =
        entry.level === 'admin'
          ? isAdmin(interaction.member, settings)
          : isStaff(interaction.member, settings);

      if (!allowed) {
        return fail(interaction, denyMessage(entry.level, settings));
      }

      // ----- ทำงาน -----
      // งานที่ยิง query หลายครั้งอาจใช้เวลาเกิน 3 วินาที ต้อง defer ก่อน
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      await entry.run(interaction, { guild: interaction.guild, settings });
    } catch (err) {
      console.error(`❌ [ticket panel] ปุ่ม ${interaction.customId} ผิดพลาด:`, err);
      await fail(interaction, describeError(err)).catch(() => {});
    }
  },
};
