/**
 * setup-db.js — รัน schema.sql ขึ้น Supabase ให้อัตโนมัติ
 *
 * ใช้แทนการเปิด Supabase Dashboard แล้ว copy-paste ไฟล์ schema.sql เอง
 *
 * วิธีใช้:
 *   npm run setup-db
 *
 * ตั้งค่าใน .env ได้ 2 แบบ (เลือกแบบใดแบบหนึ่ง)
 *
 * แบบที่ 1 (ง่ายกว่า) — ใส่แค่รหัสผ่าน แล้วให้สคริปต์ประกอบ URL ให้
 *   DB_HOST=aws-0-ap-northeast-1.pooler.supabase.com
 *   DB_USER=postgres.xxxxxxxxxxxx
 *   DB_PASSWORD=รหัสฐานข้อมูลของคุณ
 *   (ไม่ต้อง percent-encode — สคริปต์ encode ให้เอง)
 *
 * แบบที่ 2 — ใส่ connection string เต็ม
 *   DATABASE_URL=postgresql://postgres.xxxx:รหัส@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
 *   (แบบนี้ต้อง percent-encode รหัสเองถ้ามีอักขระพิเศษ)
 *
 * วิธีเอาค่า: Supabase Dashboard -> ปุ่ม Connect ด้านบน -> แท็บ Connection string
 *            -> เลือกแบบ pooler -> ดู host / user / port
 *
 * สคริปต์นี้ปลอดภัยกับการรันซ้ำ เพราะ schema.sql ใช้ IF NOT EXISTS ทุกคำสั่ง
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const { Client } = require('pg');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

const EXPECTED_TABLES = [
  'blocked_users',
  'temp_channels',
  'ticket_settings',
  'tickets',
  'ticket_messages',
  'voice_settings',
];

// =====================================================================
//  ประกอบ connection string
// =====================================================================

/**
 * หา connection string จาก .env
 * รองรับทั้งแบบใส่ DATABASE_URL เต็ม และแบบใส่ DB_HOST/DB_USER/DB_PASSWORD แยก
 *
 * @returns {{ url: string, source: string } | null}
 */
function resolveConnectionString() {
  // แบบที่ 2: ใส่ URL เต็มมาแล้ว
  const full = process.env.DATABASE_URL?.trim();

  if (full) {
    if (full.includes('[YOUR-PASSWORD]')) {
      console.error('');
      console.error('❌ DATABASE_URL ยังมีคำว่า [YOUR-PASSWORD] อยู่');
      console.error('');
      console.error('   ต้องแทนด้วยรหัสฐานข้อมูลจริงก่อน');
      console.error('   ถ้าลืมรหัส: Supabase Dashboard -> Project Settings -> Database');
      console.error('               -> Reset database password');
      console.error('');
      console.error('   💡 หรือใช้วิธีที่ง่ายกว่า — ใส่แยกเป็น 3 บรรทัดใน .env');
      console.error('      แล้วสคริปต์จะประกอบ URL + encode รหัสให้เอง:');
      console.error('');
      console.error('      DB_HOST=aws-0-ap-northeast-1.pooler.supabase.com');
      console.error('      DB_USER=postgres.xxxxxxxxxxxx');
      console.error('      DB_PASSWORD=รหัสของคุณ');
      console.error('');
      process.exit(1);
    }
    return { url: full, source: 'DATABASE_URL' };
  }

  // แบบที่ 1: ประกอบจากส่วนย่อย
  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD;
  const port = process.env.DB_PORT?.trim() || '5432';
  const database = process.env.DB_NAME?.trim() || 'postgres';

  if (host && user && password) {
    // encode ให้เอง เพื่อกันปัญหารหัสที่มีอักขระพิเศษ (@ : / ? #)
    const safeUser = encodeURIComponent(user);
    const safePass = encodeURIComponent(password);
    return {
      url: `postgresql://${safeUser}:${safePass}@${host}:${port}/${database}`,
      source: 'DB_HOST + DB_USER + DB_PASSWORD',
    };
  }

  return null;
}

// =====================================================================
//  ตรวจ environment
// =====================================================================

const resolved = resolveConnectionString();

