/**
 * supabase.js — การเชื่อมต่อ Supabase ที่ใช้ร่วมกันทั้ง 2 ระบบ (ตั๋ว + ห้องเสียง)
 *
 * ไฟล์นี้เป็น "ส่วนกลาง" ห้ามใส่ logic ของระบบใดระบบหนึ่งลงมา
 * logic เฉพาะระบบให้อยู่ที่ lib/ticket/repo.js และ lib/voice/repo.js
 *
 * สิ่งที่ไฟล์นี้ทำให้:
 *   1. สร้าง client ตัวเดียวใช้ร่วมกัน แบบ lazy (สร้างตอนใช้ครั้งแรก)
 *   2. ให้ checkEnv() ไว้ให้ index.js ตรวจ env ตอนเริ่มทำงาน
 *   3. ห่อทุก query ด้วย retry + timeout ผ่านฟังก์ชัน db()
 *      -> Supabase ล่มหรือเน็ตกระตุก บอทจะไม่ crash แต่คืน error ที่จับได้
 */

const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------
// error ของฝั่งฐานข้อมูล
// ---------------------------------------------------------------------

/**
 * error ที่ตั้งใจให้ command handler จับแล้วตอบผู้ใช้เป็นภาษาไทย
 * แยกชนิดออกมาเพื่อให้ handler แยกได้ว่า "ฐานข้อมูลพัง" กับ "logic ผิด" ต่างกัน
 */
class DatabaseError extends Error {
  constructor(message, { operation, cause, code } = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.operation = operation ?? 'unknown';
    this.code = code;
    if (cause) this.cause = cause;
  }

  /** ข้อความภาษาไทยที่เอาไปโชว์ผู้ใช้ได้เลย */
  get userMessage() {
    if (this.code === 'PGRST205' || this.code === '42P01') {
      return (
        '❌ ยังไม่ได้สร้างตารางในฐานข้อมูล\n' +
        'ผู้ดูแลระบบต้องนำไฟล์ `schema.sql` ไปรันใน Supabase SQL Editor ก่อนใช้งาน'
      );
    }
    if (this.code === '23505' || this.code === '23514') {
      return '❌ ข้อมูลที่ส่งไปไม่ผ่านเงื่อนไขของฐานข้อมูล กรุณาตรวจสอบค่าที่กรอกอีกครั้ง';
    }
    return (
      '❌ เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้\n' +
      'อาจเป็นเพราะ Supabase ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่'
    );
  }
}

// ---------------------------------------------------------------------
// สร้าง client แบบ lazy
//
// ทำไมต้อง lazy: deploy-commands.js ต้อง require ไฟล์คำสั่งเพื่ออ่าน SlashCommandBuilder
// ซึ่งลากไฟล์นี้ติดมาด้วย แต่การลงทะเบียนคำสั่งไม่ได้ใช้ฐานข้อมูลเลย
// ถ้าตรวจ env ตอน import ทันที คนที่ยังไม่ได้ตั้งค่า Supabase จะ deploy คำสั่งไม่ได้
// จึงเลื่อนการตรวจไปตอนใช้งานจริงครั้งแรกแทน
// ---------------------------------------------------------------------

/** เก็บ client ที่สร้างแล้ว (สร้างครั้งเดียวใช้ตลอด) */
let clientInstance = null;

/** ข้อความอธิบายวิธีตั้งค่า ใช้ทั้งตอน throw และตอน print */
function envHelpText() {
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  return [
    'ไม่พบการตั้งค่า Supabase ใน .env',
    '',
    '   ต้องมีทั้ง 2 ค่านี้:',
    `     SUPABASE_URL   ${SUPABASE_URL ? '✅ มีแล้ว' : '❌ ยังไม่มี'}`,
    `     SUPABASE_KEY   ${SUPABASE_KEY ? '✅ มีแล้ว' : '❌ ยังไม่มี'}`,
    '',
    '   วิธีแก้: คัดลอก .env.example เป็น .env แล้วกรอกค่าจาก',
    '   Supabase Dashboard -> Project Settings -> Data API / API Keys',
    '   (ต้องใช้ key ฝั่ง secret: sb_secret_... หรือ service_role เพราะตารางเปิด RLS ไว้)',
  ].join('\n');
}

