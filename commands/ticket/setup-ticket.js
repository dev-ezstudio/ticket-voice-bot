/**
 * commands/ticket/setup-ticket.js — /setup-ticket (Admin เท่านั้น)
 *
 * ตั้งค่าระบบตั๋วและวางแผงควบคุม 3 หน้า:
 *
 *   1. หน้าเปิดตั๋ว     (บังคับ)   — ทุกคนเห็น กดเปิดตั๋วได้
 *   2. หน้าทีมงาน      (ไม่บังคับ) — ทีมงานดูตั๋วค้าง รับเรื่อง ดูสถิติตัวเอง
 *   3. หน้าแอดมินใหญ่  (ไม่บังคับ) — ดูภาพรวม จัดการตั๋วทุกใบ ตั้งค่าระบบ
 *
 * ระบุแค่หน้า 1 ก็ใช้งานได้ครบ — หน้า 2 และ 3 เป็นของเสริมสำหรับทีมงาน
 * ตั้งซ้ำได้: จะทับค่าเดิมและส่ง panel ใบใหม่ (เลขตั๋วไม่รีเซ็ต)
 */

const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const repo = require('../../lib/ticket/repo');
const ui = require('../../lib/ticket/ui');
const panels = require('../../lib/ticket/panels');
const M = require('../../lib/messages');
const { ok, fail } = require('../../lib/reply');
const {
  checkBotPermissions,
  checkBotChannelPermissions,
  fetchChannelSafe,
  deleteChannelSafe,
  isGone,
  isPermissionError,
} = require('../../lib/discordUtils');
const { DatabaseError } = require('../../supabase');

