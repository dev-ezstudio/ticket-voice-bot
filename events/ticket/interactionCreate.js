/**
 * events/ticket/interactionCreate.js — ปุ่มทั้งหมดของ "ระบบตั๋ว"
 *
 * ไฟล์นี้จัดการเฉพาะ customId ที่ขึ้นต้นด้วย "ticket:" เท่านั้น
 * ปุ่มของระบบห้องเสียงอยู่แยกที่ events/voice/ (ปัจจุบันระบบห้องเสียงใช้ slash command ล้วน)
 *
 * ปุ่มที่ดูแล:
 *   ticket:open          -> สร้างห้องตั๋วใหม่
 *   ticket:claim         -> staff กดรับเรื่อง / ยกเลิกการรับเรื่อง
 *   ticket:close         -> ขอยืนยันก่อนปิด
 *   ticket:close:confirm -> ปิดจริง (transcript + ลบห้อง)
 *   ticket:close:cancel  -> ยกเลิกการปิด
 */

const {
  ChannelType,
  Events,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const repo = require('../../lib/ticket/repo');
const ui = require('../../lib/ticket/ui');
const { buildTranscript } = require('../../lib/ticket/transcript');
const { fail, ok, warn, safeReply, COLORS } = require('../../lib/reply');
const {
  fetchChannelSafe,
  fetchMemberSafe,
  deleteChannelSafe,
  sanitizeChannelName,
  isGone,
  isPermissionError,
  checkBotChannelPermissions,
} = require('../../lib/discordUtils');
const M = require('../../lib/messages');
const guards = require('../../lib/ticket/guards');
const { DatabaseError } = require('../../supabase');

/** กัน race: เก็บ user id ที่กำลังเปิดตั๋วอยู่ กันกดปุ่มรัวๆ ได้หลายห้อง */
const opening = new Set();

/** กัน race: เก็บ channel id ที่กำลังปิดอยู่ กันปิดซ้อน */
const closing = new Set();

/** ทำชื่อห้องตั๋วจาก username */
function ticketChannelName(user, ticketNumber) {
  // Discord ยอมให้ชื่อห้องเป็นภาษาไทยได้ แต่ตัวพิมพ์ใหญ่จะถูกแปลงเป็นเล็กอัตโนมัติ
  const base = (user.username ?? 'user')
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙_-]/g, '')
    .slice(0, 20);

  const safe = base.length > 0 ? base : 'user';
  return sanitizeChannelName(
    M.t('ticket.channelName', { username: safe, ticketNumber }),
    `ticket-${ticketNumber}`,
  );
}

// =====================================================================
//  ticket:open — เปิดตั๋วใหม่
// =====================================================================

