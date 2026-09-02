/**
 * events/voice/voiceStateUpdate.js — หัวใจของระบบห้องเสียงชั่วคราว
 *
 * event นี้ยิงทุกครั้งที่มีคนเข้า/ออก/ย้ายห้องเสียง หรือปิดไมค์ หน้าที่ของเรามี 2 อย่าง:
 *
 *   1. มีคนเข้าห้อง creator  -> สร้างห้องใหม่ให้ + ย้ายเข้าไปทันที
 *   2. ห้องชั่วคราวว่างเปล่า -> ลบห้องและลบข้อมูลออกจากฐานข้อมูล
 *
 * ระวังเรื่อง race condition:
 *   - Discord ยิง event ซ้อนกันได้ (คนเข้า-ออกรัวๆ) จึงต้องกันด้วย Set
 *   - ห้องอาจถูกลบไปแล้วตอนที่เรากำลังจะลบ -> ใช้ deleteChannelSafe
 *   - คนอาจออกจากห้องก่อนบอทย้ายเสร็จ -> ตรวจ voice state ใหม่ก่อนย้าย
 */

const { ChannelType, Events, PermissionFlagsBits } = require('discord.js');

const repo = require('../../lib/voice/repo');
const panel = require('../../lib/voice/panel');
const selfDeleted = require('../../lib/voice/selfDeleted');
const M = require('../../lib/messages');
const {
  sanitizeChannelName,
  deleteChannelSafe,
  isGone,
  isPermissionError,
} = require('../../lib/discordUtils');
const { DatabaseError } = require('../../supabase');

/** กัน race: user id ที่กำลังสร้างห้องอยู่ (กันคนกดเข้า-ออกรัวๆ ได้หลายห้อง) */
const creating = new Set();

/** กัน race: channel id ที่กำลังลบอยู่ (กันลบซ้อน) */
const deleting = new Set();

/** ตัวนับกันสร้างห้องถี่เกินไป: user id -> เวลาที่สร้างครั้งล่าสุด */
const lastCreated = new Map();

/**
 * เว้นระยะขั้นต่ำระหว่างการสร้างห้อง 2 ครั้งของคนเดียวกัน (มิลลิวินาที)
 * ตั้งค่าได้ที่ messages.json -> voice.settings.createCooldownSeconds
 */
function cooldownMs() {
  return M.num('voice.settings.createCooldownSeconds', { min: 0, max: 300 }) * 1000;
}

/** ล้าง lastCreated ที่เก่าเกินไป กันไม่ให้ Map โตไม่จำกัด */
function pruneCooldowns() {
  const cutoff = Date.now() - Math.max(cooldownMs(), 10_000) * 6;
  for (const [userId, at] of lastCreated) {
    if (at < cutoff) lastCreated.delete(userId);
  }
}

// =====================================================================
//  สร้างห้องใหม่
// =====================================================================

/**
 * @param {import('discord.js').VoiceState} state voice state ใหม่ (หลังเข้าห้อง creator)
 * @param {object} settings การตั้งค่าระบบห้องเสียงของเซิร์ฟเวอร์
 */
