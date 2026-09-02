/**
 * deploy-commands.js — ลงทะเบียน slash command ทั้งหมดกับ Discord
 *
 * ต้องรันคำสั่งนี้:
 *   - ครั้งแรกที่ติดตั้งบอท
 *   - ทุกครั้งที่แก้ชื่อ/คำอธิบาย/ตัวเลือกของคำสั่ง
 *
 * ไม่ต้องรันเมื่อ: แก้แต่ logic ข้างในคำสั่ง (แค่รีสตาร์ทบอทพอ)
 *
 * วิธีรัน:  npm run deploy
 *
 * โหมดการลงทะเบียน:
 *   - ใส่ GUILD_ID ใน .env  -> ลงทะเบียนเฉพาะเซิร์ฟเวอร์นั้น (เห็นผลทันที เหมาะกับตอนพัฒนา)
 *   - ไม่ใส่ GUILD_ID       -> ลงทะเบียนแบบ global (ใช้ได้ทุกเซิร์ฟเวอร์ แต่ sync ช้ากว่า)
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const { REST, Routes } = require('discord.js');

// =====================================================================
//  ตรวจ environment variable
// =====================================================================

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
const missing = [];

if (!TOKEN) missing.push('TOKEN');
if (!CLIENT_ID) missing.push('CLIENT_ID');

if (missing.length > 0) {
  console.error('');
  console.error(`❌ ไม่พบค่าที่จำเป็นในไฟล์ .env: ${missing.join(', ')}`);
  console.error('');
  console.error('   TOKEN     = Bot Token จาก Developer Portal → Bot');
  console.error('   CLIENT_ID = Application ID จาก Developer Portal → General Information');
  console.error('');
  process.exit(1);
}

// =====================================================================
//  รวบรวมคำสั่งจากทุกระบบ
// =====================================================================

/**
 * อ่านไฟล์คำสั่งทั้งหมดจาก commands/<ระบบ>/*.js
 * @returns {{ payload: object[], bySystem: Map<string, string[]>, failed: string[] }}
 */
function collectCommands() {
  const commandsRoot = path.join(__dirname, 'commands');
  const payload = [];
  const bySystem = new Map();
  const failed = [];
  const seen = new Set();

  if (!fs.existsSync(commandsRoot)) {
    failed.push('ไม่พบโฟลเดอร์ commands/');
    return { payload, bySystem, failed };
  }

  const systems = fs
    .readdirSync(commandsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const system of systems) {
    const systemDir = path.join(commandsRoot, system);
    const files = fs.readdirSync(systemDir).filter((f) => f.endsWith('.js'));

    bySystem.set(system, []);

    for (const file of files) {
      const filePath = path.join(systemDir, file);

      try {
        const command = require(filePath);

        if (!command?.data?.toJSON) {
          failed.push(`${system}/${file} — ไม่มี data (SlashCommandBuilder)`);
          continue;
        }

        const json = command.data.toJSON();

        if (seen.has(json.name)) {
          failed.push(`${system}/${file} — ชื่อคำสั่ง "${json.name}" ซ้ำกับไฟล์อื่น`);
          continue;
        }

        seen.add(json.name);
        payload.push(json);

        // นับจำนวนคำสั่งย่อยไว้แสดงในสรุป
        const subCount = (json.options ?? []).filter((opt) => opt.type === 1).length;
        bySystem.get(system).push(subCount > 0 ? `/${json.name} (${subCount} คำสั่งย่อย)` : `/${json.name}`);
      } catch (err) {
        failed.push(`${system}/${file} — ${err.message}`);
      }
    }
  }

  return { payload, bySystem, failed };
}

// =====================================================================
//  ลงทะเบียน
// =====================================================================

