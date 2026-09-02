/**
 * events/voice/interactionCreate.js — ปุ่ม / modal / select menu ของ "ระบบห้องเสียง"
 *
 * ไฟล์นี้จัดการเฉพาะ customId ที่ขึ้นต้นด้วย "voice:" เท่านั้น
 * ปุ่มของระบบตั๋วอยู่แยกที่ events/ticket/interactionCreate.js
 *
 * เส้นทางการทำงานของปุ่มที่ต้องรับค่าเพิ่ม:
 *   กดปุ่ม "เปลี่ยนชื่อ"  -> เปิด modal -> ผู้ใช้กรอก -> ทำงาน
 *   กดปุ่ม "เตะออก"      -> เปิด select menu -> ผู้ใช้เลือกคน -> ทำงาน
 *
 * ทุกเส้นทางต้องผ่านด่านตรวจสิทธิ์เดียวกันกับ slash command (lib/voice/guards.js)
 * เพราะระหว่างที่ modal เปิดอยู่ ห้องอาจถูกลบ หรือเจ้าของอาจเปลี่ยนไปแล้ว
 */

const { Events, MessageFlags } = require('discord.js');

const panel = require('../../lib/voice/panel');
const actions = require('../../lib/voice/actions');
const repo = require('../../lib/voice/repo');
const M = require('../../lib/messages');
const { requireOwnedTempChannel } = require('../../lib/voice/guards');
const { fail, safeReply } = require('../../lib/reply');

const { IDS } = panel;

/**
 * ปุ่มที่กดแล้วทำงานทันที (ไม่ต้องรับค่าเพิ่ม)
 * key = customId ปุ่ม, value = { action, requireOwner }
 */
const DIRECT_BUTTONS = {
  [IDS.LOCK]: { run: actions.lock, requireOwner: true },
  [IDS.UNLOCK]: { run: actions.unlock, requireOwner: true },
  [IDS.CLAIM]: { run: actions.claim, requireOwner: false },
  [IDS.INFO]: { run: actions.info, requireOwner: false },
};

/**
 * ปุ่มที่เปิด select menu ให้เลือกคน
 * key = customId ปุ่ม, value = customId ของ select menu
 */
const SELECT_BUTTONS = {
  [IDS.KICK]: IDS.SELECT_KICK,
  [IDS.BLOCK]: IDS.SELECT_BLOCK,
  [IDS.UNBLOCK]: IDS.SELECT_UNBLOCK,
  [IDS.PERMIT]: IDS.SELECT_PERMIT,
  [IDS.TRANSFER]: IDS.SELECT_TRANSFER,
};

/**
 * select menu แต่ละตัวไปเรียก action ไหน
 */
const SELECT_ACTIONS = {
  [IDS.SELECT_KICK]: actions.kick,
  [IDS.SELECT_BLOCK]: actions.block,
  [IDS.SELECT_UNBLOCK]: actions.unblock,
  [IDS.SELECT_PERMIT]: actions.permit,
  [IDS.SELECT_TRANSFER]: actions.transfer,
};

/** ปุ่มที่เปิด modal — คืนตัว modal ที่จะแสดง */
const MODAL_BUTTONS = {
  [IDS.RENAME]: (guard) => panel.renameModal(guard.channel.name),
  [IDS.LIMIT]: (guard) => panel.limitModal(guard.record.userLimit),
};

/**
 * ตรวจสิทธิ์ก่อนทำงาน แล้วคืน guard ที่มี channel + record ล่าสุด
 * ต้องเรียกทุกครั้งแม้จะเพิ่งตรวจไปตอนกดปุ่ม เพราะสถานะอาจเปลี่ยนระหว่างที่ modal เปิดอยู่
 */
async function guardOrFail(interaction, requireOwner) {
  // ตรวจว่าตั้งค่าระบบห้องเสียงไว้แล้ว
  let settings;
  try {
    settings = await repo.getSettings(interaction.guild.id);
  } catch (err) {
    await fail(interaction, actions.describeError(err));
    return null;
  }

  if (!settings) {
    await fail(interaction, M.t('voice.replies.notSetup'));
    return null;
  }

  const guard = await requireOwnedTempChannel(interaction, { requireOwner });

  if (!guard.ok) {
    await fail(interaction, guard.reason);
    return null;
  }

  return guard;
}