async function handleOpen(interaction) {
  const { guild, user } = interaction;

  if (!guild) return fail(interaction, M.t('common.buttonGuildOnly'));

  // กันกดปุ่มรัวๆ — ถ้าคนเดิมกำลังเปิดอยู่ให้ปฏิเสธทันที
  if (opening.has(`${guild.id}:${user.id}`)) {
    return fail(interaction, 'บอทกำลังสร้างห้องตั๋วให้คุณอยู่ กรุณารอสักครู่');
  }

  opening.add(`${guild.id}:${user.id}`);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ----- โหลดการตั้งค่า -----
    let settings;
    try {
      settings = await repo.getSettings(guild.id);
    } catch (err) {
      console.error('❌ [ticket:open] โหลดการตั้งค่าไม่สำเร็จ:', err);
      return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
    }

    if (!settings) {
      return fail(interaction, M.t('ticket.replies.notSetup'));
    }

    // ----- เช็คว่ามีตั๋วเปิดค้างอยู่แล้วไหม -----
    let existing;
    try {
      existing = await repo.getOpenTicketByUser(guild.id, user.id);
    } catch (err) {
      console.error('❌ [ticket:open] ตรวจสอบตั๋วเดิมไม่สำเร็จ:', err);
      return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
    }

    if (existing) {
      const existingChannel = await fetchChannelSafe(guild, existing.channelId);

      if (existingChannel) {
        return fail(
          interaction,
          M.t('ticket.replies.alreadyOpen', { channelMention: String(existingChannel) }),
        );
      }

      // ห้องถูกลบไปด้วยมือแต่ฐานข้อมูลยังบอกว่า open -> ปิดในฐานข้อมูลแล้วเปิดใหม่ได้
      console.warn(`⚠️  [ticket:open] ตั๋ว ${existing.channelId} ไม่มีห้องจริงแล้ว ปิดในฐานข้อมูลให้`);
      try {
        await repo.closeTicket(existing.channelId, {
          closedBy: null,
          reason: 'ห้องถูกลบด้วยมือ ระบบปิดให้อัตโนมัติ',
        });
      } catch (err) {
        console.error('❌ [ticket:open] ปิดตั๋วค้างไม่สำเร็จ:', err);
        return fail(
          interaction,
          'พบตั๋วค้างในระบบที่ห้องถูกลบไปแล้ว แต่บอทแก้ไขฐานข้อมูลไม่ได้\nกรุณาลองใหม่อีกครั้ง',
        );
      }
    }

    // ----- ตรวจ category -----
    const category = await fetchChannelSafe(guild, settings.categoryId);

    if (!category || category.type !== ChannelType.GuildCategory) {
      return fail(
        interaction,
        'หมวดห้องตั๋วที่ตั้งไว้ถูกลบไปแล้ว\nกรุณาแจ้งผู้ดูแลให้ตั้งค่าใหม่ด้วย `/setup-ticket`',
      );
    }

    const childCount = guild.channels.cache.filter((ch) => ch.parentId === category.id).size;

    if (childCount >= 50) {
      return fail(
        interaction,
        'หมวดห้องตั๋วมีห้องครบ 50 ห้องแล้ว (ขีดจำกัดของ Discord)\n' +
          'กรุณาแจ้งผู้ดูแลให้ปิดตั๋วเก่าหรือย้ายหมวดใหม่',
      );
    }

    const catPerms = checkBotChannelPermissions(category, ['ViewChannel', 'ManageChannels']);
    if (!catPerms.ok) {
      return fail(
        interaction,
        'บอทไม่มีสิทธิ์สร้างห้องในหมวดห้องตั๋ว\nกรุณาแจ้งผู้ดูแลให้เปิดสิทธิ์ **จัดการห้อง** ให้บอทในหมวดนั้น',
      );
    }

    // ----- ตรวจยศ staff -----
    const staffRole = guild.roles.cache.get(settings.staffRoleId)
      ?? await guild.roles.fetch(settings.staffRoleId).catch(() => null);

    if (!staffRole) {
      return fail(
        interaction,
        'ยศทีมงานที่ตั้งไว้ถูกลบไปแล้ว\nกรุณาแจ้งผู้ดูแลให้ตั้งค่าใหม่ด้วย `/setup-ticket`',
      );
    }

    // ----- ขอเลขตั๋ว -----
    let ticketNumber;
    try {
      ticketNumber = await repo.nextTicketNumber(guild.id);
    } catch (err) {
      console.error('❌ [ticket:open] ขอเลขตั๋วไม่สำเร็จ:', err);
      return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
    }

    if (ticketNumber === null) {
      return fail(
        interaction,
        'ระบบตั๋วยังไม่ได้ตั้งค่าครบถ้วน\nกรุณาแจ้งผู้ดูแลให้ใช้คำสั่ง `/setup-ticket` อีกครั้ง',
      );
    }

    // ----- สร้างห้อง -----
    let channel;

    try {
      channel = await guild.channels.create({
        name: ticketChannelName(user, ticketNumber),
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `ตั๋ว #${ticketNumber} | ผู้เปิด: ${user.tag} (${user.id})`,
        reason: `เปิดตั๋ว #${ticketNumber} โดย ${user.tag}`,
        permissionOverwrites: [
          {
            // ซ่อนจากทุกคน
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            // ผู้เปิดตั๋วเห็นและคุยได้
            id: user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AddReactions,
            ],
          },
          {
            // ทีมงานเห็นและคุยได้
            id: staffRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AddReactions,
              PermissionFlagsBits.ManageMessages,
            ],
          },
          {
            // บอทต้องเห็นห้องตัวเองเพื่ออ่านประวัติทำ transcript
            id: guild.members.me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ],
      });
    } catch (err) {
      console.error('❌ [ticket:open] สร้างห้องไม่สำเร็จ:', err);

      if (isPermissionError(err)) {
        return fail(
          interaction,
          'บอทสร้างห้องตั๋วไม่ได้เพราะสิทธิ์ไม่พอ\n' +
            'กรุณาแจ้งผู้ดูแลให้เปิดสิทธิ์ **จัดการห้อง (Manage Channels)** และ **จัดการยศ (Manage Roles)** ให้บอท',
        );
      }

      return fail(interaction, `สร้างห้องตั๋วไม่สำเร็จ: ${err.message}`);
    }

    // ----- บันทึกลงฐานข้อมูล -----
    let ticket;

    try {
      ticket = await repo.createTicket({
        channelId: channel.id,
        guildId: guild.id,
        userId: user.id,
        userTag: user.tag,
        ticketNumber,
      });
    } catch (err) {
      // บันทึกไม่ได้ -> ลบห้องที่สร้างไปแล้วคืน ไม่ให้เหลือห้องผีที่ระบบไม่รู้จัก
      console.error('❌ [ticket:open] บันทึกตั๋วไม่สำเร็จ ลบห้องคืน:', err);
      await deleteChannelSafe(channel, 'บันทึกตั๋วลงฐานข้อมูลไม่สำเร็จ');

      return fail(
        interaction,
        `${err instanceof DatabaseError ? err.userMessage : err.message}\n\n` +
          'บอทลบห้องที่สร้างค้างไว้แล้ว กรุณาลองกดเปิดตั๋วอีกครั้ง',
      );
    }

    // ----- ส่ง embed ต้อนรับ -----
    try {
      const welcome = await channel.send({
        content: `<@${user.id}> · <@&${staffRole.id}>`,
        embeds: [ui.welcomeEmbed(ticket, { opener: user, staffRoleId: staffRole.id })],
        components: [ui.ticketRow(ticket)],
      });

      // ปักหมุดไว้เพื่อให้หาปุ่มง่ายเมื่อคุยกันยาว (ล้มเหลวได้ ไม่สำคัญ)
      await welcome.pin().catch(() => {});
    } catch (err) {
      console.error('❌ [ticket:open] ส่ง embed ต้อนรับไม่สำเร็จ:', err);

      // ห้องสร้างแล้วแต่ไม่มีปุ่ม = ตั๋วใช้งานไม่ได้ -> ย้อนทั้งหมด
      await deleteChannelSafe(channel, 'ส่ง embed ต้อนรับไม่สำเร็จ');
      await repo.deleteTicket(channel.id).catch((dbErr) =>
        console.error('❌ [ticket:open] ลบข้อมูลตั๋วตอน rollback ไม่สำเร็จ:', dbErr),
      );

      return fail(
        interaction,
        'สร้างห้องได้แต่ส่งข้อความต้อนรับไม่สำเร็จ บอทจึงยกเลิกการเปิดตั๋วให้แล้ว\nกรุณาลองใหม่อีกครั้ง',
      );
    }

    return ok(
      interaction,
      M.t('ticket.replies.opened', { ticketNumber, channelMention: String(channel) }),
    );
  } finally {
    opening.delete(`${guild.id}:${user.id}`);
  }
}