/**
 * ตรวจว่า env ของ Supabase ครบไหม (ไม่ throw)
 * index.js เรียกตอนเริ่มทำงานเพื่อดับพร้อมข้อความที่อ่านเข้าใจ
 * @returns {{ ok: boolean, message: string }}
 */
function checkEnv() {
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, message: envHelpText() };

  if (!/^https:\/\/.+\.supabase\.(co|in)$/.test(SUPABASE_URL.trim())) {
    return {
      ok: true,
      message:
        `⚠️  SUPABASE_URL หน้าตาไม่เหมือน URL ของ Supabase: ${SUPABASE_URL}\n` +
        '   รูปแบบที่ถูกต้องคือ https://xxxxxxxx.supabase.co (ไม่ต้องมี / ปิดท้าย)',
    };
  }

  return { ok: true, message: '' };
}

/**
 * ดึง Supabase client (สร้างครั้งแรกที่เรียก)
 * @throws {DatabaseError} ถ้า env ไม่ครบ
 */
function getClient() {
  if (clientInstance) return clientInstance;

  const { SUPABASE_URL, SUPABASE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new DatabaseError(envHelpText(), { operation: 'เชื่อมต่อ Supabase', code: 'ENV_MISSING' });
  }

  clientInstance = createClient(SUPABASE_URL.trim(), SUPABASE_KEY.trim(), {
    auth: {
      // บอทไม่ได้ล็อกอินเป็น user จึงไม่ต้องเก็บ/ต่ออายุ session
      persistSession: false,
      autoRefreshToken: false,
    },
    db: { schema: 'public' },
    global: {
      headers: { 'x-application-name': 'discord-ticket-voice-bot' },
    },
  });

  return clientInstance;
}

/**
 * ตัวแทน Supabase client ที่ repo ใช้ — เรียก getClient() ให้เองตอนใช้
 * เขียนเป็น Proxy เพื่อให้ repo เขียน supabase.from(...) ได้เหมือนเดิม
 * โดยที่ client ยังไม่ถูกสร้างจนกว่าจะมีการใช้จริง
 */
const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getClient();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

/** error code ที่ retry แล้วมีโอกาสสำเร็จ (เน็ต/เซิร์ฟเวอร์ชั่วคราว) */
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'ECONNREFUSED', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

/** HTTP status ที่ retry ได้ */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 521, 522, 524]);

function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (RETRYABLE_CODES.has(err.code)) return true;
  if (RETRYABLE_CODES.has(err.cause?.code)) return true;
  if (RETRYABLE_STATUS.has(Number(err.status))) return true;
  // supabase-js ห่อ fetch error มาเป็นข้อความกลางๆ แบบนี้
  return /fetch failed|network|socket hang up|timeout/i.test(err.message ?? '');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ห่อ query ของ Supabase ด้วย timeout + retry แบบ exponential backoff
 *
 * ใช้แบบนี้:
 *   const rows = await db('โหลดตั๋ว', () =>
 *     supabase.from('tickets').select('*').eq('guild_id', guildId));
 *
 * @param {string}   operation ชื่อ operation ภาษาไทย ใช้ใน log และข้อความ error
 * @param {Function} queryFn   ฟังก์ชันที่คืน PostgrestBuilder (thenable ของ supabase-js)
 * @param {object}   [options]
 * @param {number}   [options.retries=2]     จำนวนครั้งที่ลองซ้ำ (ไม่นับครั้งแรก)
 * @param {number}   [options.timeoutMs=8000] timeout ต่อ 1 ครั้ง
 * @param {number[]} [options.allowCodes=[]] error code ของ Postgres ที่ให้ถือว่าไม่ error (คืน null)
 * @returns {Promise<any>} data ที่ Supabase คืนมา
 * @throws {DatabaseError}
 */
