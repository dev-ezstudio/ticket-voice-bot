/**
 * commands/voice/setup-voice.js — /setup-voice (Admin เท่านั้น)
 *
 * หน้าที่:
 *   1. สร้าง category "🎙️ ห้องเสียงชั่วคราว"
 *   2. สร้างห้องเสียง "➕ สร้างห้องของคุณ" ไว้ใน category นั้น
 *   3. สร้างห้องข้อความคู่มือ (ถ้าผู้ใช้ต้องการ)
 *   4. บันทึกลง Supabase ตาราง voice_settings
 *
 * ตั้งซ้ำได้ — ถ้ามี category/ห้องเดิมอยู่แล้วจะใช้ของเดิม ไม่สร้างซ้ำ
 */

const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const repo = require('../../lib/voice/repo');
const ui = require('../../lib/voice/ui');
const panel = require('../../lib/voice/panel');
const M = require('../../lib/messages');
const { ok, fail } = require('../../lib/reply');
const {
  checkBotPermissions,
  fetchChannelSafe,
  deleteChannelSafe,
  isPermissionError,
} = require('../../lib/discordUtils');
const { DatabaseError } = require('../../supabase');

// ชื่อ category และห้อง ตั้งได้ที่ messages.json -> voice.setup
const CATEGORY_NAME = () => M.t('voice.setup.categoryName');
const CREATOR_NAME = () => M.t('voice.setup.creatorChannelName');
const GUIDE_NAME = () => M.t('voice.setup.guideChannelName');