if (!resolved) {
  const has = (k) => (process.env[k]?.trim() ? '✅' : '❌');

  console.error('');
  console.error('❌ ไม่พบข้อมูลการเชื่อมต่อฐานข้อมูลใน .env');
  console.error('');
  console.error('   ใส่ค่าแบบใดแบบหนึ่ง:');
  console.error('');
  console.error('   ── แบบที่ 1 (แนะนำ — ไม่ต้อง encode รหัสเอง) ──');
  console.error(`     ${has('DB_HOST')} DB_HOST       เช่น aws-0-ap-northeast-1.pooler.supabase.com`);
  console.error(`     ${has('DB_USER')} DB_USER       เช่น postgres.wojdgbgicsosiwebnnza`);
  console.error(`     ${has('DB_PASSWORD')} DB_PASSWORD   รหัสฐานข้อมูลของคุณ`);
  console.error('');
  console.error('   ── แบบที่ 2 ──');
  console.error(`     ${has('DATABASE_URL')} DATABASE_URL  connection string เต็ม`);
  console.error('');
  console.error('   วิธีเอาค่า: Supabase Dashboard -> ปุ่ม Connect ด้านบน');
  console.error('              -> แท็บ Connection string -> เลือกแบบ pooler');
  console.error('');
  console.error('   💡 ถ้าไม่อยากใช้สคริปต์นี้ ทำมือได้:');
  console.error('      Supabase Dashboard -> SQL Editor -> New query -> วาง schema.sql -> Run');
  console.error('');
  process.exit(1);
}

const DATABASE_URL = resolved.url;

if (!fs.existsSync(SCHEMA_FILE)) {
  console.error(`❌ ไม่พบไฟล์ schema.sql ที่ ${SCHEMA_FILE}`);
  process.exit(1);
}

// ซ่อนรหัสผ่านตอน log
function maskUrl(url) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••••@');
}

// =====================================================================
//  รัน schema
// =====================================================================