// =====================================================================
//  ticket:claim — staff รับเรื่อง / ยกเลิกการรับเรื่อง
// =====================================================================

async function handleClaim(interaction) {
  const { guild, channel, member, user } = interaction;

  if (!guild) return fail(interaction, M.t('common.buttonGuildOnly'));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // ----- โหลดข้อมูล -----
  let settings;
  let ticket;

  try {
    [settings, ticket] = await Promise.all([
      repo.getSettings(guild.id),
      repo.getTicketByChannel(channel.id),
    ]);
  } catch (err) {
    console.error('❌ [ticket:claim] โหลดข้อมูลไม่สำเร็จ:', err);
    return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
  }

  if (!ticket) {
    return fail(interaction, M.t('ticket.replies.notFound'));
  }

  if (ticket.status === 'closed') {
    return fail(interaction, M.t('ticket.replies.alreadyClosed'));
  }

  // ----- ตรวจสิทธิ์: ต้องเป็น staff หรือ admin -----
  // ใช้ guards ร่วมกับแผงควบคุม เพื่อให้กฎสิทธิ์ตรงกันทุกที่ (staff / แอดมินใหญ่)
  if (!guards.isStaff(member, settings)) {
    return fail(
      interaction,
      M.t('ticket.replies.staffOnly', {
        staffRoleMention: settings ? ` (<@&${settings.staffRoleId}>)` : '',
      }),
    );
  }

  // ----- กรณีมีคนรับไปแล้ว -----
  if (ticket.claimedBy && ticket.claimedBy !== user.id) {
    return fail(
      interaction,
      M.t('ticket.replies.alreadyClaimed', { staffMention: `<@${ticket.claimedBy}>` }),
    );
  }

  // ----- สลับสถานะ claim -----
  const isUnclaiming = ticket.claimedBy === user.id;
  let updated;

  try {
    updated = isUnclaiming
      ? await repo.unclaimTicket(channel.id)
      : await repo.claimTicket(channel.id, user.id);
  } catch (err) {
    console.error('❌ [ticket:claim] อัปเดตสถานะไม่สำเร็จ:', err);
    return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
  }

  // ----- อัปเดต embed เดิมให้สะท้อนสถานะใหม่ -----
  try {
    const opener = await fetchMemberSafe(guild, updated.userId);

    await interaction.message.edit({
      embeds: [
        ui.welcomeEmbed(updated, {
          opener: opener?.user,
          staffRoleId: settings?.staffRoleId ?? '0',
        }),
      ],
      components: [ui.ticketRow(updated)],
    });
  } catch (err) {
    // แก้ embed ไม่ได้ไม่ถือว่าล้มเหลว เพราะฐานข้อมูลบันทึกแล้ว
    if (!isGone(err)) console.warn(`⚠️  [ticket:claim] แก้ไข embed ไม่สำเร็จ: ${err.message}`);
  }

  // ----- แจ้งในห้องให้ทุกคนเห็น -----
  try {
    await channel.send({
      embeds: [
        {
          color: isUnclaiming ? COLORS.warning : COLORS.success,
          description: isUnclaiming
            ? M.t('ticket.claim.unclaimed', { staffMention: `<@${user.id}>` })
            : M.t('ticket.claim.claimed', { staffMention: `<@${user.id}>` }),
        },
      ],
    });
  } catch (err) {
    if (!isGone(err)) console.warn(`⚠️  [ticket:claim] ส่งข้อความแจ้งไม่สำเร็จ: ${err.message}`);
  }

  return ok(
    interaction,
    isUnclaiming
      ? M.t('ticket.claim.replyUnclaimed')
      : M.t('ticket.claim.replyClaimed', { ticketNumber: updated.ticketNumber ?? '-' }),
  );
}

