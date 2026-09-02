/**
 * lib/voice/actions.js — logic การทำงานจริงของทุกปุ่มบนแผงควบคุมห้องเสียง
 *
 * ระบบห้องเสียงใช้ปุ่มล้วน ไม่มี slash command (ถอด /voice ออกแล้ว)
 * เพื่อให้สมาชิกใช้งานได้โดยไม่ต้องจำคำสั่ง
 *
 * ทำไมต้องแยกไฟล์นี้ออกมา:
 *   ปุ่มมี 3 รูปแบบ — กดแล้วทำงานทันที / เปิด modal ให้กรอก / เปิดเมนูเลือกคน
 *   ทั้ง 3 ทางเรียกฟังก์ชันในไฟล์นี้ตัวเดียวกัน จึงมีที่แก้ logic ที่เดียว
 *
 * ฟังก์ชันในไฟล์นี้รับค่าที่แกะมาแล้ว (ไม่ยุ่งกับ interaction เอง)
 *   -> ค่าจาก modal หรือ select menu ถูกแกะที่ events/voice/interactionCreate.js
 */

const { PermissionFlagsBits } = require('discord.js');

const repo = require('./repo');
const ui = require('./ui');
const M = require('../messages');
const { ok, fail, safeReply } = require('../reply');
const { MessageFlags } = require('discord.js');
const {
  sanitizeChannelName,
  fetchMemberSafe,
  isGone,
  isPermissionError,
} = require('../discordUtils');
const { DatabaseError } = require('../../supabase');

/** แปลง error ที่เจอบ่อยให้เป็นข้อความไทย */
function describeError(err) {
  if (err instanceof DatabaseError) return err.userMessage;
  if (isGone(err)) return `❌ ${M.t('common.goneError')}`;
  if (isPermissionError(err)) return `❌ ${M.t('common.permissionError')}`;
  return `❌ ${M.t('common.unexpectedError', { message: err.message })}`;
}

// =====================================================================
//  เปลี่ยนชื่อห้อง
// =====================================================================

async function rename(interaction, { channel }, { name }) {
  const newName = sanitizeChannelName(name, `ห้องของ ${interaction.user.username}`);

  if (newName === channel.name) {
    return fail(interaction, M.t('voice.replies.nameSame'));
  }

  try {
    await channel.setName(newName, `เปลี่ยนชื่อโดยเจ้าของห้อง ${interaction.user.tag}`);
  } catch (err) {
    // Discord จำกัดเปลี่ยนชื่อห้อง 2 ครั้งต่อ 10 นาที
    if (err.status === 429) return fail(interaction, M.t('voice.replies.nameRateLimit'));
    throw err;
  }

  await repo.updateTempChannel(channel.id, { name: newName });

  return ok(interaction, M.t('voice.replies.nameChanged', { name: newName }));
}

// =====================================================================
//  จำกัดจำนวนคน
// =====================================================================

async function setLimit(interaction, { channel }, { limit }) {
  const value = Math.max(0, Math.min(99, Math.trunc(Number(limit))));

  if (!Number.isFinite(value)) {
    return fail(interaction, 'กรุณากรอกเป็นตัวเลข 0-99 (0 = ไม่จำกัด)');
  }

  await channel.setUserLimit(value, `ตั้งจำนวนคนโดยเจ้าของห้อง ${interaction.user.tag}`);
  await repo.updateTempChannel(channel.id, { userLimit: value });

  if (value === 0) return ok(interaction, M.t('voice.replies.limitCleared'));

  let text = M.t('voice.replies.limitSet', { limit: value });

  if (channel.members.size > value) {
    text += M.t('voice.replies.limitWarnOverflow', { current: channel.members.size });
  }

  return ok(interaction, text);
}

// =====================================================================
//  ล็อก / ปลดล็อกห้อง
// =====================================================================

