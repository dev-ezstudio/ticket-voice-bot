/**
 * index.js — ไฟล์หลักของบอท
 *
 * หน้าที่:
 *   1. โหลด .env และตรวจว่าครบ
 *   2. ทดสอบการเชื่อมต่อ Supabase ก่อนล็อกอิน Discord (รู้ปัญหาเร็ว)
 *   3. โหลดคำสั่งจาก /commands/ticket และ /commands/voice
 *   4. โหลด event จาก /events/core, /events/ticket และ /events/voice
 *   5. ล็อกอินพร้อม retry
 *
 * ตัวโหลดวนอ่านโฟลเดอร์เอง — เพิ่มไฟล์คำสั่งหรือ event ใหม่แล้วรีสตาร์ท
 * บอทจะเห็นเองโดยไม่ต้องแก้ไฟล์นี้
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');

const { checkEnv, testConnection } = require('./supabase');
const M = require('./lib/messages');

// =====================================================================
//  กันรันซ้อน — ต้องทำก่อนทุกอย่าง
//
//  ถ้าเปิดบอท 2 ตัวด้วย token เดียวกัน ทั้งคู่จะรับ event เดียวกันจาก Discord
//  แล้วแย่งกันตอบ interaction (error 40060 / 10062) และสร้าง-ลบห้องซ้ำหลายครั้ง
// =====================================================================

const singleInstance = require('./lib/singleInstance');

const lock = singleInstance.acquire();

if (!lock.ok) {
  console.error(singleInstance.busyMessage(lock));
  process.exit(1);
}

// =====================================================================
//  ตรวจ environment variable
// =====================================================================

const REQUIRED_ENV = ['TOKEN', 'CLIENT_ID', 'SUPABASE_URL', 'SUPABASE_KEY'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error('');
  console.error('❌ ไม่พบค่าที่จำเป็นในไฟล์ .env');
  console.error('');
  for (const key of REQUIRED_ENV) {
    console.error(`   ${process.env[key] ? '✅' : '❌'} ${key}`);
  }
  console.error('');
  console.error('   วิธีแก้: คัดลอกไฟล์ .env.example เป็น .env แล้วกรอกค่าให้ครบ');
  console.error('   Windows : copy .env.example .env');
  console.error('   Mac/Linux: cp .env.example .env');
  console.error('');
  process.exit(1);
}

// =====================================================================
//  สร้าง client
// =====================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,        // ข้อมูลเซิร์ฟเวอร์ ห้อง และยศ
    GatewayIntentBits.GuildMembers,  // สมาชิก (privileged — ต้องเปิดใน Developer Portal)
    GatewayIntentBits.GuildVoiceStates, // การเข้า/ออกห้องเสียง (หัวใจของระบบห้องเสียง)
    GatewayIntentBits.GuildMessages, // อ่านข้อความในห้องตั๋วเพื่อทำ transcript
    GatewayIntentBits.MessageContent, // เนื้อหาข้อความ (privileged — จำเป็นสำหรับ transcript)
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

/** เก็บคำสั่งทั้งหมด key = ชื่อคำสั่ง */
client.commands = new Collection();

// =====================================================================
//  ตัวโหลดคำสั่ง
// =====================================================================

/**
 * โหลดคำสั่งจากโฟลเดอร์ commands/<ระบบ>/
 * @returns {{ loaded: number, failed: string[] }}
 */
function loadCommands() {
  const commandsRoot = path.join(__dirname, 'commands');
  const failed = [];
  let loaded = 0;

  if (!fs.existsSync(commandsRoot)) {
    console.warn('⚠️  ไม่พบโฟลเดอร์ commands/');
    return { loaded, failed };
  }

  // แต่ละโฟลเดอร์ย่อยคือ 1 ระบบ (ticket, voice, ...)
  const systems = fs
    .readdirSync(commandsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const system of systems) {
    const systemDir = path.join(commandsRoot, system);
    const files = fs.readdirSync(systemDir).filter((f) => f.endsWith('.js'));

    for (const file of files) {
      const filePath = path.join(systemDir, file);

      try {
        const command = require(filePath);

        if (!command?.data?.name || typeof command.execute !== 'function') {
          failed.push(`${system}/${file} — ต้องมี data (SlashCommandBuilder) และ execute()`);
          continue;
        }

        if (client.commands.has(command.data.name)) {
          failed.push(`${system}/${file} — ชื่อคำสั่ง "${command.data.name}" ซ้ำกับไฟล์อื่น`);
          continue;
        }

        // บันทึกว่าคำสั่งนี้เป็นของระบบไหน (ใช้ใน log)
        command.system = command.system ?? system;

        client.commands.set(command.data.name, command);
        loaded += 1;

        console.log(`   ✅ [${system}] /${command.data.name}`);
      } catch (err) {
        failed.push(`${system}/${file} — ${err.message}`);
      }
    }
  }

  return { loaded, failed };
}

