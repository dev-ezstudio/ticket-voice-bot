/**
 * lib/singleInstance.js — กันบอทรันซ้อนกันหลายตัว
 *
 * ปัญหาที่แก้:
 *   ถ้าเปิดบอท 2 ตัวขึ้นไปด้วย token เดียวกัน ทุกตัวจะรับ event เดียวกันจาก Discord
 *   แล้วแย่งกันตอบ interaction — ตัวแรกตอบทัน ที่เหลือได้ error:
 *     40060 Interaction has already been acknowledged
 *     10062 Unknown interaction
 *   และงานที่ควรทำครั้งเดียว (สร้างห้อง / ลบห้อง) จะถูกทำซ้ำเท่าจำนวนบอท
 *
 * วิธีกัน: จองไฟล์ lock ไว้ 1 ไฟล์ ใครจองได้ก่อนได้รัน
 *   - เก็บ PID ไว้ในไฟล์ เพื่อบอกได้ว่าตัวไหนกำลังรัน
 *   - ถ้าไฟล์ค้างจากบอทที่ดับไปแล้ว (crash / ไฟดับ) จะยึดไฟล์มาใช้เอง
 *   - ลบไฟล์ให้เองตอนปิดบอท
 */

const fs = require('node:fs');
const path = require('node:path');

const LOCK_FILE = path.join(__dirname, '..', '.bot.lock');

/** process นี้ยังมีชีวิตอยู่ไหม */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    // signal 0 = แค่เช็คว่ามี process นี้ไหม ไม่ได้ส่งสัญญาณจริง
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = มี process อยู่แต่เราไม่มีสิทธิ์แตะ -> ถือว่ายังมีชีวิต
    return err.code === 'EPERM';
  }
}

/**
 * จองสิทธิ์รันบอท
 * @returns {{ ok: true } | { ok: false, pid: number, since: string }}
 */
function acquire() {
  // มีไฟล์ lock อยู่แล้ว -> ตรวจว่าเจ้าของยังรันอยู่ไหม
  if (fs.existsSync(LOCK_FILE)) {
    let data = {};

    try {
      data = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    } catch {
      // ไฟล์เสีย ถือว่าค้าง ยึดมาใช้ได้
    }

    if (isAlive(data.pid) && data.pid !== process.pid) {
      return { ok: false, pid: data.pid, since: data.startedAt ?? 'ไม่ทราบ' };
    }

    // เจ้าของเดิมดับไปแล้ว -> ลบไฟล์ค้างทิ้ง
    console.warn(
      `⚠️  พบไฟล์ ${path.basename(LOCK_FILE)} ค้างจากบอทที่ดับไปแล้ว (PID ${data.pid ?? '?'}) — ยึดมาใช้`,
    );
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      /* ลบไม่ได้ก็เขียนทับด้านล่าง */
    }
  }

  try {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
      { flag: 'w' },
    );
    return { ok: true };
  } catch (err) {
    // เขียนไฟล์ไม่ได้ (สิทธิ์ / ดิสก์เต็ม) — ไม่ควรกันบอทไม่ให้รันเพราะเรื่องนี้
    console.warn(`⚠️  สร้างไฟล์ lock ไม่ได้: ${err.message} — ข้ามการกันรันซ้อน`);
    return { ok: true };
  }
}

/** คืนสิทธิ์ (เรียกตอนปิดบอท) */
function release() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return;

    const data = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));

    // ลบเฉพาะ lock ของตัวเอง ไม่ไปลบของบอทตัวอื่น
    if (data.pid === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* ปิดอยู่แล้ว ไม่ต้องทำอะไร */
  }
}

/** ข้อความอธิบายวิธีแก้ ตอนมีบอทรันอยู่แล้ว */
function busyMessage({ pid, since }) {
  return [
    '',
    '❌ บอทกำลังรันอยู่แล้ว — เปิดซ้อนไม่ได้',
    '',
    `   ตัวที่รันอยู่: PID ${pid}`,
    `   เริ่มเมื่อ    : ${since}`,
    '',
    '   ทำไมกันไว้: ถ้าเปิดบอท 2 ตัวด้วย token เดียวกัน ทั้งคู่จะรับ event เดียวกัน',
    '   แล้วแย่งกันตอบ ทำให้ปุ่มกดไม่ติด และห้องเสียงถูกสร้าง/ลบซ้ำหลายครั้ง',
    '',
    '   วิธีแก้:',
    '   • ถ้าเปิดบอทค้างไว้อยู่ ให้ใช้ตัวนั้นต่อ (ไม่ต้องเปิดใหม่)',
    '   • ถ้าอยากปิดตัวเก่า: กด Ctrl+C ในหน้าต่างนั้น',
    '   • ถ้าหาหน้าต่างไม่เจอ ให้เปิด PowerShell แล้วรัน:',
    '',
    `       Stop-Process -Id ${pid} -Force`,
    '',
    '   • ปิดบอททุกตัวพร้อมกัน:',
    '',
    "       Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "         Where-Object { $_.CommandLine -match 'index\\.js' } |",
    '         ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    '',
  ].join('\n');
}

module.exports = { acquire, release, busyMessage, LOCK_FILE };