async function lock(interaction, { channel, record }) {
  if (record.isLocked) return fail(interaction, M.t('voice.replies.alreadyLocked'));

  await channel.permissionOverwrites.edit(
    interaction.guild.id,
    { Connect: false },
    { reason: `ล็อกห้องโดยเจ้าของห้อง ${interaction.user.tag}` },
  );

  // คนที่อยู่ในห้องตอนล็อกต้องกลับเข้ามาได้ถ้าหลุดออกไป
  for (const member of channel.members.values()) {
    if (member.id === record.ownerId) continue;
    await channel.permissionOverwrites
      .edit(member.id, { Connect: true }, { reason: 'อยู่ในห้องตอนล็อก' })
      .catch(() => {});
  }

  await repo.updateTempChannel(channel.id, { isLocked: true });

  return ok(interaction, M.t('voice.replies.locked'));
}

async function unlock(interaction, { channel, record }) {
  if (!record.isLocked) return fail(interaction, M.t('voice.replies.notLocked'));

  await channel.permissionOverwrites.edit(
    interaction.guild.id,
    { Connect: null }, // null = กลับไปใช้ค่าที่สืบทอดจาก category
    { reason: `ปลดล็อกห้องโดยเจ้าของห้อง ${interaction.user.tag}` },
  );

  await repo.updateTempChannel(channel.id, { isLocked: false });

  return ok(interaction, M.t('voice.replies.unlocked'));
}

// =====================================================================
//  เตะออกจากห้อง
// =====================================================================

async function kick(interaction, { channel }, { targetUser }) {
  if (targetUser.id === interaction.user.id) {
    return fail(interaction, M.t('voice.replies.kickSelf'));
  }

  if (targetUser.id === interaction.client.user.id) {
    return fail(interaction, 'บอทไม่ได้อยู่ในห้องเสียงนี้');
  }

  const member = await fetchMemberSafe(interaction.guild, targetUser.id);

  if (!member) return fail(interaction, `ไม่พบ <@${targetUser.id}> ในเซิร์ฟเวอร์นี้`);

  if (member.voice?.channelId !== channel.id) {
    return fail(interaction, M.t('voice.replies.kickNotInRoom', { targetMention: `<@${targetUser.id}>` }));
  }

  try {
    await member.voice.disconnect(`เตะออกจากห้องโดยเจ้าของห้อง ${interaction.user.tag}`);
  } catch (err) {
    if (isPermissionError(err)) {
      return fail(
        interaction,
        'บอทเตะสมาชิกออกไม่ได้เพราะสิทธิ์ไม่พอ\n' +
          'กรุณาแจ้งผู้ดูแลให้เปิดสิทธิ์ **ย้ายสมาชิก (Move Members)** ให้บอท',
      );
    }
    throw err;
  }

  return ok(interaction, M.t('voice.replies.kicked', { targetMention: `<@${targetUser.id}>` }));
}

// =====================================================================
//  บล็อก / ปลดบล็อก
// =====================================================================

async function block(interaction, { channel, record }, { targetUser }) {
  const mention = `<@${targetUser.id}>`;

  if (targetUser.id === interaction.user.id) return fail(interaction, M.t('voice.replies.blockSelf'));
  if (targetUser.id === record.ownerId) return fail(interaction, M.t('voice.replies.blockOwner'));
  if (targetUser.id === interaction.client.user.id) return fail(interaction, 'บล็อกบอทไม่ได้');

  const member = await fetchMemberSafe(interaction.guild, targetUser.id);

  if (member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return fail(interaction, M.t('voice.replies.blockAdmin', { targetMention: mention }));
  }

  // ปิดสิทธิ์เข้าห้องก่อน แล้วค่อยบันทึก (ถ้าบันทึกพลาด สิทธิ์ยังกันไว้อยู่)
  await channel.permissionOverwrites.edit(
    targetUser.id,
    { Connect: false, ViewChannel: false },
    { reason: `บล็อกโดยเจ้าของห้อง ${interaction.user.tag}` },
  );

  await repo.blockUser(channel.id, targetUser.id, interaction.user.id);

  // ถ้าอยู่ในห้องอยู่ ให้เตะออกด้วย
  let kicked = false;
  if (member?.voice?.channelId === channel.id) {
    try {
      await member.voice.disconnect(`ถูกบล็อกจากห้องโดย ${interaction.user.tag}`);
      kicked = true;
    } catch (err) {
      console.warn(`⚠️  [voice block] เตะ ${targetUser.id} ออกไม่สำเร็จ: ${err.message}`);
    }
  }

  return ok(
    interaction,
    M.t('voice.replies.blocked', {
      targetMention: mention,
      kickedNote: kicked ? M.t('voice.replies.blockedKickedNote') : '',
    }),
  );
}

