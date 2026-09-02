/**
 * lib/ticket/guards.js — ตรวจสิทธิ์ของระบบตั๋ว
 *
 * ระบบตั๋วมีสิทธิ์ 3 ระดับ:
 *   1. ผู้ใช้ทั่วไป — เปิดตั๋วได้ ปิดตั๋วของตัวเองได้
 *   2. ทีมงาน (staff) — เห็นทุกตั๋ว รับเรื่อง ปิดตั๋วได้
 *   3. แอดมินใหญ่ (admin) — ทำได้ทุกอย่าง + เห็นหน้าแอดมิน + ตั้งค่าระบบ
 *
 * แยกไฟล์นี้ออกมาเพื่อให้ทุก handler ใช้กฎเดียวกัน
 * ถ้าเขียนเช็คซ้ำในแต่ละที่ จะมีที่ที่ลืมอัปเดตเมื่อกฎเปลี่ยน
 */

const { PermissionFlagsBits } = require('discord.js');

const M = require('../messages');

/**
 * เป็นทีมงานไหม (staff หรือสูงกว่า)
 * @param {import('discord.js').GuildMember} member
 * @param {object|null} settings
 */
function isStaff(member, settings) {
  if (!member) return false;

  // แอดมินใหญ่ถือว่าเป็นทีมงานด้วย (สิทธิ์ครอบลงมา)
  if (isAdmin(member, settings)) return true;

  return Boolean(settings?.staffRoleId && member.roles.cache.has(settings.staffRoleId));
}

/**
 * เป็นแอดมินใหญ่ไหม
 *
 * ถือเป็นแอดมินใหญ่เมื่อ:
 *   - มียศที่ตั้งไว้ใน adminRoleId  หรือ
 *   - มีสิทธิ์ Administrator ของ Discord (เจ้าของเซิร์ฟเวอร์เข้าข่ายนี้)
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object|null} settings
 */
function isAdmin(member, settings) {
  if (!member) return false;

  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  return Boolean(settings?.adminRoleId && member.roles.cache.has(settings.adminRoleId));
}

/**
 * ระดับสิทธิ์เป็นข้อความ ใช้ในข้อความแจ้งผู้ใช้
 * @returns {'admin'|'staff'|'user'}
 */
function levelOf(member, settings) {
  if (isAdmin(member, settings)) return 'admin';
  if (isStaff(member, settings)) return 'staff';
  return 'user';
}

/**
 * ข้อความปฏิเสธเมื่อสิทธิ์ไม่ถึง
 * @param {'staff'|'admin'} required
 * @param {object|null} settings
 */
function denyMessage(required, settings) {
  if (required === 'admin') {
    return M.t('ticket.panelReplies.denyAdmin', {
      roleMention: settings?.adminRoleId
        ? ` (<@&${settings.adminRoleId}>)`
        : M.t('ticket.panelReplies.denyAdminFallback'),
    });
  }

  return M.t('ticket.panelReplies.denyStaff', {
    roleMention: settings?.staffRoleId ? ` (<@&${settings.staffRoleId}>)` : '',
  });
}

module.exports = { isStaff, isAdmin, levelOf, denyMessage };
