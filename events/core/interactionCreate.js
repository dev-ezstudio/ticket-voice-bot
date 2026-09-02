/**
 * events/core/interactionCreate.js — ตัวกระจาย slash command ของทั้ง 2 ระบบ
 *
 * ไฟล์นี้ไม่มี logic ของระบบใดระบบหนึ่ง แค่หา command จาก client.commands
 * แล้วเรียก execute() ให้ พร้อมจับ error กลางไว้กันบอทล่ม
 *
 * ปุ่ม (button interaction) ไม่ได้จัดการที่นี่ — แต่ละระบบดักปุ่มของตัวเองแยก
 * ที่ events/ticket/interactionCreate.js เพื่อไม่ให้ logic 2 ระบบปนกัน
 */

const { Events, MessageFlags } = require('discord.js');

const { fail } = require('../../lib/reply');
const M = require('../../lib/messages');
const { DatabaseError } = require('../../supabase');
const { isGone, isPermissionError } = require('../../lib/discordUtils');

/** กัน spam: key = userId:commandName -> เวลาที่เรียกครั้งล่าสุด */
const lastUse = new Map();

/** เว้นระยะขั้นต่ำระหว่างการเรียกคำสั่งเดิมซ้ำ (มิลลิวินาที) */
const COOLDOWN_MS = 1500;

function pruneCooldowns() {
  const cutoff = Date.now() - COOLDOWN_MS * 20;
  for (const [key, at] of lastUse) {
    if (at < cutoff) lastUse.delete(key);
  }
}

module.exports = {
  name: Events.InteractionCreate,
  system: 'core',

  /**
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.warn(`⚠️  ไม่พบคำสั่ง "${interaction.commandName}" ในระบบ`);
      return fail(
        interaction,
        'ไม่พบคำสั่งนี้ในระบบ\n' +
          'อาจเป็นคำสั่งเก่าที่ถูกถอดไปแล้ว กรุณาแจ้งผู้ดูแลให้รัน `npm run deploy` อีกครั้ง',
      ).catch(() => {});
    }

    // ----- กันกดคำสั่งรัวๆ -----
    const key = `${interaction.user.id}:${interaction.commandName}`;
    const last = lastUse.get(key);

    if (last && Date.now() - last < COOLDOWN_MS) {
      return fail(interaction, M.t('common.cooldown')).catch(() => {});
    }

    lastUse.set(key, Date.now());
    pruneCooldowns();

    // ----- ทำงาน -----
    const startedAt = Date.now();

    try {
      await command.execute(interaction);

      const elapsed = Date.now() - startedAt;
      const sub = interaction.options.getSubcommand(false);

      console.log(
        `✅ [${command.system ?? 'core'}] /${interaction.commandName}${sub ? ` ${sub}` : ''} ` +
          `โดย ${interaction.user.tag} ใน ${interaction.guild?.name ?? 'DM'} (${elapsed} ms)`,
      );
    } catch (err) {
      console.error(`❌ คำสั่ง /${interaction.commandName} ทำงานผิดพลาด:`, err);

      const message =
        err instanceof DatabaseError
          ? err.userMessage
          : isPermissionError(err)
            ? M.t('common.permissionError')
            : isGone(err)
              ? M.t('common.goneError')
              : M.t('common.unexpectedError', { message: err.message });

      await fail(interaction, message).catch(() => {
        // ตอบไม่ได้แล้ว (interaction หมดอายุ) — log ไว้พอ
        console.warn('⚠️  ตอบข้อความ error ให้ผู้ใช้ไม่ทัน');
      });
    }
  },
};