// =====================================================================
//  ticket:close — ขอยืนยันก่อนปิด
// =====================================================================

async function handleCloseRequest(interaction) {
  const { guild, channel, member } = interaction;

  if (!guild) return fail(interaction, M.t('common.buttonGuildOnly'));

  let settings;
  let ticket;

  try {
    [settings, ticket] = await Promise.all([
      repo.getSettings(guild.id),
      repo.getTicketByChannel(channel.id),
    ]);
  } catch (err) {
    console.error('❌ [ticket:close] โหลดข้อมูลไม่สำเร็จ:', err);
    return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
  }

  if (!ticket) {
    return fail(interaction, 'ไม่พบข้อมูลตั๋วของห้องนี้ในระบบ');
  }

  if (ticket.status === 'closed') {
    return fail(interaction, 'ตั๋วใบนี้ถูกปิดไปแล้ว');
  }

  // ผู้เปิดตั๋ว, staff และ admin ปิดได้
  const isOwner = ticket.userId === member.id;
  if (!isOwner && !guards.isStaff(member, settings)) {
    return fail(interaction, M.t('ticket.replies.noPermissionClose'));
  }

  if (closing.has(channel.id)) {
    return fail(interaction, 'ตั๋วใบนี้กำลังถูกปิดอยู่แล้ว กรุณารอสักครู่');
  }

  return safeReply(interaction, {
    embeds: [ui.closeConfirmEmbed(ticket)],
    components: [ui.closeConfirmRow()],
    flags: MessageFlags.Ephemeral,
  });
}

// =====================================================================
//  ticket:close:confirm — ปิดจริง
// =====================================================================