async function main() {
  console.log('');
  console.log('═'.repeat(62));
  console.log('  🗄️  ติดตั้งตารางฐานข้อมูลขึ้น Supabase');
  console.log('═'.repeat(62));
  console.log('');

  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const sizeKb = (Buffer.byteLength(sql, 'utf8') / 1024).toFixed(1);

  console.log(`📄 ไฟล์      : schema.sql (${sizeKb} KB)`);
  console.log(`🎯 ปลายทาง   : ${maskUrl(DATABASE_URL)}`);
  console.log(`🔑 ค่าที่ใช้   : ${resolved.source}`);
  console.log('');

  const client = new Client({
    connectionString: DATABASE_URL,
    // Supabase ใช้ SSL แต่ certificate เป็นของ AWS ที่ Node ไม่รู้จักโดยตรง
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
    query_timeout: 120000,
    statement_timeout: 120000,
  });

  try {
    console.log('🔌 กำลังเชื่อมต่อฐานข้อมูล...');
    await client.connect();
    console.log('   ✅ เชื่อมต่อสำเร็จ');
    console.log('');

    // แสดงว่ามีตารางอะไรอยู่ก่อนแล้ว
    const before = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [EXPECTED_TABLES],
    );

    if (before.rows.length > 0) {
      console.log(`ℹ️  มีตารางอยู่ก่อนแล้ว ${before.rows.length} ตาราง: ${before.rows.map((r) => r.table_name).join(', ')}`);
      console.log('   (schema.sql รันซ้ำได้ ข้อมูลเดิมไม่หาย)');
      console.log('');
    }

    console.log('⚙️  กำลังรัน schema.sql...');

    // รันทั้งไฟล์เป็นก้อนเดียว — pg รองรับหลายคำสั่งใน query เดียว
    // และ schema.sql เขียนแบบ idempotent อยู่แล้ว
    await client.query(sql);

    console.log('   ✅ รันสำเร็จ');
    console.log('');

    // ----- ตรวจผลลัพธ์ -----
    console.log('🔍 ตรวจสอบผลลัพธ์...');
    console.log('');

    const after = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [EXPECTED_TABLES],
    );

    const created = after.rows.map((r) => r.table_name);
    const missing = EXPECTED_TABLES.filter((t) => !created.includes(t));

    console.log('   ตาราง:');
    for (const t of EXPECTED_TABLES) {
      console.log(`     ${created.includes(t) ? '✅' : '❌'} ${t}`);
    }
    console.log('');

    // ตรวจ SQL function
    const fns = await client.query(
      `SELECT proname FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND proname = ANY($1::text[])
        ORDER BY proname`,
      [['next_ticket_number', 'set_updated_at']],
    );

    console.log('   ฟังก์ชัน:');
    for (const name of ['next_ticket_number', 'set_updated_at']) {
      const found = fns.rows.some((r) => r.proname === name);
      console.log(`     ${found ? '✅' : '❌'} ${name}()`);
    }
    console.log('');

    // ตรวจ RLS
    const rls = await client.query(
      `SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])
        ORDER BY tablename`,
      [EXPECTED_TABLES],
    );

    const rlsOff = rls.rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);

    console.log('   Row Level Security:');
    if (rlsOff.length === 0) {
      console.log(`     ✅ เปิดครบทุกตาราง (${rls.rows.length} ตาราง)`);
    } else {
      console.log(`     ⚠️  ยังไม่เปิดใน: ${rlsOff.join(', ')}`);
    }
    console.log('');

    // ตรวจ index สำคัญ (partial unique index กัน 1 คน 1 ตั๋วเปิด)
    const idx = await client.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_tickets_one_open_per_user'`,
    );

    console.log('   Index สำคัญ:');
    console.log(
      `     ${idx.rows.length > 0 ? '✅' : '❌'} idx_tickets_one_open_per_user (กัน 1 คนเปิดตั๋วซ้อน)`,
    );
    console.log('');

    if (missing.length > 0) {
      console.error('═'.repeat(62));
      console.error(`❌ ติดตั้งไม่ครบ — ขาดตาราง: ${missing.join(', ')}`);
      console.error('═'.repeat(62));
      console.error('');
      return 1;
    }

    console.log('═'.repeat(62));
    console.log('  ✅ ติดตั้งฐานข้อมูลสำเร็จครบทั้ง 2 ระบบ');
    console.log('═'.repeat(62));
    console.log('');
    console.log('ขั้นตอนถัดไป:');
    console.log('  1. กรอก TOKEN, CLIENT_ID, SUPABASE_URL, SUPABASE_KEY ใน .env (ถ้ายังไม่ครบ)');
    console.log('  2. npm run deploy   ← ลงทะเบียน slash command');
    console.log('  3. npm start        ← เปิดบอท');
    console.log('');

    return 0;
  } catch (err) {
    console.error('');
    console.error('═'.repeat(62));
    console.error(`❌ ติดตั้งฐานข้อมูลไม่สำเร็จ: ${err.message}`);
    console.error('═'.repeat(62));
    console.error('');

    // แปล error ที่เจอบ่อยเป็นภาษาไทย
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      console.error('   สาเหตุ: หา host ในฐานข้อมูลไม่เจอ');
      console.error('   วิธีแก้:');
      console.error('   • ตรวจว่า DATABASE_URL คัดลอกมาครบ ไม่ตกตัวอักษร');
      console.error('   • ตรวจอินเทอร์เน็ตของเครื่อง');
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      console.error('   สาเหตุ: เชื่อมต่อฐานข้อมูลไม่ได้');
      console.error('   วิธีแก้:');
      console.error('   • โปรเจกต์ Supabase อาจถูก pause (ฟรีจะ pause หลังไม่ใช้ 7 วัน)');
      console.error('     → เข้า Dashboard กด Restore project แล้วรอ 2 นาที');
      console.error('   • ลองใช้ connection string แบบ Session pooler (port 5432) แทน Direct connection');
      console.error('   • ถ้าเน็ตคุณเป็น IPv4 อย่างเดียว ต้องใช้ pooler ไม่ใช่ direct connection');
    } else if (err.code === '28P01') {
      console.error('   สาเหตุ: รหัสผ่านฐานข้อมูลไม่ถูกต้อง');
      console.error('   วิธีแก้:');
      console.error('   • ตรวจว่าแทน [YOUR-PASSWORD] ใน DATABASE_URL ด้วยรหัสจริงแล้ว');
      console.error('   • ถ้าลืมรหัส: Supabase Dashboard → Project Settings → Database');
      console.error('     → Reset database password');
      console.error('   • ถ้ารหัสมีอักขระพิเศษ (@ : / ? #) ต้อง URL-encode ก่อน');
      console.error('     เช่น @ → %40, : → %3A, / → %2F, # → %23');
    } else if (err.code === '3D000') {
      console.error('   สาเหตุ: ไม่พบฐานข้อมูลชื่อนี้');
      console.error('   วิธีแก้: ชื่อฐานข้อมูลท้าย URL ต้องเป็น /postgres');
    } else if (err.code === '42501') {
      console.error('   สาเหตุ: สิทธิ์ไม่พอที่จะสร้างตาราง');
      console.error('   วิธีแก้: ต้องใช้ connection string ของ user postgres ไม่ใช่ user อื่น');
    } else if (err.position) {
      console.error(`   สาเหตุ: SQL ผิดที่ตำแหน่งตัวอักษรที่ ${err.position}`);
      const around = fs.readFileSync(SCHEMA_FILE, 'utf8').slice(
        Math.max(0, Number(err.position) - 120),
        Number(err.position) + 120,
      );
      console.error('   บริเวณที่ผิด:');
      console.error('   ---');
      console.error(around.split('\n').map((l) => '   ' + l).join('\n'));
      console.error('   ---');
    } else {
      console.error(`   รหัส error: ${err.code ?? 'ไม่มี'}`);
      console.error('');
      console.error('   💡 ทางเลือก: ทำมือผ่านเว็บได้');
      console.error('      Supabase Dashboard → SQL Editor → New query → วาง schema.sql → Run');
    }

    console.error('');
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((err) => {
    console.error('❌ เกิดข้อผิดพลาดที่ไม่คาดคิด:', err);
    process.exitCode = 1;
  });