async function createRoomFor(state, settings) {
  const member = state.member;
  const guild = state.guild;

  if (!member) return;

  // ----- กันสร้างซ้อน -----
  if (creating.has(member.id)) {
    console.log(`⏭️  [voice] ${member.user.tag} กำลังสร้างห้องอยู่แล้ว ข้าม event นี้`);
    return;
  }

  // ----- กันสร้างถี่เกินไป -----
  const last = lastCreated.get(member.id);

  const cd = cooldownMs();

  if (cd > 0 && last && Date.now() - last < cd) {
    const waitSec = Math.ceil((cd - (Date.now() - last)) / 1000);

    // เตะออกจากห้อง creator เพื่อไม่ให้ค้างอยู่ในนั้น
    await member.voice.disconnect('สร้างห้องถี่เกินไป').catch(() => {});

    await member
      .send(
        M.t('voice.dm.cooldown', {
          seconds: waitSec,
          creatorChannelName: M.t('voice.setup.creatorChannelName'),
        }),
      )
      .catch(() => {}); // ปิด DM ไว้ก็ปล่อยไป

    return;
  }

  creating.add(member.id);

  try {
    // ----- ตรวจ category -----
    const category = guild.channels.cache.get(settings.categoryId)
      ?? await guild.channels.fetch(settings.categoryId).catch(() => null);

    if (!category || category.type !== ChannelType.GuildCategory) {
      console.warn(`⚠️  [voice] หมวด ${settings.categoryId} ไม่มีอยู่แล้ว`);

      await member.voice.disconnect('หมวดห้องเสียงถูกลบไปแล้ว').catch(() => {});
      await member
        .send(
          '❌ สร้างห้องเสียงไม่ได้ เพราะหมวดห้องเสียงถูกลบไปแล้ว\n' +
            'กรุณาแจ้งผู้ดูแลให้ตั้งค่าใหม่ด้วยคำสั่ง `/setup-voice`',
        )
        .catch(() => {});
      return;
    }

    // ----- ตรวจว่าหมวดยังใส่ห้องได้ (Discord จำกัด 50 ห้องต่อหมวด) -----
    const childCount = guild.channels.cache.filter((ch) => ch.parentId === category.id).size;

    if (childCount >= 50) {
      await member.voice.disconnect('หมวดห้องเสียงเต็ม').catch(() => {});
      await member
        .send(
          '❌ สร้างห้องเสียงไม่ได้ เพราะหมวดห้องเสียงมีห้องครบ 50 ห้องแล้ว (ขีดจำกัดของ Discord)\n' +
            'กรุณารอให้ห้องอื่นว่างและถูกลบก่อน',
        )
        .catch(() => {});
      return;
    }

    // ----- สร้างห้อง -----
    const roomName = sanitizeChannelName(
      M.t('voice.roomName', { displayName: member.displayName }),
      M.t('voice.roomName', { displayName: member.user.username }),
    );

    let channel;

    try {
      channel = await guild.channels.create({
        name: roomName,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: `ห้องเสียงชั่วคราวของ ${member.user.tag}`,
        permissionOverwrites: [
          {
            // เจ้าของห้อง — ให้สิทธิ์จัดการห้องตัวเองผ่าน UI ของ Discord ได้ด้วย
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.Stream,
              PermissionFlagsBits.UseVAD,
            ],
          },
          {
            id: guild.members.me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
        ],
      });
    } catch (err) {
      console.error(`❌ [voice] สร้างห้องให้ ${member.user.tag} ไม่สำเร็จ:`, err);

      await member.voice.disconnect('สร้างห้องไม่สำเร็จ').catch(() => {});

      await member
        .send(
          isPermissionError(err)
            ? '❌ บอทสร้างห้องเสียงไม่ได้เพราะสิทธิ์ไม่พอ\n' +
                'กรุณาแจ้งผู้ดูแลให้เปิดสิทธิ์ **จัดการห้อง (Manage Channels)** ให้บอท'
            : `❌ สร้างห้องเสียงไม่สำเร็จ: ${err.message}`,
        )
        .catch(() => {});

      return;
    }

    // ----- บันทึกลงฐานข้อมูล -----
    try {
      await repo.createTempChannel({
        channelId: channel.id,
        guildId: guild.id,
        ownerId: member.id,
        name: roomName,
      });
    } catch (err) {
      // บันทึกไม่ได้ -> ลบห้องคืน ไม่ให้เหลือห้องผีที่ไม่มีใครลบและแผงควบคุมใช้ไม่ได้
      console.error(`❌ [voice] บันทึกห้อง ${channel.id} ไม่สำเร็จ ลบห้องคืน:`, err);

      selfDeleted.mark(channel.id);
      await deleteChannelSafe(channel, 'บันทึกข้อมูลห้องลงฐานข้อมูลไม่สำเร็จ');
      await member.voice.disconnect('บันทึกข้อมูลห้องไม่สำเร็จ').catch(() => {});

      await member
        .send(
          `❌ ${err instanceof DatabaseError ? err.userMessage : err.message}\n\n` +
            'บอทลบห้องที่สร้างค้างไว้แล้ว กรุณาลองเข้าห้อง **➕ สร้างห้องของคุณ** อีกครั้ง',
        )
        .catch(() => {});

      return;
    }

    lastCreated.set(member.id, Date.now());
    pruneCooldowns();

    // ----- ย้ายผู้ใช้เข้าห้องใหม่ -----
    // ตรวจก่อนว่ายังอยู่ในห้อง creator ไหม (อาจออกไปแล้วระหว่างบอทสร้างห้อง)
    const fresh = guild.members.cache.get(member.id)?.voice;

    if (!fresh?.channelId) {
      // ออกจากห้องเสียงไปแล้ว -> ห้องที่สร้างไว้ไม่มีใครใช้ ลบทิ้งเลย
      console.log(`⏭️  [voice] ${member.user.tag} ออกจากห้องเสียงก่อนบอทย้ายเสร็จ ลบห้องที่สร้างไว้`);

      selfDeleted.mark(channel.id);
      await deleteChannelSafe(channel, 'ผู้สร้างออกจากห้องเสียงก่อนถูกย้าย');
      await repo.deleteTempChannel(channel.id).catch(() => {});
      return;
    }

    try {
      await member.voice.setChannel(channel, 'ย้ายเข้าห้องเสียงชั่วคราวที่สร้างใหม่');
    } catch (err) {
      console.error(`❌ [voice] ย้าย ${member.user.tag} เข้าห้องใหม่ไม่สำเร็จ:`, err);

      // ย้ายไม่ได้ = ห้องที่สร้างไว้ไม่มีคนอยู่ จะถูกลบทันทีโดย logic ห้องว่าง
      // จึงลบเองเลยเพื่อไม่ต้องรอ และแจ้งผู้ใช้ให้กดเข้าเอง
      selfDeleted.mark(channel.id);
      await deleteChannelSafe(channel, 'ย้ายผู้ใช้เข้าห้องใหม่ไม่สำเร็จ');
      await repo.deleteTempChannel(channel.id).catch(() => {});

      await member
        .send(
          isPermissionError(err)
            ? '❌ บอทย้ายคุณเข้าห้องใหม่ไม่ได้เพราะสิทธิ์ไม่พอ\n' +
                'กรุณาแจ้งผู้ดูแลให้เปิดสิทธิ์ **ย้ายสมาชิก (Move Members)** ให้บอท'
            : `❌ ย้ายคุณเข้าห้องใหม่ไม่สำเร็จ: ${err.message}`,
        )
        .catch(() => {});

      return;
    }

    console.log(`✅ [voice] สร้างห้อง "${roomName}" (${channel.id}) ให้ ${member.user.tag}`);

    // ----- ส่งแผงควบคุมแบบปุ่มกดเข้าแชทของห้องเสียง (ล้มเหลวได้ ไม่สำคัญ) -----
    // ห้องเสียงของ Discord มีช่องแชทในตัว ส่งข้อความเข้าไปได้
    // แผงนี้ให้เจ้าของกดปุ่มตั้งค่าได้เลย ไม่ต้องพิมพ์คำสั่ง /voice
    try {
      const record = await repo.getTempChannel(channel.id);

      const panelMessage = await channel.send({
        embeds: [panel.panelEmbed(channel, record ?? {
          ownerId: member.id,
          isLocked: false,
          userLimit: 0,
          createdAt: new Date().toISOString(),
        })],
        components: panel.panelRows(record ?? { isLocked: false }),
      });

      // ปักหมุดไว้ให้หาง่ายเมื่อคุยกันยาว (ล้มเหลวได้ ไม่สำคัญ)
      await panelMessage.pin().catch(() => {});
    } catch (err) {
      if (!isGone(err) && !isPermissionError(err)) {
        console.warn(`⚠️  [voice] ส่งแผงควบคุมไม่สำเร็จ: ${err.message}`);
      }
    }
  } finally {
    creating.delete(member.id);
  }
}

