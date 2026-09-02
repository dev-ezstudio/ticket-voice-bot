/**
 * commands/voice/voice.js — กลุ่มคำสั่ง /voice (11 คำสั่งย่อย)
 *
 * ทุกคำสั่งย่อยต้องผ่านด่านเดียวกันจาก lib/voice/guards.js:
 *   - ผู้ใช้ต้องอยู่ในห้องเสียงชั่วคราวที่บอทดูแล
 *   - ต้องเป็นเจ้าของห้องนั้น (ยกเว้น /voice claim และ /voice info)
 *
 * คำสั่งย่อย:
 *   name, limit, lock, unlock, kick, block, unblock, permit, claim, transfer, info
 */

const { SlashCommandBuilder } = require('discord.js');

const repo = require('../../lib/voice/repo');
const actions = require('../../lib/voice/actions');
const M = require('../../lib/messages');
const { requireOwnedTempChannel } = require('../../lib/voice/guards');
const { fail } = require('../../lib/reply');

/** ใช้ตัวแปลง error ตัวเดียวกับที่ปุ่มใช้ เพื่อให้ข้อความตรงกัน */
const describeError = actions.describeError;

// =====================================================================
//  ตัวเชื่อมไปยัง lib/voice/actions.js
//
//  logic จริงอยู่ที่ lib/voice/actions.js ไฟล์เดียว
//  เพื่อให้ slash command กับปุ่มบนแผงควบคุมทำงานเหมือนกัน 100%
//  ที่นี่มีหน้าที่แค่แกะค่าจาก interaction.options แล้วส่งต่อ
// =====================================================================

// =====================================================================
//  ตารางคำสั่งย่อย
//  requireOwner: false = ใช้ได้แม้ไม่ใช่เจ้าของห้อง
// =====================================================================

const SUBCOMMANDS = {
  name: {
    requireOwner: true,
    run: (i, g) => actions.rename(i, g, { name: i.options.getString('ชื่อ', true) }),
  },
  limit: {
    requireOwner: true,
    run: (i, g) => actions.setLimit(i, g, { limit: i.options.getInteger('จำนวน', true) }),
  },
  lock: { requireOwner: true, run: actions.lock },
  unlock: { requireOwner: true, run: actions.unlock },
  kick: {
    requireOwner: true,
    run: (i, g) => actions.kick(i, g, { targetUser: i.options.getUser('ผู้ใช้', true) }),
  },
  block: {
    requireOwner: true,
    run: (i, g) => actions.block(i, g, { targetUser: i.options.getUser('ผู้ใช้', true) }),
  },
  unblock: {
    requireOwner: true,
    run: (i, g) => actions.unblock(i, g, { targetUser: i.options.getUser('ผู้ใช้', true) }),
  },
  permit: {
    requireOwner: true,
    run: (i, g) => actions.permit(i, g, { targetUser: i.options.getUser('ผู้ใช้', true) }),
  },
  transfer: {
    requireOwner: true,
    run: (i, g) => actions.transfer(i, g, { targetUser: i.options.getUser('ผู้ใช้', true) }),
  },
  claim: { requireOwner: false, run: actions.claim },
  info: { requireOwner: false, run: actions.info },
};

module.exports = {
  system: 'voice',

  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('จัดการห้องเสียงชั่วคราวของคุณ')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('name')
        .setDescription('เปลี่ยนชื่อห้องเสียงของคุณ')
        .addStringOption((opt) =>
          opt
            .setName('ชื่อ')
            .setDescription('ชื่อใหม่ของห้อง (ยาวไม่เกิน 100 ตัวอักษร)')
            .setMinLength(1)
            .setMaxLength(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('จำกัดจำนวนคนในห้อง')
        .addIntegerOption((opt) =>
          opt
            .setName('จำนวน')
            .setDescription('จำนวนคนสูงสุด (0 = ไม่จำกัด, สูงสุด 99)')
            .setMinValue(0)
            .setMaxValue(99)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('lock').setDescription('ล็อกห้อง คนอื่นเข้าไม่ได้'))
    .addSubcommand((sub) => sub.setName('unlock').setDescription('ปลดล็อกห้อง ให้ทุกคนเข้าได้'))
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('เตะสมาชิกออกจากห้อง (กลับเข้ามาได้)')
        .addUserOption((opt) =>
          opt.setName('ผู้ใช้').setDescription('คนที่ต้องการเตะออก').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('block')
        .setDescription('บล็อกไม่ให้เข้าห้องนี้อีก')
        .addUserOption((opt) =>
          opt.setName('ผู้ใช้').setDescription('คนที่ต้องการบล็อก').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unblock')
        .setDescription('ยกเลิกการบล็อก')
        .addUserOption((opt) =>
          opt.setName('ผู้ใช้').setDescription('คนที่ต้องการยกเลิกการบล็อก').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('permit')
        .setDescription('อนุญาตให้เข้าห้องที่ล็อกไว้')
        .addUserOption((opt) =>
          opt.setName('ผู้ใช้').setDescription('คนที่ต้องการอนุญาต').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('claim').setDescription('ยึดห้องเมื่อเจ้าของออกจากห้องไปแล้ว'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('transfer')
        .setDescription('โอนความเป็นเจ้าของห้องให้คนอื่น')
        .addUserOption((opt) =>
          opt.setName('ผู้ใช้').setDescription('คนที่จะรับโอนห้อง (ต้องอยู่ในห้อง)').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('info').setDescription('ดูข้อมูลห้องเสียงปัจจุบัน')),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    if (!interaction.guild) {
      return fail(interaction, M.t('common.guildOnly'));
    }

    const subName_ = interaction.options.getSubcommand();
    const entry = SUBCOMMANDS[subName_];

    if (!entry) {
      return fail(interaction, `ไม่รู้จักคำสั่งย่อย \`${subName_}\``);
    }

    // ----- ตรวจว่าตั้งค่าระบบห้องเสียงแล้วหรือยัง -----
    let settings;
    try {
      settings = await repo.getSettings(interaction.guild.id);
    } catch (err) {
      return fail(interaction, describeError(err));
    }

    if (!settings) {
      return fail(interaction, M.t('voice.replies.notSetup'));
    }

    // ----- ด่านตรวจสิทธิ์ -----
    const guard = await requireOwnedTempChannel(interaction, { requireOwner: entry.requireOwner });

    if (!guard.ok) return fail(interaction, guard.reason);

    // ----- ทำงาน -----
    try {
      return await entry.run(interaction, guard);
    } catch (err) {
      console.error(`❌ [/voice ${subName_}] ทำงานผิดพลาด:`, err);
      return fail(interaction, describeError(err));
    }
  },
};
