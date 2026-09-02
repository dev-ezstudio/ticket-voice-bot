/**
 * events/voice/channelDelete.js — เก็บกวาดเมื่อห้องเสียงชั่วคราวถูกลบด้วยมือ
 *
 * ปัญหาที่แก้: ถ้าแอดมินลบห้องเสียงชั่วคราวเองผ่าน Discord UI
 * event voiceStateUpdate จะไม่ยิง (ไม่มีใครออกจากห้อง — ห้องหายไปเลย)
 * ทำให้ข้อมูลใน temp_channels ค้างอยู่ตลอด
 *
 * ไฟล์นี้ดักการลบห้องแล้วเคลียร์ข้อมูลให้
 */

const { ChannelType, Events } = require('discord.js');

const repo = require('../../lib/voice/repo');
const selfDeleted = require('../../lib/voice/selfDeleted');

module.exports = {
  name: Events.ChannelDelete,
  system: 'voice',

  /**
   * @param {import('discord.js').GuildChannel} channel
   */
  async execute(channel) {
    // สนใจเฉพาะห้องเสียงในเซิร์ฟเวอร์
    if (channel.type !== ChannelType.GuildVoice) return;

    // บอทลบห้องนี้เองหรือเปล่า? ถ้าใช่ ข้อมูลถูกเคลียร์ไปแล้ว ไม่ต้องทำซ้ำ
    if (selfDeleted.consume(channel.id)) return;

    try {
      const record = await repo.getTempChannel(channel.id);

      if (!record) return; // ไม่ใช่ห้องชั่วคราว

      // blocked_users ถูกลบตามอัตโนมัติด้วย ON DELETE CASCADE
      await repo.deleteTempChannel(channel.id);

      console.log(
        `🗑️  [voice] ห้อง "${record.name ?? channel.name}" (${channel.id}) ถูกลบด้วยมือ — เคลียร์ข้อมูลในฐานข้อมูลแล้ว`,
      );
    } catch (err) {
      // ล้มเหลวได้ ไม่ร้ายแรง เพราะรอบเก็บกวาดตอนบอทเริ่มทำงานจะจัดการให้
      console.error(`❌ [voice] เคลียร์ข้อมูลห้องที่ถูกลบ ${channel.id} ไม่สำเร็จ:`, err);
    }
  },
};
