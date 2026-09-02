/**
 * events/ticket/channelDelete.js — เก็บกวาดเมื่อห้องตั๋วถูกลบด้วยมือ
 *
 * ถ้าแอดมินลบห้องตั๋วเองโดยไม่กดปุ่ม "ปิดตั๋ว" ข้อมูลใน tickets จะยังเป็น open
 * ผลเสีย: unique index กันคนนั้นเปิดตั๋วใบใหม่ตลอดไป
 *
 * ไฟล์นี้ดักการลบห้องแล้วปิดตั๋วในฐานข้อมูลให้
 */

const { ChannelType, Events } = require('discord.js');

const repo = require('../../lib/ticket/repo');

module.exports = {
  name: Events.ChannelDelete,
  system: 'ticket',

  /**
   * @param {import('discord.js').GuildChannel} channel
   */
  async execute(channel) {
    // สนใจเฉพาะห้องข้อความในเซิร์ฟเวอร์
    if (channel.type !== ChannelType.GuildText) return;

    try {
      const ticket = await repo.getTicketByChannel(channel.id);

      if (!ticket || ticket.status === 'closed') return;

      await repo.closeTicket(channel.id, {
        closedBy: null,
        reason: 'ห้องถูกลบด้วยมือโดยไม่ผ่านปุ่มปิดตั๋ว',
      });

      console.log(
        `🗑️  [ticket] ห้องตั๋ว #${ticket.ticketNumber ?? '-'} (${channel.id}) ถูกลบด้วยมือ — ปิดตั๋วในฐานข้อมูลแล้ว`,
      );
    } catch (err) {
      console.error(`❌ [ticket] ปิดตั๋วของห้องที่ถูกลบ ${channel.id} ไม่สำเร็จ:`, err);
    }
  },
};