// =====================================================================
//  ลบห้องว่าง
// =====================================================================

/**
 * ตรวจว่าห้องที่คนเพิ่งออกไปเป็นห้องชั่วคราวที่ว่างแล้วหรือไม่ ถ้าใช่ให้ลบ
 * @param {import('discord.js').VoiceState} state voice state เก่า (ห้องที่ออกจากมา)
 */
async function cleanupIfEmpty(state) {
  const channel = state.channel;

  if (!channel || channel.type !== ChannelType.GuildVoice) return;

  // ยังมีคนอยู่ -> ไม่ทำอะไร
  if (channel.members.size > 0) return;

  // กันลบซ้อน
  if (deleting.has(channel.id)) return;

  deleting.add(channel.id);

  try {
    // ----- เช็คว่าเป็นห้องชั่วคราวที่บอทดูแลจริงไหม -----
    let record;

    try {
      record = await repo.getTempChannel(channel.id);
    } catch (err) {
      console.error(`❌ [voice] อ่านข้อมูลห้อง ${channel.id} ไม่สำเร็จ ไม่ลบห้องเพื่อความปลอดภัย:`, err);
      return; // อ่านฐานข้อมูลไม่ได้ -> ไม่ลบ ดีกว่าลบห้องที่ไม่ใช่ของเรา
    }

    if (!record) return; // ไม่ใช่ห้องชั่วคราว (เช่นห้องเสียงปกติของเซิร์ฟเวอร์)

    // ----- เช็คอีกครั้งว่ายังว่างจริง (อาจมีคนเข้ามาระหว่างที่เรา query ฐานข้อมูล) -----
    const latest = state.guild.channels.cache.get(channel.id);

    if (latest && latest.members.size > 0) {
      console.log(`⏭️  [voice] ห้อง ${channel.id} มีคนเข้ามาใหม่ ยกเลิกการลบ`);
      return;
    }

    // ----- ลบห้อง -----
    // ทำเครื่องหมายก่อนลบ เพื่อให้ channelDelete รู้ว่าบอทลบเอง ไม่ใช่คนลบด้วยมือ
    selfDeleted.mark(channel.id);

    const deleted = await deleteChannelSafe(channel, 'ห้องเสียงชั่วคราวว่างเปล่า');

    // ----- ลบข้อมูลออกจากฐานข้อมูล -----
    // ทำแม้ลบห้องไม่สำเร็จก็ตาม เฉพาะกรณีที่ห้องหายไปแล้วจริง
    if (deleted) {
      try {
        // blocked_users ถูกลบตามอัตโนมัติด้วย ON DELETE CASCADE
        await repo.deleteTempChannel(channel.id);
        console.log(`🗑️  [voice] ลบห้องว่าง "${record.name ?? channel.name}" (${channel.id}) แล้ว`);
      } catch (err) {
        // ห้องหายแล้วแต่ข้อมูลค้าง -> ไม่ร้ายแรง เพราะรอบเก็บกวาดตอนบอทเริ่มจะจัดการให้
        console.error(`❌ [voice] ลบข้อมูลห้อง ${channel.id} ออกจากฐานข้อมูลไม่สำเร็จ:`, err);
      }
    } else {
      console.warn(`⚠️  [voice] ลบห้อง ${channel.id} ไม่ได้เพราะสิทธิ์ไม่พอ — ข้อมูลยังคงอยู่ในฐานข้อมูล`);
    }
  } finally {
    deleting.delete(channel.id);
  }
}