module.exports = {
  name: Events.InteractionCreate,
  system: 'voice',

  /**
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(interaction) {
    const id = interaction.customId;

    // สนใจเฉพาะของระบบห้องเสียง — ที่เหลือปล่อยให้ handler อื่นจัดการ
    if (!id || !id.startsWith('voice:')) return;

    if (!interaction.guild) return fail(interaction, M.t('common.buttonGuildOnly'));

    try {
      // ---------- ปุ่มที่เปิด modal ----------
      if (interaction.isButton() && MODAL_BUTTONS[id]) {
        const guard = await guardOrFail(interaction, true);
        if (!guard) return;

        return interaction.showModal(MODAL_BUTTONS[id](guard));
      }

      // ---------- ปุ่มที่เปิด select menu ----------
      if (interaction.isButton() && SELECT_BUTTONS[id]) {
        const selectId = SELECT_BUTTONS[id];

        // เตะ/บล็อก/อนุญาต/โอน ต้องเป็นเจ้าของห้อง
        const guard = await guardOrFail(interaction, true);
        if (!guard) return;

        // ปลดบล็อก: ถ้าไม่มีใครถูกบล็อก บอกไปเลย ไม่ต้องเปิดเมนูเปล่า
        if (selectId === IDS.SELECT_UNBLOCK) {
          const blocked = await repo.listBlockedUsers(guard.channel.id);

          if (blocked.length === 0) {
            return fail(interaction, 'ห้องนี้ยังไม่มีใครถูกบล็อก');
          }

          return safeReply(interaction, {
            ...panel.userSelect(
              selectId,
              `ผู้ที่ถูกบล็อกในห้องนี้:\n${blocked.map((uid) => `• <@${uid}>`).join('\n')}`,
            ),
            flags: MessageFlags.Ephemeral,
          });
        }

        // โอนห้อง: เตือนว่าคนรับต้องอยู่ในห้อง
        const note =
          selectId === IDS.SELECT_TRANSFER
            ? 'เลือกคนที่จะรับโอนห้อง — **คนนั้นต้องอยู่ในห้องนี้ด้วย**'
            : undefined;

        return safeReply(interaction, {
          ...panel.userSelect(selectId, note),
          flags: MessageFlags.Ephemeral,
        });
      }

      // ---------- ปุ่ม "เปิดแผงควบคุม" จากห้องคู่มือ ----------
      // ส่งแผงให้เจ้าของห้องแบบ ephemeral — ใช้เมื่อหาแผงในแชทห้องเสียงไม่เจอ
      if (interaction.isButton() && id === IDS.SUMMON) {
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
          return fail(
            interaction,
            M.t('voice.summon.notInVoice', {
              creatorChannelName: M.t('voice.setup.creatorChannelName'),
            }),
          );
        }

        let record;
        try {
          record = await repo.getTempChannel(voiceChannel.id);
        } catch (err) {
          return fail(interaction, actions.describeError(err));
        }

        if (!record) {
          return fail(
            interaction,
            M.t('voice.replies.notTempChannel', {
              creatorChannelName: M.t('voice.setup.creatorChannelName'),
            }),
          );
        }

        if (record.ownerId !== interaction.user.id) {
          return fail(
            interaction,
            M.t('voice.summon.notOwner', {
              roomName: voiceChannel.name,
              ownerMention: `<@${record.ownerId}>`,
            }),
          );
        }

        return safeReply(interaction, {
          content: M.t('voice.summon.success', { roomName: voiceChannel.name }),
          embeds: [panel.panelEmbed(voiceChannel, record)],
          components: panel.panelRows(record),
          flags: MessageFlags.Ephemeral,
        });
      }

      // ---------- ปุ่มที่ทำงานทันที ----------
      if (interaction.isButton() && DIRECT_BUTTONS[id]) {
        const { run, requireOwner } = DIRECT_BUTTONS[id];

        const guard = await guardOrFail(interaction, requireOwner);
        if (!guard) return;

        await run(interaction, guard);

        // สถานะห้องเปลี่ยน (ล็อก/ปลดล็อก) -> อัปเดตแผงให้ตรง
        if (id === IDS.LOCK || id === IDS.UNLOCK) {
          const fresh = await repo.getTempChannel(guard.channel.id);
          if (fresh) await actions.refreshPanel(guard.channel, fresh);
        }

        return;
      }

      // ---------- modal ส่งค่ากลับมา ----------
      if (interaction.isModalSubmit()) {
        const guard = await guardOrFail(interaction, true);
        if (!guard) return;

        if (id === IDS.MODAL_RENAME) {
          const name = interaction.fields.getTextInputValue(IDS.INPUT_NAME);
          await actions.rename(interaction, guard, { name });

          const fresh = await repo.getTempChannel(guard.channel.id);
          if (fresh) await actions.refreshPanel(guard.channel, fresh);
          return;
        }

        if (id === IDS.MODAL_LIMIT) {
          const rawLimit = interaction.fields.getTextInputValue(IDS.INPUT_LIMIT).trim();
          const limit = Number(rawLimit);

          if (!/^\d{1,2}$/.test(rawLimit) || !Number.isFinite(limit)) {
            return fail(
              interaction,
              `"${rawLimit}" ไม่ใช่ตัวเลขที่ใช้ได้\nกรุณากรอกตัวเลข **0-99** เท่านั้น (0 = ไม่จำกัด)`,
            );
          }

          await actions.setLimit(interaction, guard, { limit });

          const fresh = await repo.getTempChannel(guard.channel.id);
          if (fresh) await actions.refreshPanel(guard.channel, fresh);
          return;
        }

        console.warn(`⚠️  [voice] ไม่รู้จัก modal: ${id}`);
        return;
      }

      // ---------- select menu เลือกคนแล้ว ----------
      if (interaction.isUserSelectMenu() && SELECT_ACTIONS[id]) {
        const guard = await guardOrFail(interaction, true);
        if (!guard) return;

        const targetUser = interaction.users.first();

        if (!targetUser) return fail(interaction, 'ไม่พบผู้ใช้ที่เลือก กรุณาลองใหม่');

        await SELECT_ACTIONS[id](interaction, guard, { targetUser });
        return;
      }
    } catch (err) {
      console.error(`❌ [voice] จัดการ ${id} ผิดพลาด:`, err);
      await fail(interaction, actions.describeError(err)).catch(() => {});
    }
  },
};
