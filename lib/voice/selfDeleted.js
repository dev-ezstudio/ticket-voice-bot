/**
 * lib/voice/selfDeleted.js — จำห้องที่ "บอทลบเอง"
 *
 * ปัญหาที่แก้:
 *   เมื่อบอทลบห้องว่างเอง (voiceStateUpdate) event channelDelete จะยิงตามมาด้วย
 *   ทำให้ channelDelete เข้าใจผิดว่า "มีคนลบห้องด้วยมือ" แล้ว
 *     - log ข้อความผิดความจริง
 *     - ยิง query ลบข้อมูลซ้ำอีกครั้งโดยไม่จำเป็น
 *
 *   จึงให้ voiceStateUpdate ทำเครื่องหมายไว้ก่อนลบ แล้ว channelDelete ข้ามห้องนั้นไป
 *
 * เครื่องหมายจะหมดอายุเองใน 15 วินาที เพื่อไม่ให้ Set โตไม่จำกัด
 * และเผื่อกรณี event ไม่ยิง (บอทดับกลางทาง)
 */

/** channel id ที่บอทกำลังลบเอง */
const ids = new Set();

/** เครื่องหมายอยู่ได้นานเท่าไร (มิลลิวินาที) */
const TTL_MS = 15_000;

/**
 * ทำเครื่องหมายว่าบอทลบห้องนี้เอง — เรียกก่อนสั่งลบห้อง
 * @param {string} channelId
 */
function mark(channelId) {
  if (!channelId) return;

  ids.add(channelId);
  setTimeout(() => ids.delete(channelId), TTL_MS).unref?.();
}

/**
 * ตรวจและล้างเครื่องหมายในครั้งเดียว (consume)
 * คืน true = บอทลบเอง ไม่ต้องเก็บกวาดซ้ำ
 * @param {string} channelId
 */
function consume(channelId) {
  if (!ids.has(channelId)) return false;

  ids.delete(channelId);
  return true;
}

module.exports = { mark, consume };