// =====================================================================
//  ตัวโหลด event
// =====================================================================

/**
 * โหลด event จากโฟลเดอร์ events/<ระบบ>/
 *
 * หมายเหตุสำคัญ: หลายระบบลงทะเบียน event ชื่อเดียวกันได้
 * (เช่น ticket และ voice ต่างก็ฟัง channelDelete)
 * discord.js รองรับ listener หลายตัวต่อ event อยู่แล้ว จึงไม่ชนกัน
 *
 * @returns {{ loaded: number, failed: string[] }}
 */
function loadEvents() {
  const eventsRoot = path.join(__dirname, 'events');
  const failed = [];
  let loaded = 0;

  if (!fs.existsSync(eventsRoot)) {
    console.warn('⚠️  ไม่พบโฟลเดอร์ events/');
    return { loaded, failed };
  }

  const systems = fs
    .readdirSync(eventsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const system of systems) {
    const systemDir = path.join(eventsRoot, system);
    const files = fs.readdirSync(systemDir).filter((f) => f.endsWith('.js'));

    for (const file of files) {
      const filePath = path.join(systemDir, file);

      try {
        const event = require(filePath);

        if (!event?.name || typeof event.execute !== 'function') {
          failed.push(`${system}/${file} — ต้องมี name และ execute()`);
          continue;
        }

        const label = `${system}/${file}`;

        // ห่อ execute ด้วย try/catch กันบอทล่มจาก error ที่ handler ไม่ได้จับ
        const wrapped = async (...args) => {
          try {
            await event.execute(...args);
          } catch (err) {
            console.error(`❌ event ${event.name} จาก ${label} ผิดพลาดที่ไม่คาดคิด:`, err);
          }
        };

        if (event.once) {
          client.once(event.name, wrapped);
        } else {
          client.on(event.name, wrapped);
        }

        loaded += 1;
        console.log(`   ✅ [${system}] ${event.name}${event.once ? ' (once)' : ''}`);
      } catch (err) {
        failed.push(`${system}/${file} — ${err.message}`);
      }
    }
  }

  return { loaded, failed };
}

// =====================================================================
//  จับ error ระดับ process กันบอทล่ม
// =====================================================================

client.on('error', (err) => console.error('❌ Discord client error:', err));
client.on('shardError', (err) => console.error('❌ Discord shard error:', err));
client.on('warn', (msg) => console.warn(`⚠️  Discord warning: ${msg}`));

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promise ที่ไม่ได้จับ error:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Exception ที่ไม่ได้จับ:', err);
  // ไม่ exit — ปล่อยให้บอททำงานต่อ ดีกว่าดับทั้งตัว
});

// ----- ปิดบอทอย่างสุภาพเมื่อกด Ctrl+C -----
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('');
  console.log(`⏹️  ได้รับสัญญาณ ${signal} — กำลังปิดบอท...`);

  try {
    await client.destroy();
    console.log('👋 ปิดบอทเรียบร้อย');
  } catch (err) {
    console.error(`❌ ปิดบอทไม่เรียบร้อย: ${err.message}`);
  }

  singleInstance.release();

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// คืน lock ทุกทางที่ process จบ (รวมกรณี process.exit จากที่อื่น)
process.on('exit', () => singleInstance.release());

// =====================================================================
//  เริ่มทำงาน
// =====================================================================

