/**
 * lib/messages.js — ตัวโหลดข้อความจาก messages.json
 *
 * แนวคิด: ข้อความทั้งหมดของบอทอยู่ในไฟล์ messages.json แก้ได้โดยไม่ต้องแตะโค้ด
 *
 * การทำงาน:
 *   1. โหลด default จาก lib/messages.defaults.js (ฝังในโค้ด ไม่มีทางหาย)
 *   2. โหลด messages.json แล้ว "ทับทีละคีย์" ลงบน default
 *      -> ในไฟล์ json ใส่เฉพาะคีย์ที่ต้องการเปลี่ยนก็ได้ ไม่ต้องเขียนครบทุกอัน
 *   3. ถ้า messages.json หาย / JSON เสีย -> ใช้ default แล้วเตือนใน console (บอทไม่พัง)
 *
 * ใช้แบบนี้:
 *   const M = require('./lib/messages');
 *   M.t('ticket.panel.title')                                  -> ข้อความตรงๆ
 *   M.t('ticket.welcome.title', { ticketNumber: 7 })            -> แทน {ticketNumber} ด้วย 7
 *   M.t('ticket.panel.description')                             -> array ถูกต่อด้วย \n ให้แล้ว
 *   M.raw('voice.settings.createCooldownSeconds')               -> ค่าที่ไม่ใช่ข้อความ (number/boolean)
 */

const fs = require('node:fs');
const path = require('node:path');

const defaults = require('./messages.defaults');

/** ที่อยู่ไฟล์ messages.json (อยู่ระดับเดียวกับ index.js) */
const MESSAGES_FILE = path.join(__dirname, '..', 'messages.json');

// ---------------------------------------------------------------------
// รวมค่า default กับค่าจากไฟล์
// ---------------------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * รวม object แบบลึก (deep merge) — ค่าจาก override ชนะ default
 * array ถือเป็นค่าเดียว (แทนที่ทั้งก้อน ไม่ต่อกัน) เพราะ array ในที่นี้คือข้อความหลายบรรทัด
 */
function deepMerge(base, override) {
  if (!isPlainObject(override)) return override;

  const out = { ...base };

  for (const [key, value] of Object.entries(override)) {
    // คีย์ที่ขึ้นต้นด้วย _ คือคอมเมนต์ในไฟล์ json ข้ามไป
    if (key.startsWith('_')) continue;

    out[key] = isPlainObject(value) && isPlainObject(base?.[key])
      ? deepMerge(base[key], value)
      : value;
  }

  return out;
}

/** โหลดและรวมข้อความ — ไม่ throw ไม่ว่าจะเกิดอะไร */
function loadMessages() {
  if (!fs.existsSync(MESSAGES_FILE)) {
    console.warn(
      '⚠️  ไม่พบไฟล์ messages.json — ใช้ข้อความเริ่มต้นที่ฝังในโค้ด\n' +
      '   ถ้าต้องการแก้ข้อความ ให้สร้างไฟล์ messages.json ในโฟลเดอร์เดียวกับ index.js',
    );
    return { data: defaults, custom: false, error: null };
  }

  try {
    const text = fs.readFileSync(MESSAGES_FILE, 'utf8');
    const parsed = JSON.parse(text);

    if (!isPlainObject(parsed)) {
      throw new Error('เนื้อหาในไฟล์ต้องเป็น object (เริ่มด้วย { และปิดด้วย })');
    }

    return { data: deepMerge(defaults, parsed), custom: true, error: null };
  } catch (err) {
    // JSON เสีย -> ใช้ default ต่อ แต่บอกให้ชัดว่าผิดบรรทัดไหน
    console.error('');
    console.error(`❌ อ่านไฟล์ messages.json ไม่สำเร็จ: ${err.message}`);
    console.error('   บอทจะใช้ข้อความเริ่มต้นแทน — ข้อความที่แก้ไว้จะไม่มีผลจนกว่าจะแก้ไฟล์ให้ถูก');
    console.error('   เช็คว่าลืมใส่ , หรือ " ที่ไหนไหม (ตรวจได้ที่ https://jsonlint.com)');
    console.error('');
    return { data: defaults, custom: false, error: err.message };
  }
}