module.exports = {
  system: 'voice',

  data: new SlashCommandBuilder()
    .setName('setup-voice')
    .setDescription('ตั้งค่าระบบห้องเสียงชั่วคราว (สร้างหมวดและห้องสร้างห้อง)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addBooleanOption((option) =>
      option
        .setName('สร้างห้องคู่มือ')
        .setDescription('สร้างห้องข้อความอธิบายวิธีใช้ปุ่มต่างๆ ด้วยหรือไม่ (ค่าเริ่มต้น: ใช่)')
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) return fail(interaction, 'คำสั่งนี้ใช้ได้เฉพาะในเซิร์ฟเวอร์เท่านั้น');

    const withGuide = interaction.options.getBoolean('สร้างห้องคู่มือ') ?? true;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ----- ตรวจ permission -----
    const perms = checkBotPermissions(guild, [
      'ManageChannels',
      'MoveMembers',
      'Connect',
      'ViewChannel',
      'SendMessages',
      'EmbedLinks',
    ]);

    if (!perms.ok) return fail(interaction, perms.messageTh);

    // ----- ถ้าตั้งไว้แล้วและของเดิมยังอยู่ ให้ใช้ของเดิม -----
    let existing;
    try {
      existing = await repo.getSettings(guild.id);
    } catch (err) {
      console.error('❌ [setup-voice] โหลดการตั้งค่าเดิมไม่สำเร็จ:', err);
      return fail(interaction, err instanceof DatabaseError ? err.userMessage : err.message);
    }

    let category = existing ? await fetchChannelSafe(guild, existing.categoryId) : null;
    let creatorChannel = existing ? await fetchChannelSafe(guild, existing.creatorChannelId) : null;

    if (category && category.type !== ChannelType.GuildCategory) category = null;
    if (creatorChannel && creatorChannel.type !== ChannelType.GuildVoice) creatorChannel = null;

    const reused = { category: Boolean(category), creator: Boolean(creatorChannel) };

    // เก็บรายการที่สร้างใหม่ไว้ เผื่อต้อง rollback
    const created = [];

    try {
      // ----- สร้าง category -----
      if (!category) {
        category = await guild.channels.create({
          name: CATEGORY_NAME(),
          type: ChannelType.GuildCategory,
          reason: `ตั้งค่าระบบห้องเสียงชั่วคราวโดย ${interaction.user.tag}`,
        });
        created.push(category);
      }

      // ----- สร้างห้อง creator -----
      if (!creatorChannel) {
        creatorChannel = await guild.channels.create({
          name: CREATOR_NAME(),
          type: ChannelType.GuildVoice,
          parent: category.id,
          userLimit: 1, // เข้าได้ทีละคน เพราะเข้าแล้วถูกย้ายออกทันที
          reason: `ตั้งค่าระบบห้องเสียงชั่วคราวโดย ${interaction.user.tag}`,
          permissionOverwrites: [
            {
              // ทุกคนเข้าได้ แต่พูดไม่ได้ (ไม่มีประโยชน์ เพราะจะถูกย้ายออกทันที)
              id: guild.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
              deny: [PermissionFlagsBits.Speak],
            },
            {
              id: guild.members.me.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers,
              ],
            },
          ],
        });
        created.push(creatorChannel);
      } else if (creatorChannel.parentId !== category.id) {
        // ห้องเดิมถูกย้ายออกจาก category ไป -> ย้ายกลับ
        await creatorChannel.setParent(category.id, { lockPermissions: false }).catch(() => {});
      }

      // ----- บันทึกลงฐานข้อมูล -----
      await repo.saveSettings({
        guildId: guild.id,
        creatorChannelId: creatorChannel.id,
        categoryId: category.id,
      });
    } catch (err) {
      // rollback ห้องที่สร้างใหม่ทั้งหมด ไม่ให้เหลือห้องผีที่ระบบไม่รู้จัก
      for (const channel of created.reverse()) {
        await deleteChannelSafe(channel, 'ตั้งค่าระบบห้องเสียงไม่สำเร็จ ยกเลิกการสร้าง');
      }

      console.error('❌ [setup-voice] ตั้งค่าไม่สำเร็จ:', err);

      if (isPermissionError(err)) {
        return fail(
          interaction,
          'บอทสร้างห้องไม่ได้เพราะสิทธิ์ไม่พอ\n' +
            'กรุณาเปิดสิทธิ์ **จัดการห้อง (Manage Channels)** และ **ย้ายสมาชิก (Move Members)** ให้บอท',
        );
      }

      return fail(
        interaction,
        `${err instanceof DatabaseError ? err.userMessage : err.message}\n\n` +
          (created.length > 0 ? 'บอทลบห้องที่สร้างค้างไว้แล้ว ' : '') +
          'กรุณาลองใช้คำสั่งนี้อีกครั้ง',
      );
    }

    // ----- สร้างห้องคู่มือ (ล้มเหลวได้ ไม่ถือว่าตั้งค่าไม่สำเร็จ) -----
    let guideChannel = null;
    let guideError = null;

    if (withGuide) {
      try {
        const existingGuide = guild.channels.cache.find(
          (ch) => ch.parentId === category.id && ch.type === ChannelType.GuildText && ch.name === GUIDE_NAME(),
        );

        guideChannel =
          existingGuide ??
          (await guild.channels.create({
            name: GUIDE_NAME(),
            type: ChannelType.GuildText,
            parent: category.id,
            topic: 'วิธีใช้ระบบห้องเสียงชั่วคราวและปุ่มบนแผงควบคุมทั้งหมด',
            reason: `ตั้งค่าระบบห้องเสียงชั่วคราวโดย ${interaction.user.tag}`,
            permissionOverwrites: [
              {
                id: guild.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [PermissionFlagsBits.SendMessages],
              },
            ],
          }));

        // ส่ง embed คู่มือ พร้อมปุ่ม "เปิดแผงควบคุม"
        // ปุ่มนี้ให้สมาชิกเรียกแผงมาดูได้ทุกเมื่อ ถ้าหาแผงในแชทห้องเสียงไม่เจอ
        await guideChannel.send({
          embeds: [ui.guideEmbed(creatorChannel)],
          components: [panel.summonRow()],
        });
      } catch (err) {
        guideError = err.message;
        console.warn(`⚠️  [setup-voice] สร้างห้องคู่มือไม่สำเร็จ: ${err.message}`);
      }
    }

    // ----- สรุปผล -----
    const lines = [
      `**หมวด** ${category} ${reused.category ? '_(ใช้ของเดิม)_' : '_(สร้างใหม่)_'}`,
      `**ห้องสร้างห้อง** ${creatorChannel} ${reused.creator ? '_(ใช้ของเดิม)_' : '_(สร้างใหม่)_'}`,
    ];

    if (guideChannel) lines.push(`**ห้องคู่มือ** ${guideChannel}`);
    if (guideError) lines.push(`⚠️ สร้างห้องคู่มือไม่สำเร็จ: ${guideError}`);

    return ok(
      interaction,
      `ตั้งค่าระบบห้องเสียงชั่วคราวสำเร็จ\n\n${lines.join('\n')}\n\n` +
        `สมาชิกเข้าห้อง ${creatorChannel} ได้เลย บอทจะสร้างห้องส่วนตัวและย้ายเข้าไปทันที`,
      { title: '🎙️ ระบบห้องเสียงชั่วคราว' },
    );
  },
};
