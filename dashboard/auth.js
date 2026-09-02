/**
 * dashboard/auth.js — ล็อกอินด้วย Discord OAuth2
 *
 * ทำไมต้องล็อกอิน: dashboard แสดงข้อมูลตั๋วทั้งหมด (ใครเปิด ใครรับ กี่ใบ)
 * ถ้าเปิดให้ใครก็เข้าได้ ข้อมูลสมาชิกจะรั่ว จึงต้องยืนยันตัวตนก่อน
 *
 * ขั้นตอน:
 *   1. ผู้ใช้กดล็อกอิน -> ส่งไป Discord พร้อม state (กัน CSRF)
 *   2. Discord ส่งกลับมาที่ /auth/callback พร้อม code
 *   3. แลก code เป็น access token
 *   4. ถามข้อมูลผู้ใช้ + ยศในเซิร์ฟเวอร์
 *   5. ตรวจว่าเป็นแอดมินใหญ่ / ทีมงาน ไหม -> เก็บใน session
 *
 * ไม่เก็บ access token ไว้หลังใช้เสร็จ เพื่อลดความเสียหายถ้า session รั่ว
 */

const crypto = require('node:crypto');

const ticketRepo = require('../lib/ticket/repo');

/** สิทธิ์ Administrator ของ Discord (bit 3) */
const ADMINISTRATOR = 1n << 3n;

/**
 * สร้าง URL ให้ผู้ใช้ไปล็อกอินที่ Discord
 * @param {string} clientId
 * @param {string} redirectUri
 * @param {string} state ค่าสุ่มที่เก็บไว้ใน session เพื่อเทียบตอน callback
 */
function buildAuthUrl(clientId, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // identify = ชื่อ/รูป, guilds.members.read = ยศของเราในเซิร์ฟเวอร์นั้น
    scope: 'identify guilds.members.read',
    state,
    prompt: 'none',
  });

  return `https://discord.com/oauth2/authorize?${params}`;
}

/** ค่าสุ่มสำหรับ state (กัน CSRF) */
function newState() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * แลก code เป็น access token
 * @throws {Error} ถ้า Discord ปฏิเสธ
 */
async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // error_description ของ Discord บอกสาเหตุตรงๆ เช่น redirect_uri ไม่ตรง
    throw new Error(
      body.error_description || body.error || `แลก token ไม่สำเร็จ (HTTP ${res.status})`,
    );
  }

  return body.access_token;
}

/** ข้อมูลผู้ใช้ที่ล็อกอิน */
async function fetchUser(accessToken) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`อ่านข้อมูลผู้ใช้ไม่สำเร็จ (HTTP ${res.status})`);

  return res.json();
}

/**
 * ข้อมูลสมาชิก (ยศ + สิทธิ์) ในเซิร์ฟเวอร์ที่ระบุ
 * @returns {Promise<object|null>} null = ไม่ได้อยู่ในเซิร์ฟเวอร์นั้น
 */
async function fetchMember(accessToken, guildId) {
  const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) return null; // ไม่ได้อยู่ในเซิร์ฟเวอร์
  if (!res.ok) throw new Error(`อ่านข้อมูลสมาชิกไม่สำเร็จ (HTTP ${res.status})`);

  return res.json();
}

/**
 * ตัดสินว่าผู้ใช้คนนี้เข้า dashboard ได้ไหม และเป็นระดับอะไร
 *
 * ใช้กฎเดียวกับปุ่มในบอท (lib/ticket/guards.js):
 *   admin = มียศแอดมินใหญ่ หรือมีสิทธิ์ Administrator
 *   staff = มียศทีมงาน
 *   ที่เหลือเข้าไม่ได้
 *
 * @param {object} member ข้อมูลจาก fetchMember()
 * @param {object|null} settings การตั้งค่าระบบตั๋ว
 * @returns {{ allowed: boolean, level: 'admin'|'staff'|'none', reason?: string }}
 */
function resolveAccess(member, settings) {
  if (!member) {
    return { allowed: false, level: 'none', reason: 'คุณไม่ได้อยู่ในเซิร์ฟเวอร์นี้' };
  }

  const roles = Array.isArray(member.roles) ? member.roles : [];

  // สิทธิ์ Administrator — Discord ส่งมาเป็น string ของ bitfield
  let isAdmin = false;
  try {
    isAdmin = (BigInt(member.permissions ?? '0') & ADMINISTRATOR) !== 0n;
  } catch {
    isAdmin = false;
  }

  if (settings?.adminRoleId && roles.includes(settings.adminRoleId)) isAdmin = true;

  if (isAdmin) return { allowed: true, level: 'admin' };

  if (settings?.staffRoleId && roles.includes(settings.staffRoleId)) {
    return { allowed: true, level: 'staff' };
  }

  return {
    allowed: false,
    level: 'none',
    reason: 'ต้องเป็นทีมงานหรือแอดมินใหญ่ของเซิร์ฟเวอร์นี้จึงเข้าได้',
  };
}

/**
 * ทำงานทั้งกระบวนการหลังได้ code จาก Discord
 * @returns {Promise<{ user: object, level: string, guildId: string }>}
 * @throws {Error} ถ้าล็อกอินไม่ผ่านหรือสิทธิ์ไม่ถึง
 */
async function completeLogin({ code, clientId, clientSecret, redirectUri, guildId }) {
  const token = await exchangeCode({ code, clientId, clientSecret, redirectUri });

  const [user, member] = await Promise.all([
    fetchUser(token),
    fetchMember(token, guildId).catch(() => null),
  ]);

  const settings = await ticketRepo.getSettings(guildId).catch(() => null);
  const access = resolveAccess(member, settings);

  if (!access.allowed) {
    const err = new Error(access.reason ?? 'ไม่มีสิทธิ์เข้าใช้');
    err.code = 'FORBIDDEN';
    throw err;
  }

  return {
    user: {
      id: user.id,
      username: user.global_name || user.username,
      tag: user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
    },
    level: access.level,
    guildId,
  };
}

/** middleware — กันคนที่ยังไม่ล็อกอิน */
function requireLogin(req, res, next) {
  if (req.session?.user) return next();

  // จำหน้าที่พยายามเข้า เพื่อพากลับมาหลังล็อกอิน
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

/** middleware — เฉพาะแอดมินใหญ่ */
function requireAdmin(req, res, next) {
  if (req.session?.user && req.session.level === 'admin') return next();

  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }

  return res.status(403).render('error', {
    title: 'สิทธิ์ไม่พอ',
    message: 'หน้านี้เปิดให้เฉพาะแอดมินใหญ่เท่านั้น',
    user: req.session.user,
  });
}

module.exports = {
  buildAuthUrl,
  newState,
  completeLogin,
  resolveAccess,
  requireLogin,
  requireAdmin,
};