async function db(operation, queryFn, options = {}) {
  const { retries = 2, timeoutMs = 8000, allowCodes = [] } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // supabase-js รองรับ .abortSignal() แต่ต้องเรียกบน builder
      // เพื่อให้ queryFn เขียนง่าย เราแข่ง Promise กับ timeout เองแทน
      const result = await Promise.race([
        queryFn(controller.signal),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            const err = new Error(`คำสั่ง "${operation}" ใช้เวลานานเกิน ${timeoutMs} ms`);
            err.name = 'AbortError';
            reject(err);
          });
        }),
      ]);

      clearTimeout(timer);

      const { data, error } = result ?? {};

      if (error) {
        if (allowCodes.includes(error.code)) return null;

        if (isRetryable(error) && attempt < retries) {
          lastError = error;
          const backoff = 300 * 2 ** attempt;
          console.warn(
            `⚠️  [DB] "${operation}" ล้มเหลว (${error.code ?? error.message}) ` +
            `ลองใหม่ครั้งที่ ${attempt + 1}/${retries} ในอีก ${backoff} ms`,
          );
          await sleep(backoff);
          continue;
        }

        throw new DatabaseError(
          `[DB] "${operation}" ล้มเหลว: ${error.message}`,
          { operation, cause: error, code: error.code },
        );
      }

      return data;
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof DatabaseError) throw err;

      if (isRetryable(err) && attempt < retries) {
        lastError = err;
        const backoff = 300 * 2 ** attempt;
        console.warn(
          `⚠️  [DB] "${operation}" ขัดข้อง (${err.message}) ` +
          `ลองใหม่ครั้งที่ ${attempt + 1}/${retries} ในอีก ${backoff} ms`,
        );
        await sleep(backoff);
        continue;
      }

      throw new DatabaseError(
        `[DB] "${operation}" ขัดข้อง: ${err.message}`,
        { operation, cause: err, code: err.code },
      );
    }
  }

  throw new DatabaseError(
    `[DB] "${operation}" ล้มเหลวหลังลองซ้ำ ${retries} ครั้ง: ${lastError?.message ?? 'ไม่ทราบสาเหตุ'}`,
    { operation, cause: lastError, code: lastError?.code },
  );
}

/**
 * ทดสอบว่าเชื่อมต่อ Supabase ได้และตารางถูกสร้างแล้ว
 * เรียกครั้งเดียวตอนบอทเริ่มทำงาน (index.js) เพื่อรู้ปัญหาเร็วกว่ารอผู้ใช้กดคำสั่ง
 *
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function testConnection() {
  const tables = ['ticket_settings',
  'tickets',
  'ticket_messages', 'voice_settings', 'temp_channels', 'blocked_users'];
  const missing = [];

  for (const table of tables) {
    try {
      // หมายเหตุ: ห้ามใช้ { head: true } ที่นี่
      // head:true ทำให้เป็น HTTP HEAD ซึ่งไม่มี response body
      // PostgREST จะคืน 204 เปล่าๆ แม้ตารางไม่มีอยู่ -> ตรวจไม่เจอว่ายังไม่ได้รัน schema.sql
      // จึงต้อง select จริงเพื่อให้ได้ error PGRST205 กลับมา
      await db(`ตรวจสอบตาราง ${table}`, () =>
        supabase.from(table).select('*').limit(1),
        { retries: 1, timeoutMs: 6000 },
      );
    } catch (err) {
      if (err.code === 'PGRST205' || err.code === '42P01') {
        missing.push(table);
      } else {
        return {
          ok: false,
          message:
            `เชื่อมต่อ Supabase ไม่ได้: ${err.message}\n` +
            '   ตรวจสอบ SUPABASE_URL และ SUPABASE_KEY ใน .env อีกครั้ง',
        };
      }
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `เชื่อมต่อ Supabase ได้ แต่ยังไม่มีตาราง: ${missing.join(', ')}\n` +
        '   วิธีแก้ (เลือกทางใดทางหนึ่ง):\n' +
        '   • ใส่ DATABASE_URL ใน .env แล้วรัน  npm run setup-db\n' +
        '   • หรือเปิด Supabase Dashboard -> SQL Editor -> วางไฟล์ schema.sql ทั้งไฟล์ -> Run',
    };
  }

  return { ok: true, message: `เชื่อมต่อ Supabase สำเร็จ (ตารางครบ ${tables.length} ตาราง)` };
}

module.exports = { supabase, db, checkEnv, testConnection, DatabaseError };
