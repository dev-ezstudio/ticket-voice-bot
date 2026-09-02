/**
 * events/core/ready.js — ทำงานครั้งเดียวเมื่อบอทเชื่อมต่อ Discord สำเร็จ
 *
 * หน้าที่:
 *   1. แสดงสรุปสถานะบอท
 *   2. เก็บกวาดข้อมูลค้างของทั้ง 2 ระบบ (sync ฐานข้อมูลกับสภาพจริงบน Discord)
 *
 * ทำไมต้องเก็บกวาด: ระหว่างที่บอทออฟไลน์ อาจมีคนลบห้องตั๋ว/ห้องเสียงไป
 * ฐานข้อมูลจึงเหลือแถวที่ชี้ไปยังห้องที่ไม่มีอยู่แล้ว
 */

const { Events, ActivityType } = require('discord.js');

const ticketRepo = require('../../lib/ticket/repo');
const voiceRepo = require('../../lib/voice/repo');
const { fetchChannelSafe, deleteChannelSafe } = require('../../lib/discordUtils');
const M = require('../../lib/messages');
const selfDeleted = require('../../lib/voice/selfDeleted');

/**
 * เก็บกวาดข้อมูลตั๋วค้าง — ตั๋วที่สถานะ open แต่ห้องถูกลบไปแล้ว
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<number>} จำนวนตั๋วที่ปิดให้
 */
async function cleanupTickets(guild) {
  let cleaned = 0;

  const tickets = await ticketRepo.listOpenTickets(guild.id);

  for (const ticket of tickets) {
    const channel = await fetchChannelSafe(guild, ticket.channelId);

    if (channel) continue; // ห้องยังอยู่ ไม่ต้องทำอะไร

    try {
      await ticketRepo.closeTicket(ticket.channelId, {
        closedBy: null,
        reason: 'ห้องถูกลบระหว่างบอทออฟไลน์ ระบบปิดให้อัตโนมัติ',
      });
      cleaned += 1;
    } catch (err) {
      console.error(`   ❌ ปิดตั๋วค้าง ${ticket.channelId} ไม่สำเร็จ: ${err.message}`);
    }
  }

  return cleaned;
}

/**
 * เก็บกวาดห้องเสียงชั่วคราว 2 กรณี:
 *   1. ข้อมูลค้าง — ห้องถูกลบไปแล้วแต่แถวยังอยู่
 *   2. ห้องค้าง — ห้องยังอยู่แต่ไม่มีคนอยู่ (คนออกไปหมดตอนบอทออฟไลน์)
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{staleRows: number, emptyRooms: number}>}
 */
async function cleanupVoiceChannels(guild) {
  const records = await voiceRepo.listTempChannels(guild.id);

  const staleIds = [];
  let emptyRooms = 0;

  for (const record of records) {
    const channel = await fetchChannelSafe(guild, record.channelId);

    if (!channel) {
      staleIds.push(record.channelId);
      continue;
    }

    // ห้องยังอยู่แต่ว่างเปล่า -> ลบทิ้ง (ตรงตามกฎ "ห้องว่าง = ลบ")
    if (channel.members.size === 0) {
      selfDeleted.mark(channel.id);
      const deleted = await deleteChannelSafe(channel, 'ห้องเสียงชั่วคราวว่างเปล่าตอนบอทเริ่มทำงาน');

      if (deleted) {
        staleIds.push(record.channelId);
        emptyRooms += 1;
      }
    }
  }

  if (staleIds.length > 0) {
    try {
      // blocked_users ถูกลบตามอัตโนมัติด้วย ON DELETE CASCADE
      await voiceRepo.deleteTempChannels(staleIds);
    } catch (err) {
      console.error(`   ❌ ลบข้อมูลห้องเสียงค้างไม่สำเร็จ: ${err.message}`);
      return { staleRows: 0, emptyRooms };
    }
  }

  return { staleRows: staleIds.length - emptyRooms, emptyRooms };
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  system: 'core',

  /**
   * @param {import('discord.js').Client} client
   */
  async execute(client) {
    console.log('');
    console.log('═'.repeat(62));
    console.log(`  ✅ บอทออนไลน์แล้ว: ${client.user.tag}`);
    console.log(`     รหัสบอท      : ${client.user.id}`);
    console.log(`     เซิร์ฟเวอร์   : ${client.guilds.cache.size} เซิร์ฟเวอร์`);
    console.log(`     คำสั่งที่โหลด : ${client.commands.size} คำสั่ง`);
    console.log('═'.repeat(62));

    // ----- ตั้งสถานะบอท -----
    try {
      const TYPES = {
        playing: ActivityType.Playing,
        watching: ActivityType.Watching,
        listening: ActivityType.Listening,
        competing: ActivityType.Competing,
      };

      client.user.setPresence({
        status: 'online',
        activities: [{
          name: M.t('common.presence.text'),
          type: TYPES[String(M.raw('common.presence.type', 'watching')).toLowerCase()] ?? ActivityType.Watching,
        }],
      });
    } catch (err) {
      console.warn(`⚠️  ตั้งสถานะบอทไม่สำเร็จ: ${err.message}`);
    }

    // ----- เก็บกวาดข้อมูลค้างทีละเซิร์ฟเวอร์ -----
    console.log('');
    console.log('🧹 เริ่มเก็บกวาดข้อมูลค้าง...');

    let totalTickets = 0;
    let totalStaleRows = 0;
    let totalEmptyRooms = 0;

    for (const guild of client.guilds.cache.values()) {
      // ระบบตั๋ว
      try {
        const closed = await cleanupTickets(guild);
        totalTickets += closed;

        if (closed > 0) {
          console.log(`   🎫 ${guild.name}: ปิดตั๋วค้าง ${closed} ใบ`);
        }
      } catch (err) {
        console.error(`   ❌ [ticket] เก็บกวาดใน ${guild.name} ไม่สำเร็จ: ${err.message}`);
      }

      // ระบบห้องเสียง
      try {
        const { staleRows, emptyRooms } = await cleanupVoiceChannels(guild);
        totalStaleRows += staleRows;
        totalEmptyRooms += emptyRooms;

        if (staleRows > 0 || emptyRooms > 0) {
          console.log(
            `   🎙️ ${guild.name}: ลบห้องว่าง ${emptyRooms} ห้อง, เคลียร์ข้อมูลค้าง ${staleRows} รายการ`,
          );
        }
      } catch (err) {
        console.error(`   ❌ [voice] เก็บกวาดใน ${guild.name} ไม่สำเร็จ: ${err.message}`);
      }
    }

    if (totalTickets === 0 && totalStaleRows === 0 && totalEmptyRooms === 0) {
      console.log('   ✨ ไม่มีข้อมูลค้าง ทุกอย่างเรียบร้อย');
    } else {
      console.log(
        `   ✅ เสร็จสิ้น — ตั๋ว ${totalTickets} ใบ, ห้องว่าง ${totalEmptyRooms} ห้อง, ข้อมูลค้าง ${totalStaleRows} รายการ`,
      );
    }

    console.log('');
    console.log('🚀 บอทพร้อมใช้งาน');
    console.log('');
  },
};