let state = loadMessages();

// ---------------------------------------------------------------------
// อ่านค่าและแทนตัวแปร
// ---------------------------------------------------------------------

/**
 * อ่านค่าจาก path แบบจุด เช่น 'ticket.panel.title'
 * @returns {any} undefined ถ้าไม่พบ
 */
function getByPath(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * แทนตัวแปร {ชื่อ} ในข้อความด้วยค่าที่ส่งมา
 * ตัวแปรที่ไม่ได้ส่งค่ามาจะถูกลบทิ้ง (ไม่ปล่อยให้ผู้ใช้เห็น {xxx} ค้าง)
 */
function interpolate(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars?.[name];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * อ่านข้อความ พร้อมแทนตัวแปร
 *
 * @param {string} dotPath เช่น 'ticket.welcome.title'
 * @param {object} [vars] ค่าตัวแปร เช่น { ticketNumber: 7 }
 * @returns {string} array จะถูกต่อด้วยการขึ้นบรรทัดใหม่
 */
function t(dotPath, vars) {
  let value = getByPath(state.data, dotPath);

  // ถ้าไฟล์ผู้ใช้ลบคีย์นี้ทิ้ง ให้ย้อนไปหา default
  if (value === undefined) {
    value = getByPath(defaults, dotPath);

    if (value === undefined) {
      console.warn(`⚠️  ไม่พบข้อความ "${dotPath}" ทั้งใน messages.json และค่าเริ่มต้น`);
      return '';
    }
  }

  if (Array.isArray(value)) {
    return value.map((line) => interpolate(line, vars)).join('\n');
  }

  return interpolate(value, vars);
}

/**
 * อ่านค่าดิบ (ไม่แทนตัวแปร ไม่แปลง array)
 * ใช้กับค่าที่ไม่ใช่ข้อความ เช่น ตัวเลข boolean
 *
 * @param {string} dotPath
 * @param {any} [fallback] ค่าสำรองถ้าไม่พบ
 */
function raw(dotPath, fallback = undefined) {
  const value = getByPath(state.data, dotPath);
  if (value !== undefined) return value;

  const def = getByPath(defaults, dotPath);
  return def !== undefined ? def : fallback;
}

/**
 * อ่านตัวเลข พร้อมจำกัดช่วง — กันคนใส่ค่าเพี้ยนใน json แล้วบอทพัง
 *
 * @param {string} dotPath
 * @param {{min?: number, max?: number}} [range]
 */
function num(dotPath, range = {}) {
  const fallback = Number(getByPath(defaults, dotPath) ?? 0);
  const value = Number(raw(dotPath));

  if (!Number.isFinite(value)) {
    console.warn(`⚠️  ค่า "${dotPath}" ในไฟล์ messages.json ไม่ใช่ตัวเลข — ใช้ค่าเริ่มต้น ${fallback}`);
    return fallback;
  }

  const { min, max } = range;

  if (min !== undefined && value < min) {
    console.warn(`⚠️  ค่า "${dotPath}" น้อยกว่า ${min} — ปรับเป็น ${min}`);
    return min;
  }
  if (max !== undefined && value > max) {
    console.warn(`⚠️  ค่า "${dotPath}" มากกว่า ${max} — ปรับเป็น ${max}`);
    return max;
  }

  return value;
}

/**
 * โหลดไฟล์ใหม่ระหว่างที่บอทกำลังทำงาน (ไม่ต้องรีสตาร์ท)
 * @returns {{ ok: boolean, custom: boolean, error: string|null }}
 */
function reload() {
  state = loadMessages();
  return { ok: !state.error, custom: state.custom, error: state.error };
}

/** สถานะการโหลด — index.js ใช้แสดงตอนเริ่มทำงาน */
function status() {
  if (state.error) return { ok: false, label: `messages.json มีปัญหา (${state.error})` };
  if (state.custom) return { ok: true, label: 'โหลดข้อความจาก messages.json' };
  return { ok: true, label: 'ใช้ข้อความเริ่มต้น (ไม่พบ messages.json)' };
}

module.exports = { t, raw, num, reload, status, MESSAGES_FILE };