async function unblock(interaction, { channel }, { targetUser }) {
  const mention = `<@${targetUser.id}>`;

  const blocked = await repo.isBlocked(channel.id, targetUser.id);

  if (!blocked) return fail(interaction, M.t('voice.replies.notBlocked', { targetMention: mention }));

  await channel.permissionOverwrites
    .delete(targetUser.id, `ยกเลิกการบล็อกโดยเจ้าของห้อง ${interaction.user.tag}`)
    .catch((err) => {
      if (!isGone(err)) throw err;
    });

  await repo.unblockUser(channel.id, targetUser.id);

  return ok(interaction, M.t('voice.replies.unblocked', { targetMention: mention }));
}

// =====================================================================
//  อนุญาตให้เข้าห้องที่ล็อกไว้
// =====================================================================

async function permit(interaction, { channel, record }, { targetUser }) {
  const mention = `<@${targetUser.id}>`;

  if (targetUser.id === record.ownerId) return fail(interaction, M.t('voice.replies.permitOwner'));

  // ถ้าคนนี้ถูกบล็อกไว้ การ permit ต้องยกเลิกการบล็อกด้วย ไม่งั้น 2 สถานะจะขัดกัน
  const wasBlocked = await repo.isBlocked(channel.id, targetUser.id);

  await channel.permissionOverwrites.edit(
    targetUser.id,
    { Connect: true, ViewChannel: true },
    { reason: `อนุญาตโดยเจ้าของห้อง ${interaction.user.tag}` },
  );

  if (wasBlocked) await repo.unblockUser(channel.id, targetUser.id);

  let text = M.t('voice.replies.permitted', { targetMention: mention });
  if (wasBlocked) text += M.t('voice.replies.permittedUnblockNote');
  if (!record.isLocked) text += M.t('voice.replies.permittedNotLockedNote');

  return ok(interaction, text);
}

// =====================================================================
//  ยึดห้อง / โอนห้อง
// =====================================================================

async function claim(interaction, { channel, record }) {
  if (record.ownerId === interaction.user.id) {
    return fail(interaction, M.t('voice.replies.claimAlreadyOwner'));
  }

  if (channel.members.has(record.ownerId)) {
    return fail(
      interaction,
      M.t('voice.replies.claimOwnerPresent', { ownerMention: `<@${record.ownerId}>` }),
    );
  }

  const previousOwnerId = record.ownerId;

  await repo.updateTempChannel(channel.id, { ownerId: interaction.user.id });

  await channel.permissionOverwrites
    .edit(
      interaction.user.id,
      { Connect: true, ViewChannel: true },
      { reason: `ยึดห้องโดย ${interaction.user.tag}` },
    )
    .catch((err) => console.warn(`⚠️  [voice claim] ตั้งสิทธิ์เจ้าของใหม่ไม่สำเร็จ: ${err.message}`));

  await channel
    .send({
      embeds: [
        {
          color: require('../reply').COLORS.success,
          description: M.t('voice.ownership.claimed', {
            newOwnerMention: `<@${interaction.user.id}>`,
            oldOwnerMention: `<@${previousOwnerId}>`,
          }),
        },
      ],
    })
    .catch(() => {});

  // แผงควบคุมต้องอัปเดตให้ชี้เจ้าของใหม่
  await refreshPanel(channel, { ...record, ownerId: interaction.user.id });

  return ok(interaction, M.t('voice.replies.claimSuccess', { roomName: channel.name }));
}