// =====================================================================
//  ตัวจัดการ event
// =====================================================================

module.exports = {
  name: Events.VoiceStateUpdate,
  system: 'voice',

  /**
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   */
  async execute(oldState, newState) {
    const guild = newState.guild ?? oldState.guild;

    if (!guild) return;

    // ปิดไมค์/เปิดกล้อง = ห้องไม่เปลี่ยน ไม่เกี่ยวกับเรา ออกก่อนเพื่อไม่ยิง query ฐานข้อมูลฟรี
    if (oldState.channelId === newState.channelId) return;

    // ----- โหลดการตั้งค่า (ครั้งเดียวต่อ event) -----
    let settings;

    try {
      settings = await repo.getSettings(guild.id);
    } catch (err) {
      console.error(`❌ [voice] โหลดการตั้งค่าของเซิร์ฟเวอร์ ${guild.id} ไม่สำเร็จ:`, err);
      return; // ฐานข้อมูลล่ม -> ไม่ทำอะไร ดีกว่าเดา
    }

    if (!settings) return; // เซิร์ฟเวอร์นี้ยังไม่ได้ตั้งค่าระบบห้องเสียง

    // ----- 1) เข้าห้อง creator -> สร้างห้องใหม่ -----
    if (newState.channelId === settings.creatorChannelId) {
      try {
        await createRoomFor(newState, settings);
      } catch (err) {
        console.error('❌ [voice] createRoomFor ผิดพลาดที่ไม่คาดคิด:', err);
      }
    }

    // ----- 2) ออกจากห้องเก่า -> ตรวจว่าว่างแล้วลบ -----
    // ทำหลังข้อ 1 เสมอ เพราะการย้ายคนเข้าห้องใหม่ทำให้ห้อง creator ว่าง
    // (แต่ห้อง creator ไม่ได้อยู่ในตาราง temp_channels จึงไม่ถูกลบ)
    if (oldState.channelId && oldState.channelId !== settings.creatorChannelId) {
      try {
        await cleanupIfEmpty(oldState);
      } catch (err) {
        console.error('❌ [voice] cleanupIfEmpty ผิดพลาดที่ไม่คาดคิด:', err);
      }
    }
  },
};