async function main() {
  console.log('');
  console.log('═'.repeat(62));
  console.log('  🤖 บอทระบบตั๋วสนับสนุน + ห้องเสียงชั่วคราว');
  console.log('═'.repeat(62));
  console.log('');

  // ----- 1) ทดสอบ Supabase -----
  console.log('🔌 ทดสอบการเชื่อมต่อ Supabase...');

  // ตรวจรูปแบบ env ก่อน (checkEnv ไม่ยิง network)
  const envStatus = checkEnv();

  if (!envStatus.ok) {
    console.error('');
    console.error(`❌ ${envStatus.message}`);
    console.error('');
    process.exit(1);
  }

  if (envStatus.message) console.warn(envStatus.message);

  const dbStatus = await testConnection();

  if (!dbStatus.ok) {
    console.error('');
    console.error(`❌ ${dbStatus.message}`);
    console.error('');
    console.error('   บอทหยุดทำงานเพราะทั้ง 2 ระบบต้องใช้ฐานข้อมูล');
    console.error('');
    process.exit(1);
  }

  console.log(`   ✅ ${dbStatus.message}`);
  console.log('');

  // ----- 2) ข้อความจาก messages.json -----
  const msgStatus = M.status();
  console.log(`💬 ${msgStatus.ok ? '✅' : '⚠️ '} ${msgStatus.label}`);
  console.log('');

  // ----- 3) โหลดคำสั่ง -----
  console.log('📦 โหลดคำสั่ง...');
  const cmdResult = loadCommands();

  if (cmdResult.failed.length > 0) {
    console.error('');
    console.error('❌ โหลดคำสั่งบางตัวไม่สำเร็จ:');
    for (const msg of cmdResult.failed) console.error(`   • ${msg}`);
    console.error('');
    process.exit(1);
  }

  if (cmdResult.loaded === 0) {
    console.error('❌ ไม่พบคำสั่งใดๆ ในโฟลเดอร์ commands/');
    process.exit(1);
  }

  console.log(`   รวม ${cmdResult.loaded} คำสั่ง`);
  console.log('');

  // ----- 4) โหลด event -----
  console.log('📡 โหลด event handler...');
  const evtResult = loadEvents();

  if (evtResult.failed.length > 0) {
    console.error('');
    console.error('❌ โหลด event บางตัวไม่สำเร็จ:');
    for (const msg of evtResult.failed) console.error(`   • ${msg}`);
    console.error('');
    process.exit(1);
  }

  console.log(`   รวม ${evtResult.loaded} event handler`);
  console.log('');

  // ----- 5) ล็อกอิน Discord พร้อม retry -----
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(`🔑 เชื่อมต่อ Discord... (ครั้งที่ ${attempt}/${MAX_ATTEMPTS})`);
      await client.login(process.env.TOKEN);
      return; // สำเร็จ — event ready จะรายงานสถานะต่อ
    } catch (err) {
      // Token ผิด retry ไม่ช่วย
      if (err.code === 'TokenInvalid' || /invalid token/i.test(err.message)) {
        console.error('');
        console.error('❌ TOKEN ไม่ถูกต้องหรือถูก reset ไปแล้ว');
        console.error('');
        console.error('   วิธีแก้:');
        console.error('   1. เปิด https://discord.com/developers/applications');
        console.error('   2. เลือกแอปของคุณ → เมนู Bot → กด Reset Token');
        console.error('   3. คัดลอก token ใหม่ไปใส่ใน .env ที่บรรทัด TOKEN=');
        console.error('');
        process.exit(1);
      }

      // Intent ที่ต้องเปิดใน Developer Portal
      if (err.code === 'DisallowedIntents' || /disallowed intents/i.test(err.message)) {
        console.error('');
        console.error('❌ บอทขอ intent ที่ยังไม่ได้เปิดใน Developer Portal');
        console.error('');
        console.error('   วิธีแก้:');
        console.error('   1. เปิด https://discord.com/developers/applications');
        console.error('   2. เลือกแอปของคุณ → เมนู Bot');
        console.error('   3. เลื่อนไปหา Privileged Gateway Intents แล้วเปิดทั้ง 2 อัน:');
        console.error('      ✅ SERVER MEMBERS INTENT');
        console.error('      ✅ MESSAGE CONTENT INTENT');
        console.error('   4. กด Save Changes แล้วรันบอทใหม่');
        console.error('');
        process.exit(1);
      }

      console.error(`❌ เชื่อมต่อ Discord ไม่สำเร็จ: ${err.message}`);

      if (attempt < MAX_ATTEMPTS) {
        const wait = 5000 * attempt;
        console.log(`⏳ รอ ${wait / 1000} วินาที แล้วลองใหม่...`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      } else {
        console.error('');
        console.error('❌ เชื่อมต่อไม่ได้หลังลองครบทุกครั้ง');
        console.error('');
        console.error('   สิ่งที่ควรตรวจสอบ:');
        console.error('   1. อินเทอร์เน็ตของเครื่องที่รันบอท');
        console.error('   2. สถานะ Discord ที่ https://discordstatus.com');
        console.error('   3. TOKEN ใน .env ถูกต้องและยังไม่ถูก reset');
        console.error('');
        process.exit(1);
      }
    }
  }
}

main().catch((err) => {
  console.error('❌ บอทเริ่มทำงานไม่สำเร็จ:', err);
  process.exit(1);
});