async function transfer(interaction, { channel, record }, { targetUser }) {
  const mention = `<@${targetUser.id}>`;

  if (targetUser.id === record.ownerId) {
    return fail(interaction, M.t('voice.replies.transferAlreadyOwner'));
  }

  if (targetUser.bot) return fail(interaction, M.t('voice.replies.transferToBot'));

  const member = await fetchMemberSafe(interaction.guild, targetUser.id);

  if (!member) return fail(interaction, `ไม่พบ ${mention} ในเซิร์ฟเวอร์นี้`);

  if (member.voice?.channelId !== channel.id) {
    return fail(interaction, M.t('voice.replies.transferTargetNotInRoom', { targetMention: mention }));
  }

  await repo.updateTempChannel(channel.id, { ownerId: targetUser.id });

  await channel.permissionOverwrites
    .edit(
      targetUser.id,
      { Connect: true, ViewChannel: true },
      { reason: `รับโอนห้องจาก ${interaction.user.tag}` },
    )
    .catch((err) => console.warn(`⚠️  [voice transfer] ตั้งสิทธิ์เจ้าของใหม่ไม่สำเร็จ: ${err.message}`));

  await channel
    .send({
      embeds: [
        {
          color: require('../reply').COLORS.success,
          description: M.t('voice.ownership.transferred', {
            fromMention: `<@${interaction.user.id}>`,
            toMention: mention,
          }),
        },
      ],
    })
    .catch(() => {});

  await refreshPanel(channel, { ...record, ownerId: targetUser.id });

  return ok(interaction, M.t('voice.replies.transferred', { targetMention: mention }));
}

// =====================================================================
//  ดูข้อมูลห้อง
// =====================================================================

async function info(interaction, { channel, record }) {
  let blockedIds = [];

  try {
    blockedIds = await repo.listBlockedUsers(channel.id);
  } catch (err) {
    console.warn(`⚠️  [voice info] โหลดรายการบล็อกไม่สำเร็จ: ${err.message}`);
  }

  return safeReply(interaction, {
    embeds: [ui.infoEmbed(channel, record, blockedIds)],
    flags: MessageFlags.Ephemeral,
  });
}

// =====================================================================
//  อัปเดตแผงควบคุมในห้อง
// =====================================================================

/**
 * แก้ไข embed แผงควบคุมให้สะท้อนสถานะปัจจุบัน (ชื่อเจ้าของ / ล็อกอยู่ไหม)
 * ล้มเหลวได้ ไม่ถือว่า action ล้มเหลว เพราะงานหลักบันทึกไปแล้ว
 *
 * @param {import('discord.js').VoiceChannel} channel
 * @param {object} record ข้อมูลห้องล่าสุด
 */
async function refreshPanel(channel, record) {
  try {
    const panel = require('./panel');

    // แผงควบคุมคือข้อความแรกของบอทในห้อง หาโดยดูจาก components
    const messages = await channel.messages.fetch({ limit: 20 });

    const panelMessage = messages.find(
      (m) =>
        m.author.id === channel.client.user.id &&
        m.components?.length > 0 &&
        m.components.some((row) =>
          row.components?.some((c) => String(c.customId ?? '').startsWith('voice:')),
        ),
    );

    if (!panelMessage) return;

    await panelMessage.edit({
      embeds: [panel.panelEmbed(channel, record)],
      components: panel.panelRows(record),
    });
  } catch (err) {
    if (!isGone(err)) console.warn(`⚠️  อัปเดตแผงควบคุมไม่สำเร็จ: ${err.message}`);
  }
}

module.exports = {
  rename,
  setLimit,
  lock,
  unlock,
  kick,
  block,
  unblock,
  permit,
  claim,
  transfer,
  info,
  refreshPanel,
  describeError,
};