module.exports = {
  system: 'ticket',

  data: new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('ตั้งค่าระบบตั๋ว และวางแผงควบคุม 3 หน้า (เปิดตั๋ว / ทีมงาน / แอดมินใหญ่)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    // ----- ค่าบังคับ -----
    //
    // หมายเหตุเรื่องรายการเลือกห้อง:
    //   รายการเลือกห้องของ Discord ไม่ได้แสดงทุกห้องพร้อมกัน — ต้องเลื่อนหรือพิมพ์ค้นหา
    //   ถ้าหาห้องที่ต้องการไม่เจอ ให้พิมพ์ชื่อห้องลงไปในช่อง รายการจะกรองให้
    //   หรือปล่อยว่างไว้ บอทจะใช้ "ห้องที่คุณพิมพ์คำสั่งอยู่" เป็นห้องเปิดตั๋วให้
    .addChannelOption((option) =>
      option
        .setName('ห้องเปิดตั๋ว')
        .setDescription('หน้าที่ 1: ห้องวางปุ่มเปิดตั๋ว (เว้นว่าง = ใช้ห้องนี้ / พิมพ์ชื่อห้องเพื่อค้นหา)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    )
    .addChannelOption((option) =>
      option
        .setName('หมวดห้องตั๋ว')
        .setDescription('หมวดที่จะสร้างห้องตั๋วเข้าไป (เว้นว่าง = ใช้หมวดของห้องนี้ หรือสร้างใหม่ให้)')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false),
    )
    .addRoleOption((option) =>
      option
        .setName('ยศทีมงาน')
        .setDescription('ยศที่เห็นห้องตั๋วและกดรับเรื่องได้ (เว้นว่าง = ใช้ค่าที่ตั้งไว้เดิม)')
        .setRequired(false),
    )
    // ----- ค่าไม่บังคับ -----
    .addChannelOption((option) =>
      option
        .setName('ห้องทีมงาน')
        .setDescription('หน้าที่ 2: ห้องวางแผงควบคุมทีมงาน (ควรเป็นห้องที่เห็นแค่ทีมงาน)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addChannelOption((option) =>
      option
        .setName('ห้องแอดมินใหญ่')
        .setDescription('หน้าที่ 3: ห้องวางแผงควบคุมแอดมินใหญ่')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addRoleOption((option) =>
      option
        .setName('ยศแอดมินใหญ่')
        .setDescription('ยศที่กดปุ่มหน้าแอดมินได้ (ไม่ระบุ = ใช้สิทธิ์ Administrator ของ Discord)')
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) return fail(interaction, M.t('common.guildOnly'));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ----- โหลดการตั้งค่าเดิม ใช้เป็นค่าสำรองเมื่อผู้ใช้ไม่ได้ระบุ -----
    let existing = null;
    try {
      existing = await repo.getSettings(guild.id);
    } catch (err) {
      console.error('❌ [setup-ticket] โหลดการตั้งค่าเดิมไม่สำเร็จ:', err);
      return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
    }

    // ----- ห้องเปิดตั๋ว -----
    // ลำดับการหา: ที่ผู้ใช้เลือก -> ค่าเดิมที่ตั้งไว้ -> ห้องที่พิมพ์คำสั่งอยู่
    // ทำแบบนี้เพราะรายการเลือกห้องของ Discord ไม่แสดงทุกห้อง ถ้าหาไม่เจอก็ไม่ต้องเลือก
    let panelChannel = interaction.options.getChannel('ห้องเปิดตั๋ว');
    let panelChannelSource = 'เลือกเอง';

    if (!panelChannel && existing?.panelChannelId) {
      panelChannel = await fetchChannelSafe(guild, existing.panelChannelId);
      if (panelChannel) panelChannelSource = 'ค่าเดิมที่ตั้งไว้';
    }

    if (!panelChannel) {
      panelChannel = interaction.channel;
      panelChannelSource = 'ห้องที่พิมพ์คำสั่ง';
    }

    if (!panelChannel?.isTextBased?.() || panelChannel.isDMBased?.()) {
      return fail(
        interaction,
        'หาห้องสำหรับวางปุ่มเปิดตั๋วไม่ได้\n' +
          'กรุณาเลือกห้องในช่อง **ห้องเปิดตั๋ว** หรือพิมพ์คำสั่งนี้ในห้องข้อความที่ต้องการวางปุ่ม',
      );
    }

    // ----- หมวดห้องตั๋ว -----
    // ลำดับ: ที่เลือก -> ค่าเดิม -> หมวดของห้องที่พิมพ์คำสั่ง -> สร้างใหม่ให้
    let category = interaction.options.getChannel('หมวดห้องตั๋ว');
    let categorySource = 'เลือกเอง';
    let createdCategory = null;

    if (!category && existing?.categoryId) {
      category = await fetchChannelSafe(guild, existing.categoryId);
      if (category?.type !== ChannelType.GuildCategory) category = null;
      else categorySource = 'ค่าเดิมที่ตั้งไว้';
    }

    if (!category && panelChannel.parentId) {
      category = await fetchChannelSafe(guild, panelChannel.parentId);
      if (category?.type !== ChannelType.GuildCategory) category = null;
      else categorySource = 'หมวดของห้องที่พิมพ์คำสั่ง';
    }

    if (!category) {
      // ไม่มีหมวดให้ใช้เลย -> สร้างใหม่ให้ ผู้ใช้ไม่ต้องไปสร้างเองก่อน
      try {
        category = await guild.channels.create({
          name: '🎫 ตั๋วสนับสนุน',
          type: ChannelType.GuildCategory,
          reason: `ตั้งค่าระบบตั๋วโดย ${interaction.user.tag}`,
        });
        createdCategory = category;
        categorySource = 'สร้างใหม่ให้';
      } catch (err) {
        console.error('❌ [setup-ticket] สร้างหมวดไม่สำเร็จ:', err);
        return fail(
          interaction,
          'ไม่พบหมวดสำหรับสร้างห้องตั๋ว และบอทสร้างหมวดใหม่ไม่ได้\n' +
            'กรุณาสร้าง Category ใน Discord แล้วเลือกในช่อง **หมวดห้องตั๋ว**',
        );
      }
    }

    // ----- ยศทีมงาน -----
    // ลำดับ: ที่เลือก -> ค่าเดิม (ไม่มีทั้งคู่ = ต้องระบุ เพราะเดาแทนไม่ได้)
    let staffRole = interaction.options.getRole('ยศทีมงาน');

    if (!staffRole && existing?.staffRoleId) {
      staffRole = guild.roles.cache.get(existing.staffRoleId)
        ?? await guild.roles.fetch(existing.staffRoleId).catch(() => null);
    }

    if (!staffRole) {
      if (createdCategory) await deleteChannelSafe(createdCategory, 'ตั้งค่าไม่สำเร็จ');

      return fail(
        interaction,
        'ต้องระบุ **ยศทีมงาน** อย่างน้อยครั้งแรก\n\n' +
          'ยศนี้คือคนที่จะเห็นห้องตั๋วและกดรับเรื่องได้ — บอทเดาแทนไม่ได้\n' +
          'ถ้ายังไม่มี ให้สร้างที่ Server Settings → Roles ก่อน',
      );
    }

    const staffChannel = interaction.options.getChannel('ห้องทีมงาน');
    const superChannel = interaction.options.getChannel('ห้องแอดมินใหญ่');
    const adminRole = interaction.options.getRole('ยศแอดมินใหญ่');

    // ----- ตรวจ permission ระดับเซิร์ฟเวอร์ -----
    const serverPerms = checkBotPermissions(guild, [
      'ManageChannels',
      'ManageRoles',
      'SendMessages',
      'EmbedLinks',
      'AttachFiles',
      'ReadMessageHistory',
    ]);

    if (!serverPerms.ok) return fail(interaction, serverPerms.messageTh);

    // ----- ตรวจ permission ในแต่ละห้องที่จะวาง panel -----
    for (const [ch, label] of [
      [panelChannel, M.t('ticket.setup.labelPanelChannel')],
      [staffChannel, M.t('ticket.setup.labelStaffChannel')],
      [superChannel, M.t('ticket.setup.labelSuperChannel')],
    ]) {
      if (!ch) continue;

      const p = checkBotChannelPermissions(ch, ['ViewChannel', 'SendMessages', 'EmbedLinks']);
      if (!p.ok) return fail(interaction, `**${label}**: ${p.messageTh}`);
    }

    // ----- ตรวจ permission ใน category -----
    const categoryPerms = checkBotChannelPermissions(category, ['ViewChannel', 'ManageChannels']);

    if (!categoryPerms.ok) {
      return fail(
        interaction,
        `${categoryPerms.messageTh}\n\n${M.t('ticket.setup.errCategoryPerm')}`,
      );
    }

    // ----- ตรวจยศ -----
    if (staffRole.id === guild.id) {
      return fail(interaction, M.t('ticket.setup.errEveryoneStaff'));
    }

    if (staffRole.managed) {
      return fail(
        interaction,
        M.t('ticket.setup.errManagedRole', { roleMention: String(staffRole) }),
      );
    }

    if (adminRole && adminRole.id === guild.id) {
      return fail(interaction, M.t('ticket.setup.errEveryoneAdmin'));
    }

    // ----- ตรวจว่า category ยังไม่เต็ม (Discord จำกัด 50 ห้องต่อ category) -----
    const childCount = guild.channels.cache.filter((ch) => ch.parentId === category.id).size;

    if (childCount >= 50) {
      return fail(
        interaction,
        M.t('ticket.setup.errCategoryFull', { categoryName: category.name }),
      );
    }

    // ----- โหลดสถิติไว้ใช้ในแผงหน้า 2 และ 3 -----
    let stats;
    try {
      stats = await repo.getStats(guild.id);
    } catch (err) {
      console.error('❌ [setup-ticket] โหลดสถิติไม่สำเร็จ:', err);
      return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
    }

    // ค่าที่จะบันทึก — ใช้ตอนสร้าง embed หน้า 3 ด้วย
    const pendingSettings = {
      guildId: guild.id,
      panelChannelId: panelChannel.id,
      categoryId: category.id,
      staffRoleId: staffRole.id,
      adminRoleId: adminRole?.id ?? null,
      adminPanelChannelId: staffChannel?.id ?? null,
      superPanelChannelId: superChannel?.id ?? null,
      ticketCounter: stats.total > 0 ? undefined : 0,
      createdAt: null,
      updatedAt: null,
    };

    // ----- ส่ง panel ทั้ง 3 หน้า -----
    // เก็บข้อความที่ส่งไปแล้วไว้ เผื่อต้องลบคืนตอน rollback
    const sent = [];

    const send = async (channel, payload, label) => {
      try {
        const msg = await channel.send(payload);
        sent.push(msg);
        return msg;
      } catch (err) {
        if (isGone(err)) throw new Error(M.t('ticket.setup.errChannelGone', { label }));
        if (isPermissionError(err)) {
          throw new Error(
            M.t('ticket.setup.errChannelPerm', { label, channelMention: String(channel) }),
          );
        }
        throw new Error(`${label}: ${err.message}`);
      }
    };

    let panelMessage;
    let staffMessage = null;
    let superMessage = null;

    try {
      // หน้า 1 — เปิดตั๋ว
      panelMessage = await send(
        panelChannel,
        { embeds: [ui.panelEmbed(guild)], components: [ui.panelRow()] },
        M.t('ticket.setup.labelPanelChannel'),
      );

      // หน้า 2 — ทีมงาน
      if (staffChannel) {
        staffMessage = await send(
          staffChannel,
          {
            embeds: [panels.staffPanelEmbed(guild, stats, staffRole.id)],
            components: panels.staffPanelRows(),
          },
          M.t('ticket.setup.labelStaffChannel'),
        );
      }

      // หน้า 3 — แอดมินใหญ่
      if (superChannel) {
        superMessage = await send(
          superChannel,
          {
            embeds: [
              panels.superPanelEmbed(guild, stats, {
                ...pendingSettings,
                ticketCounter: stats.total,
              }),
            ],
            components: panels.superPanelRows(),
          },
          M.t('ticket.setup.labelSuperChannel'),
        );
      }
    } catch (err) {
      // ส่งไม่ครบ -> เก็บที่ส่งไปแล้วคืน ไม่ให้เหลือแผงที่กดไม่ได้ค้างอยู่
      for (const msg of sent) await msg.delete().catch(() => {});

      // ถ้าบอทสร้างหมวดใหม่ให้ตอนต้น ต้องลบคืนด้วย ไม่ให้เหลือหมวดเปล่าค้าง
      if (createdCategory) await deleteChannelSafe(createdCategory, 'ตั้งค่าระบบตั๋วไม่สำเร็จ');

      console.error('❌ [setup-ticket] ส่ง panel ไม่สำเร็จ:', err);
      return fail(interaction, `${err.message}\n\n${M.t('ticket.setup.errRollback')}`);
    }

    // ----- บันทึกลงฐานข้อมูล -----
    let saved;
    try {
      saved = await repo.saveSettings({
        guildId: guild.id,
        panelChannelId: panelChannel.id,
        panelMessageId: panelMessage.id,
        categoryId: category.id,
        staffRoleId: staffRole.id,
        adminRoleId: adminRole?.id ?? null,
        adminPanelChannelId: staffChannel?.id ?? null,
        adminPanelMessageId: staffMessage?.id ?? null,
        superPanelChannelId: superChannel?.id ?? null,
        superPanelMessageId: superMessage?.id ?? null,
      });
    } catch (err) {
      // บันทึกไม่ได้ -> เก็บ panel ที่ส่งไปแล้วคืนทั้งหมด
      for (const msg of sent) await msg.delete().catch(() => {});

      // ถ้าบอทสร้างหมวดใหม่ให้ตอนต้น ต้องลบคืนด้วย ไม่ให้เหลือหมวดเปล่าค้าง
      if (createdCategory) await deleteChannelSafe(createdCategory, 'ตั้งค่าระบบตั๋วไม่สำเร็จ');

      const detail = err instanceof DatabaseError ? err.userMessage : err.message;
      console.error('❌ [setup-ticket] บันทึกการตั้งค่าไม่สำเร็จ:', err);

      return fail(
        interaction,
        `${detail}\n\n${M.t('ticket.setup.errRollback')}`,
      );
    }

    // ----- ตรวจเพิ่มเติมและเตือน (ไม่ถือว่าล้มเหลว) -----
    const warnings = [];

    const botHighest = guild.members.me.roles.highest;
    if (staffRole.position >= botHighest.position) {
      warnings.push(M.t('ticket.setup.warnRoleAboveBot', { roleMention: String(staffRole) }));
    }

    if (staffRole.members.size === 0) {
      warnings.push(M.t('ticket.setup.warnNoStaffMember', { roleMention: String(staffRole) }));
    }

    if (!staffChannel) {
      warnings.push(M.t('ticket.setup.warnNoStaffPanel'));
    }

    if (!superChannel) {
      warnings.push(M.t('ticket.setup.warnNoSuperPanel'));
    }

    // เตือนถ้าห้องทีมงาน/แอดมิน เปิดให้ @everyone เห็น
    for (const [ch, label] of [
      [staffChannel, M.t('ticket.setup.labelStaffChannel')],
      [superChannel, M.t('ticket.setup.labelSuperChannel')],
    ]) {
      if (!ch) continue;

      const everyonePerms = ch.permissionsFor(guild.roles.everyone);
      if (everyonePerms?.has(PermissionFlagsBits.ViewChannel)) {
        warnings.push(
          M.t('ticket.setup.warnPublicPanel', { label, channelMention: String(ch) }),
        );
      }
    }

    // ----- สรุปผล -----
    const link = M.t('ticket.setup.linkText');
    const notSet = M.t('ticket.setup.notSetLabel');

    const lines = [
      `${M.t('ticket.setup.labelPanel1')} ${panelChannel} ([${link}](${panelMessage.url}))` +
        (panelChannelSource === 'เลือกเอง' ? '' : ` _(${panelChannelSource})_`),
      staffMessage
        ? `${M.t('ticket.setup.labelPanel2')} ${staffChannel} ([${link}](${staffMessage.url}))`
        : `${M.t('ticket.setup.labelPanel2')} ${notSet}`,
      superMessage
        ? `${M.t('ticket.setup.labelPanel3')} ${superChannel} ([${link}](${superMessage.url}))`
        : `${M.t('ticket.setup.labelPanel3')} ${notSet}`,
      '',
      `${M.t('ticket.setup.labelCategory')} ${category}` +
        (categorySource === 'เลือกเอง' ? '' : ` _(${categorySource})_`),
      `${M.t('ticket.setup.labelStaffRole')} ${staffRole} (${staffRole.members.size} คน)`,
      `${M.t('ticket.setup.labelAdminRole')} ${
        adminRole
          ? `${adminRole} (${adminRole.members.size} คน)`
          : M.t('ticket.setup.adminRoleFallback')
      }`,
    ];

    return ok(
      interaction,
      `${M.t('ticket.setup.successIntro')}\n\n${lines.join('\n')}\n\n` +
        M.t('ticket.setup.successOutro') +
        (warnings.length > 0
          ? `\n\n${M.t('ticket.setup.warningsHeader')}\n${warnings.map((w) => `> • ${w}`).join('\n')}`
          : ''),
      { title: M.t('ticket.setup.successTitle') },
    );
  },
};