async function handleCloseConfirm(interaction) {
  const { guild, channel, user } = interaction;

  if (!guild) return fail(interaction, M.t('common.buttonGuildOnly'));

  if (closing.has(channel.id)) {
    return fail(interaction, 'ตั๋วใบนี้กำลังถูกปิดอยู่แล้ว กรุณารอสักครู่');
  }

  closing.add(channel.id);

  try {
    await interaction.deferUpdate();

    let ticket;
    try {
      ticket = await repo.getTicketByChannel(channel.id);
    } catch (err) {
      console.error('❌ [ticket:close:confirm] โหลดข้อมูลตั๋วไม่สำเร็จ:', err);
      return safeReply(interaction, {
        embeds: [
          { color: COLORS.error, description: `❌ ${err instanceof DatabaseError ? err.userMessage : err.message}` },
        ],
        components: [],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!ticket || ticket.status === 'closed') {
      return safeReply(interaction, {
        embeds: [{ color: COLORS.warning, description: '⚠️ ตั๋วใบนี้ถูกปิดไปแล้ว' }],
        components: [],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ----- แจ้งในห้องว่ากำลังปิด -----
    try {
      await channel.send({ embeds: [ui.closingEmbed(user)] });
    } catch (err) {
      if (isGone(err)) {
        // ห้องหายไปก่อน -> ปิดในฐานข้อมูลแล้วจบ
        await repo
          .closeTicket(channel.id, { closedBy: user.id, reason: 'ห้องถูกลบก่อนบอทปิด' })
          .catch(() => {});
        return null;
      }
      console.warn(`⚠️  [ticket:close:confirm] ส่งข้อความแจ้งปิดไม่สำเร็จ: ${err.message}`);
    }

    // ----- สร้าง transcript (ไม่ throw — ล้มเหลวก็ปิดต่อได้) -----
    const transcript = await buildTranscript(channel, ticket, { closedBy: user });

    // ----- เก็บประวัติแชทลงฐานข้อมูล -----
    // ทำก่อนลบห้อง เพราะหลังลบข้อความหายถาวร
    // เก็บไว้ให้ดูย้อนหลังใน dashboard (ไฟล์ .txt ยังส่งไปห้องแอดมินเหมือนเดิม)
    // ล้มเหลวได้ ไม่ขวางการปิดตั๋ว — แค่ดูย้อนหลังใน dashboard ไม่ได้
    if (transcript.records?.length) {
      try {
        const saved = await repo.saveMessages({
          channelId: channel.id,
          guildId: guild.id,
          ticketNumber: ticket.ticketNumber,
          messages: transcript.records,
        });

        console.log(
          `💾 [ticket] เก็บประวัติแชทตั๋ว #${ticket.ticketNumber ?? '-'} แล้ว ` +
            `(${saved.saved}/${saved.total} ข้อความ${saved.truncated ? ' — ตัดเพราะยาวเกิน' : ''})`,
        );
      } catch (err) {
        console.warn(`⚠️  [ticket] เก็บประวัติแชทไม่สำเร็จ: ${err.message}`);
      }
    }

    // ----- ปิดในฐานข้อมูล -----
    let closed = ticket;

    try {
      closed = await repo.closeTicket(channel.id, { closedBy: user.id });
    } catch (err) {
      // ปิดในฐานข้อมูลไม่ได้ -> ไม่ลบห้อง เพราะจะเหลือตั๋วผีที่กันคนเปิดใบใหม่
      console.error('❌ [ticket:close:confirm] ปิดตั๋วในฐานข้อมูลไม่สำเร็จ:', err);

      try {
        await channel.send({
          embeds: [
            {
              color: COLORS.error,
              title: '❌ ปิดตั๋วไม่สำเร็จ',
              description:
                `${err instanceof DatabaseError ? err.userMessage : err.message}\n\n` +
                'บอทยังไม่ลบห้องนี้ เพื่อไม่ให้ข้อมูลตั๋วค้างในระบบ กรุณาลองกดปิดอีกครั้ง',
            },
          ],
        });
      } catch { /* ส่งไม่ได้ก็ปล่อย */ }

      return null;
    }

    // ----- ส่ง transcript ไปห้องแอดมินใหญ่ที่เดียว -----
    //
    // ทำไมส่งที่เดียว: ไฟล์ transcript มีบทสนทนาทั้งหมดในตั๋ว รวมที่ทีมงานคุยกันด้วย
    // จึงเป็นเอกสารสำหรับตรวจสอบการทำงานของทีมงาน ไม่ควรส่งให้ผู้เปิดตั๋วหรือลงห้องสาธารณะ
    //
    // ลำดับปลายทาง: ห้องแอดมินใหญ่ -> ห้องทีมงาน (ถ้าไม่ได้ตั้งห้องแอดมิน)
    // ถ้าไม่ได้ตั้งทั้งคู่ = ไม่ส่งที่ไหนเลย แล้วเตือนใน console ให้แอดมินรู้ว่าไฟล์หาย
    if (transcript.attachment) {
      try {
        const settings = await repo.getSettings(guild.id);

        // เลือกห้องปลายทาง — ห้องแอดมินใหญ่มาก่อน
        let target = null;
        let targetLabel = '';

        if (settings?.superPanelChannelId) {
          target = await fetchChannelSafe(guild, settings.superPanelChannelId);
          targetLabel = 'ห้องแอดมินใหญ่';
        }

        if (!target?.isTextBased?.() && settings?.adminPanelChannelId) {
          target = await fetchChannelSafe(guild, settings.adminPanelChannelId);
          targetLabel = 'ห้องทีมงาน';
        }

        if (target?.isTextBased?.()) {
          await target.send({
            embeds: [ui.archiveEmbed(closed, user, transcript.messageCount)],
            files: [transcript.attachment],
          });

          console.log(
            `📁 [ticket] ส่ง transcript ตั๋ว #${closed.ticketNumber ?? '-'} ไป${targetLabel} (#${target.name})`,
          );
        } else {
          console.warn(
            `⚠️  [ticket] ตั๋ว #${closed.ticketNumber ?? '-'} ปิดแล้วแต่ไม่มีห้องเก็บ transcript — ` +
              'ยังไม่ได้ตั้งห้องแอดมินใหญ่หรือห้องทีมงาน (ตั้งด้วย /setup-ticket)',
          );
        }
      } catch (err) {
        console.warn(`⚠️  [ticket:close:confirm] ส่ง transcript ไม่สำเร็จ: ${err.message}`);
      }
    }

    // ----- รอให้คนอ่านข้อความทัน แล้วลบห้อง -----
    // ตั้งเวลาได้ที่ messages.json -> ticket.closing.deleteDelaySeconds
    const delaySec = M.num('ticket.closing.deleteDelaySeconds', { min: 1, max: 60 });
    await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));

    const deleted = await deleteChannelSafe(
      channel,
      `ปิดตั๋ว #${closed.ticketNumber ?? '-'} โดย ${user.tag}`,
    );

    if (!deleted) {
      // ลบห้องไม่ได้เพราะสิทธิ์ — ตั๋วปิดในฐานข้อมูลแล้ว แจ้งให้คนลบด้วยมือ
      try {
        await channel.send({
          embeds: [
            {
              color: COLORS.warning,
              description:
                '⚠️ ตั๋วถูกปิดในระบบแล้ว แต่บอทลบห้องนี้ไม่ได้เพราะสิทธิ์ไม่พอ\n' +
                'กรุณาลบห้องนี้ด้วยมือ และเปิดสิทธิ์ **จัดการห้อง (Manage Channels)** ให้บอท',
            },
          ],
        });
      } catch { /* ส่งไม่ได้ก็ปล่อย */ }
    }

    return null;
  } finally {
    closing.delete(channel.id);
  }
}

// =====================================================================
//  ticket:close:cancel
// =====================================================================

async function handleCloseCancel(interaction) {
  return safeReply(interaction, {
    embeds: [{ color: COLORS.neutral, description: M.t('ticket.closeConfirm.cancelled') }],
    components: [],
    flags: MessageFlags.Ephemeral,
  });
}

// =====================================================================
//  ตัวกระจายงาน
// =====================================================================

const HANDLERS = {
  [ui.IDS.OPEN]: handleOpen,
  [ui.IDS.CLAIM]: handleClaim,
  [ui.IDS.CLOSE]: handleCloseRequest,
  [ui.IDS.CLOSE_CONFIRM]: handleCloseConfirm,
  [ui.IDS.CLOSE_CANCEL]: handleCloseCancel,
};

module.exports = {
  name: Events.InteractionCreate,
  system: 'ticket',

  /**
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(interaction) {
    if (!interaction.isButton()) return;

    // สนใจเฉพาะปุ่มของระบบตั๋ว — ปุ่มระบบอื่นปล่อยผ่านให้ handler ของระบบนั้นจัดการ
    if (!interaction.customId.startsWith('ticket:')) return;

    const handler = HANDLERS[interaction.customId];

    if (!handler) {
      console.warn(`⚠️  [ticket] ไม่รู้จักปุ่ม customId: ${interaction.customId}`);
      return;
    }

    try {
      await handler(interaction);
    } catch (err) {
      console.error(`❌ [ticket] ปุ่ม ${interaction.customId} ทำงานผิดพลาด:`, err);

      const message =
        err instanceof DatabaseError
          ? err.userMessage
          : isPermissionError(err)
            ? '❌ บอทสิทธิ์ไม่พอที่จะทำสิ่งนี้ กรุณาแจ้งผู้ดูแลเซิร์ฟเวอร์'
            : isGone(err)
              ? '❌ ห้องหรือข้อความที่เกี่ยวข้องถูกลบไปแล้ว'
              : `❌ เกิดข้อผิดพลาดที่ไม่คาดคิด: ${err.message}`;

      await fail(interaction, message).catch(() => {});
    }
  },
};