async function main() {
  console.log('');
  console.log('═'.repeat(62));
  console.log('  📤 ลงทะเบียน Slash Command');
  console.log('═'.repeat(62));
  console.log('');

  const { payload, bySystem, failed } = collectCommands();

  if (failed.length > 0) {
    console.error('❌ อ่านไฟล์คำสั่งบางตัวไม่สำเร็จ:');
    for (const msg of failed) console.error(`   • ${msg}`);
    console.error('');
    process.exit(1);
  }

  if (payload.length === 0) {
    console.error('❌ ไม่พบคำสั่งใดๆ ในโฟลเดอร์ commands/');
    process.exit(1);
  }

  // ----- แสดงรายการที่จะลงทะเบียน -----
  for (const [system, names] of bySystem) {
    if (names.length === 0) continue;
    console.log(`📁 ${system}`);
    for (const name of names) console.log(`   • ${name}`);
  }

  console.log('');
  console.log(`รวมทั้งหมด ${payload.length} คำสั่ง`);
  console.log('');

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const scope = GUILD_ID
    ? { route: Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), label: `เซิร์ฟเวอร์ ${GUILD_ID}` }
    : { route: Routes.applicationCommands(CLIENT_ID), label: 'ทุกเซิร์ฟเวอร์ (global)' };

  console.log(`🎯 ปลายทาง: ${scope.label}`);
  console.log('');

  try {
    const result = await rest.put(scope.route, { body: payload });

    console.log(`✅ ลงทะเบียนสำเร็จ ${result.length} คำสั่ง`);
    console.log('');

    if (GUILD_ID) {
      console.log('💡 คำสั่งใช้ได้ทันทีในเซิร์ฟเวอร์นั้น');
      console.log('   ถ้าไม่เห็นคำสั่ง ให้กด Ctrl+R ใน Discord เพื่อรีเฟรช');
    } else {
      console.log('💡 คำสั่งแบบ global อาจใช้เวลาสูงสุด 1 ชั่วโมงจึงจะเห็นครบทุกเซิร์ฟเวอร์');
      console.log('   ถ้าต้องการให้เห็นทันทีตอนพัฒนา ให้ใส่ GUILD_ID ใน .env แล้วรันคำสั่งนี้อีกครั้ง');
    }

    console.log('');
    return 0;
  } catch (err) {
    console.error('');
    console.error(`❌ ลงทะเบียนไม่สำเร็จ: ${err.message}`);
    console.error('');

    if (err.status === 401) {
      console.error('   สาเหตุ: TOKEN ไม่ถูกต้อง');
      console.error('   วิธีแก้: Developer Portal → Bot → Reset Token แล้วนำ token ใหม่ใส่ .env');
    } else if (err.status === 403) {
      console.error('   สาเหตุ: บอทไม่มีสิทธิ์ลงทะเบียนคำสั่งในเซิร์ฟเวอร์นี้');
      console.error('   วิธีแก้: เชิญบอทเข้าเซิร์ฟเวอร์ด้วยลิงก์ที่มี scope `applications.commands`');
    } else if (err.status === 404) {
      console.error('   สาเหตุ: CLIENT_ID ผิด หรือบอทยังไม่ได้อยู่ในเซิร์ฟเวอร์ที่ระบุใน GUILD_ID');
      console.error('   วิธีแก้: ตรวจสอบ CLIENT_ID ให้ตรงกับ Application ID และเชิญบอทเข้าเซิร์ฟเวอร์ก่อน');
    } else if (err.status === 429) {
      console.error('   สาเหตุ: ลงทะเบียนถี่เกินไป (rate limit)');
      console.error('   วิธีแก้: รอสักครู่แล้วลองใหม่');
    } else if (err.rawError?.errors) {
      console.error('   รายละเอียดจาก Discord:');
      console.error(JSON.stringify(err.rawError.errors, null, 2));
      console.error('');
      console.error('   มักเกิดจากชื่อคำสั่ง/ตัวเลือกไม่ตรงกฎของ Discord');
      console.error('   (ชื่อต้องเป็นตัวพิมพ์เล็ก ยาวไม่เกิน 32 ตัว, คำอธิบายไม่เกิน 100 ตัว)');
    }

    console.error('');
    return 1;
  } finally {
    // ปิด HTTP agent ให้เรียบร้อย ไม่งั้น process ค้างรอ socket
    // (และถ้าใช้ process.exit() ทันทีจะทำให้ libuv ตายบน Windows)
    await rest.options?.agent?.close?.().catch(() => {});
  }
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((err) => {
    console.error('❌ ลงทะเบียนคำสั่งผิดพลาดที่ไม่คาดคิด:', err);
    process.exitCode = 1;
  });
