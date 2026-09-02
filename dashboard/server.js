/**
 * dashboard/server.js — เว็บ dashboard
 *
 * เปิดในเบราว์เซอร์เพื่อดูข้อมูลระบบตั๋วและห้องเสียง
 * แยกจากบอทคนละ process — ปิด dashboard บอทยังทำงาน / บอทดับ dashboard ยังดูข้อมูลได้
 *
 * ความปลอดภัย:
 *   - ต้องล็อกอินด้วย Discord ก่อน (OAuth2) — เข้าได้เฉพาะทีมงานและแอดมินใหญ่
 *   - ปิดล็อกอินได้ด้วย DASHBOARD_AUTH=off ใน .env (ใช้เฉพาะตอนทดสอบในเครื่อง)
 *   - อ่านข้อมูลเท่านั้น ไม่มีปุ่มแก้ไขอะไร — แก้ค่าต้องทำผ่านคำสั่งในบอท
 *
 * วิธีรัน:  npm run dashboard
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');

const data = require('./data');
const auth = require('./auth');
const views = require('./views');
const actions = require('./actions');
const { checkEnv, testConnection, DatabaseError } = require('../supabase');

// =====================================================================
//  ตรวจ environment
// =====================================================================

const PORT = Number(process.env.DASHBOARD_PORT) || 3000;
const {
  CLIENT_ID,
  CLIENT_SECRET,
  GUILD_ID,
  TOKEN,
  DASHBOARD_URL,
  SESSION_SECRET,
} = process.env;

const BASE_URL = (DASHBOARD_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const REDIRECT_URI = `${BASE_URL}/auth/callback`;

// =====================================================================
//  โหมดไม่ต้องล็อกอิน
//
//  ตั้ง DASHBOARD_AUTH=off ใน .env เพื่อข้ามการล็อกอิน Discord
//  ใช้ตอนทดสอบในเครื่องตัวเอง (localhost) จะได้ไม่ต้องตั้ง OAuth ก่อน
//
//  ⚠️ โหมดนี้ = ใครเปิด URL ได้ก็เห็นข้อมูลทั้งหมด
//     (ชื่อสมาชิกที่เปิดตั๋ว ใครรับเรื่อง การตั้งค่าระบบ)
//     ห้ามใช้ตอนเปิดออกอินเทอร์เน็ต — เปิด login กลับก่อนเสมอ
// =====================================================================

const AUTH_OFF = String(process.env.DASHBOARD_AUTH ?? '').toLowerCase() === 'off';

/** ผู้ใช้สมมติตอนปิด login — ให้ทุกหน้ามี user ไว้แสดงบน header */
const GUEST = {
  user: { id: '0', username: 'โหมดไม่ล็อกอิน', tag: 'guest', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png' },
  level: 'admin', // เห็นทุกหน้ารวมหน้าตั้งค่า
};

const missing = [];
if (!GUILD_ID) missing.push('GUILD_ID');

// CLIENT_ID / CLIENT_SECRET ใช้แค่ตอนล็อกอิน — โหมดปิด login ไม่ต้องมี
if (!AUTH_OFF) {
  if (!CLIENT_ID) missing.push('CLIENT_ID');
  if (!CLIENT_SECRET) missing.push('CLIENT_SECRET');
}

if (missing.length > 0) {
  console.error('');
  console.error(`❌ ไม่พบค่าที่จำเป็นใน .env: ${missing.join(', ')}`);
  console.error('');
  if (missing.includes('CLIENT_SECRET')) {
    console.error('   CLIENT_SECRET เอาจาก Discord Developer Portal:');
    console.error('     เลือกแอป -> OAuth2 -> Client Secret -> Reset Secret -> คัดลอก');
    console.error('');
  }
  if (missing.includes('GUILD_ID')) {
    console.error('   GUILD_ID = ID เซิร์ฟเวอร์ที่ dashboard จะแสดงข้อมูล');
    console.error('     Discord -> เปิด Developer Mode -> คลิกขวาชื่อเซิร์ฟเวอร์ -> Copy Server ID');
    console.error('');
  }
  console.error(`   และตั้ง Redirect URI ใน Developer Portal -> OAuth2 เป็น:`);
  console.error(`     ${REDIRECT_URI}`);
  console.error('');
  process.exit(1);
}

// =====================================================================
//  cache ชื่อห้อง / ยศ / ผู้ใช้
//
//  ฐานข้อมูลเก็บแต่ id (เช่น 1439869220153462834) ซึ่งอ่านไม่รู้เรื่อง
//  จึงถาม Discord ว่า id นี้คืออะไร แล้ว cache ไว้ 5 นาที
//  ถ้าไม่ cache ทุกครั้งที่เปิดหน้าจะยิง API หลายสิบครั้ง -> โดน rate limit
// =====================================================================

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = {
  at: 0,
  channels: new Map(),
  roles: new Map(),
  members: new Map(),
  guildName: null,
  guildIcon: null,
  // รายการสำหรับ dropdown ในหน้าตั้งค่า — เรียงตามที่เห็นใน Discord
  lists: { textChannels: [], voiceChannels: [], categories: [], roles: [] },
};

async function discord(path) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });

  if (!res.ok) throw new Error(`Discord API ${res.status} ที่ ${path}`);
  return res.json();
}

/** โหลดชื่อห้อง/ยศ/สมาชิกของเซิร์ฟเวอร์ (ใช้ cache ถ้ายังไม่หมดอายุ) */
async function refreshNames() {
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.channels.size > 0) return;

  if (!TOKEN) {
    // ไม่มี token ก็ยังใช้ dashboard ได้ แค่แสดงเป็น id ดิบ
    cache.at = Date.now();
    return;
  }

  try {
    const [guild, channels, roles] = await Promise.all([
      discord(`/guilds/${GUILD_ID}`),
      discord(`/guilds/${GUILD_ID}/channels`),
      discord(`/guilds/${GUILD_ID}/roles`),
    ]);

    cache.guildName = guild.name;

    cache.guildIcon = guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
      : null;

    cache.channels.clear();
    for (const ch of channels) cache.channels.set(ch.id, ch.name);

    cache.roles.clear();
    for (const r of roles) cache.roles.set(r.id, r.name);

    // ---- รายการสำหรับ dropdown ----
    // type: 0=text 2=voice 4=category 5=announcement
    const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0);

    cache.lists.textChannels = channels
      .filter((c) => c.type === 0 || c.type === 5)
      .sort(byPos)
      .map((c) => ({ id: c.id, name: c.name }));

    cache.lists.voiceChannels = channels
      .filter((c) => c.type === 2)
      .sort(byPos)
      .map((c) => ({ id: c.id, name: c.name }));

    cache.lists.categories = channels
      .filter((c) => c.type === 4)
      .sort(byPos)
      .map((c) => ({ id: c.id, name: c.name }));

    // ยศ: ตัด @everyone และยศที่บอท/ระบบอื่นจัดการ (มอบให้คนไม่ได้)
    // เรียงจากสูงลงต่ำเหมือนที่เห็นใน Discord
    cache.lists.roles = roles
      .filter((r) => r.id !== GUILD_ID && !r.managed)
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .map((r) => ({ id: r.id, name: r.name }));

    // สมาชิกอาจมีเยอะ — ขอมาแค่ 1000 คนแรกพอสำหรับแสดงชื่อทีมงาน
    try {
      const members = await discord(`/guilds/${GUILD_ID}/members?limit=1000`);
      cache.members.clear();
      for (const m of members) {
        if (m.user) cache.members.set(m.user.id, m.nick || m.user.global_name || m.user.username);
      }
    } catch (err) {
      // ต้องเปิด SERVER MEMBERS INTENT ถึงจะดึงได้ — ไม่ได้ก็ไม่เป็นไร
      console.warn(`⚠️  ดึงรายชื่อสมาชิกไม่ได้: ${err.message} (จะแสดงเป็น ID)`);
    }

    cache.at = Date.now();
  } catch (err) {
    console.warn(`⚠️  โหลดชื่อจาก Discord ไม่สำเร็จ: ${err.message} (จะแสดงเป็น ID)`);
    cache.at = Date.now(); // กันยิงซ้ำรัวๆ ตอน API ล่ม
  }
}

/** ตัวแปลง id -> ชื่อ ส่งให้ views ใช้ */
const resolve = {
  channel: (id) => (id ? (cache.channels.has(id) ? `#${cache.channels.get(id)}` : id) : '—'),
  role: (id) => (id ? (cache.roles.has(id) ? `@${cache.roles.get(id)}` : id) : '—'),
  user: (id) => (id ? (cache.members.has(id) ? cache.members.get(id) : id) : '—'),
};

// =====================================================================
//  express
// =====================================================================

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // เผื่อรันหลัง reverse proxy (nginx / cloudflare)

app.use(
  session({
    name: 'dash.sid',
    secret: SESSION_SECRET || require('node:crypto').randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // JS ในหน้าเว็บอ่าน cookie ไม่ได้ ลดผลของ XSS
      sameSite: 'lax', // กัน CSRF จากเว็บอื่น
      secure: BASE_URL.startsWith('https://'),
      maxAge: 8 * 60 * 60 * 1000, // 8 ชั่วโมง
    },
  }),
);

if (!SESSION_SECRET) {
  console.warn(
    '⚠️  ไม่ได้ตั้ง SESSION_SECRET ใน .env — ใช้ค่าสุ่มชั่วคราว\n' +
      '   ผลคือทุกคนต้องล็อกอินใหม่ทุกครั้งที่รีสตาร์ท dashboard\n' +
      '   แก้: เพิ่ม SESSION_SECRET=<ข้อความสุ่มยาวๆ> ใน .env',
  );
}

const send = (res, html) => res.type('html').send(html);

// อ่านค่าจากฟอร์ม (application/x-www-form-urlencoded)
// จำกัดขนาดไว้ เพราะฟอร์มของเรามีแค่ id สั้นๆ ไม่ต้องรับข้อมูลใหญ่
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

/**
 * ข้อความผลลัพธ์ที่แสดงครั้งเดียวหลัง redirect (flash)
 * เก็บใน session เพราะหลัง POST เราต้อง redirect (กันกด refresh แล้วส่งซ้ำ)
 */
function setFlash(req, ok, message) {
  req.session.flash = { ok, message };
}

function takeFlash(req) {
  const f = req.session.flash;
  delete req.session.flash;
  return f ?? null;
}

/** เฉพาะแอดมินใหญ่ — ใช้กับทุกหน้าที่แก้ข้อมูลได้ */
function adminOnly(req, res, next) {
  if (req.session?.user && req.session.level === 'admin') return next();

  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }

  res.status(403);
  return send(
    res,
    views.errorPage({
      title: 'สิทธิ์ไม่พอ',
      message: 'การตั้งค่าระบบทำได้เฉพาะแอดมินใหญ่เท่านั้น',
      user: req.session.user,
      level: req.session.level,
      authOff: AUTH_OFF,
    }),
  );
}

// ---------------------------------------------------------------------
// โหมดปิด login — ใส่ผู้ใช้สมมติให้ทุก request
// ต้องอยู่ก่อนทุก route เพื่อให้ requireLogin ผ่านไปได้เลย
// ---------------------------------------------------------------------

if (AUTH_OFF) {
  app.use((req, res, next) => {
    req.session.user = GUEST.user;
    req.session.level = GUEST.level;
    next();
  });
}

// ---------------------------------------------------------------------
// ล็อกอิน
//
// โหมดปิด login: เส้นทางเหล่านี้พาไปหน้าแรกเลย ไม่ต้องผ่าน Discord
// (เก็บไว้ไม่ลบ เพื่อให้เปิด login กลับได้ด้วยการลบ DASHBOARD_AUTH=off)
// ---------------------------------------------------------------------

app.get('/login', async (req, res) => {
  if (AUTH_OFF || req.session.user) return res.redirect('/');

  await refreshNames();

  const error = req.session.loginError;
  delete req.session.loginError;

  send(res, views.loginPage({ error, guildName: cache.guildName }));
});

app.get('/auth/discord', (req, res) => {
  if (AUTH_OFF) return res.redirect('/');

  const state = auth.newState();
  req.session.oauthState = state;

  res.redirect(auth.buildAuthUrl(CLIENT_ID, REDIRECT_URI, state));
});

app.get('/auth/callback', async (req, res) => {
  if (AUTH_OFF) return res.redirect('/');

  const { code, state, error: oauthError } = req.query;

  // ผู้ใช้กด Cancel ที่หน้า Discord
  if (oauthError) {
    req.session.loginError = 'คุณยกเลิกการเข้าสู่ระบบ';
    return res.redirect('/login');
  }

  // state ไม่ตรง = อาจถูกหลอกให้กดลิงก์ (CSRF)
  if (!state || state !== req.session.oauthState) {
    req.session.loginError = 'ลิงก์เข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่';
    return res.redirect('/login');
  }

  delete req.session.oauthState;

  if (!code) {
    req.session.loginError = 'ไม่ได้รับรหัสยืนยันจาก Discord';
    return res.redirect('/login');
  }

  try {
    const result = await auth.completeLogin({
      code,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      guildId: GUILD_ID,
    });

    req.session.user = result.user;
    req.session.level = result.level;

    const back = req.session.returnTo || '/';
    delete req.session.returnTo;

    console.log(`🔓 ${result.user.tag} (${result.level}) เข้าสู่ระบบ`);

    return res.redirect(back);
  } catch (err) {
    if (err.code === 'FORBIDDEN') {
      req.session.loginError = err.message;
    } else {
      console.error('❌ ล็อกอินผิดพลาด:', err);
      req.session.loginError = `เข้าสู่ระบบไม่สำเร็จ: ${err.message}`;
    }
    return res.redirect('/login');
  }
});

app.get('/logout', (req, res) => {
  if (AUTH_OFF) return res.redirect('/');

  const tag = req.session?.user?.tag;
  req.session.destroy(() => {
    if (tag) console.log(`🔒 ${tag} ออกจากระบบ`);
    res.redirect('/login');
  });
});

// ---------------------------------------------------------------------
// หน้าเนื้อหา (ต้องล็อกอิน)
// ---------------------------------------------------------------------

/** ห่อ handler ให้ error ไม่ทำ server ดับ */
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(`❌ ${req.method} ${req.path} ผิดพลาด:`, err);

    const message =
      err instanceof DatabaseError
        ? err.userMessage.replace(/^❌\s*/, '')
        : `เกิดข้อผิดพลาด: ${err.message}`;

    res.status(500);
    send(
      res,
      views.errorPage({
        title: 'เกิดข้อผิดพลาด',
        message,
        user: req.session?.user,
        level: req.session?.level,
        authOff: AUTH_OFF,
      }),
    );
  }
};

app.get(
  '/',
  auth.requireLogin,
  wrap(async (req, res) => {
    await refreshNames();
    const overview = await data.getOverview(GUILD_ID);

    send(
      res,
      views.overviewPage({
        data: overview,
        user: req.session.user,
        level: req.session.level,
        authOff: AUTH_OFF,
        guildName: cache.guildName,
        resolve,
      }),
    );
  }),
);

app.get(
  '/tickets',
  auth.requireLogin,
  wrap(async (req, res) => {
    await refreshNames();

    const allowed = ['all', 'open', 'closed', 'unclaimed'];
    const status = allowed.includes(req.query.status) ? req.query.status : 'all';

    const result = await data.listTickets(GUILD_ID, { status, page: req.query.page });

    send(
      res,
      views.ticketsPage({
        result,
        status,
        user: req.session.user,
        level: req.session.level,
        authOff: AUTH_OFF,
        resolve,
      }),
    );
  }),
);

app.get(
  '/voice',
  auth.requireLogin,
  wrap(async (req, res) => {
    await refreshNames();
    const overview = await data.getOverview(GUILD_ID);

    send(
      res,
      views.voicePage({
        data: overview,
        user: req.session.user,
        level: req.session.level,
        authOff: AUTH_OFF,
        resolve,
      }),
    );
  }),
);

app.get(
  '/tickets/:channelId/chat',
  auth.requireLogin,
  wrap(async (req, res) => {
    await refreshNames();
    const { channelId } = req.params;

    const result = await data.getTicketChat(GUILD_ID, channelId);

    if (!result.ticket) {
      res.status(404);
      return send(
        res,
        views.errorPage({
          title: 'ไม่พบตั๋ว',
          message: 'ไม่พบตั๋วนี้ หรือตั๋วนี้ไม่ได้อยู่ในเซิร์ฟเวอร์นี้',
          user: req.session.user,
          level: req.session.level,
          authOff: AUTH_OFF,
        }),
      );
    }

    send(
      res,
      views.ticketChatPage({
        ticket: {
          ticketNumber: result.ticket.ticketNumber,
          userId: result.ticket.userId,
          userTag: result.ticket.userTag,
          status: result.ticket.status,
          claimedBy: result.ticket.claimedBy,
          closedBy: result.ticket.closedBy,
          createdAt: result.ticket.createdAt,
          closedAt: result.ticket.closedAt,
        },
        messages: result.messages,
        source: result.source,
        note: result.note,
        user: req.session.user,
        level: req.session.level,
        authOff: AUTH_OFF,
        resolve,
      }),
    );
  }),
);

app.get(
  '/settings',
  auth.requireLogin,
  adminOnly, // ทีมงานไม่ต้องเห็นการตั้งค่าระบบ (ใช้ตัวเดียวกับ POST)
  wrap(async (req, res) => {
    await refreshNames();
    const overview = await data.getOverview(GUILD_ID);

    send(
      res,
      views.settingsPage({
        data: overview,
        user: req.session.user,
        level: req.session.level,
        authOff: AUTH_OFF,
        resolve,
        lists: cache.lists,
        flash: takeFlash(req),
      }),
    );
  }),
);

app.get(
  '/post',
  auth.requireLogin,
  wrap(async (req, res) => {
    await refreshNames();

    send(
      res,
      views.postMessagePage({
        user: req.session.user,
        level: req.session.level,
        authOff: AUTH_OFF,
        lists: cache.lists,
        flash: takeFlash(req),
      }),
    );
  }),
);

// ---------------------------------------------------------------------
// บันทึกการตั้งค่า (POST)
//
// ทุกเส้นทางที่นี่แก้ข้อมูลจริง จึงต้อง:
//   1. เป็นแอดมินใหญ่
//   2. redirect กลับหลังทำเสร็จ (กันกด refresh แล้วส่งซ้ำ)
//   3. ล้าง cache ชื่อ เพราะ panel ย้ายห้องแล้ว
// ---------------------------------------------------------------------

/** ห่อ handler ของ POST — จับ error แล้วแสดงเป็นข้อความบนหน้าตั้งค่า */
const post = (fn) => [
  auth.requireLogin,
  adminOnly,
  async (req, res) => {
    try {
      const message = await fn(req);
      setFlash(req, true, message);
    } catch (err) {
      console.error(`❌ POST ${req.path}: ${err.message}`);

      setFlash(
        req,
        false,
        err instanceof DatabaseError ? err.userMessage.replace(/^❌\s*/, '') : err.message,
      );
    }

    // ล้าง cache เพื่อให้หน้าถัดไปเห็นค่าล่าสุด
    cache.at = 0;
    res.redirect('/settings');
  },
];

const guildInfo = () => ({ name: cache.guildName ?? '', iconURL: cache.guildIcon });

// ---- ห้องเปิดตั๋ว (ย้าย panel จริง) ----
app.post(
  '/settings/panel-channel',
  ...post(async (req) => {
    const id = String(req.body.channelId ?? '').trim();
    if (!id) throw new Error('ยังไม่ได้เลือกห้อง');

    const r = await actions.movePanelChannel(GUILD_ID, id, guildInfo());

    return `ย้ายปุ่มเปิดตั๋วไปห้อง #${cache.channels.get(r.channelId) ?? r.channelId} แล้ว (ลบใบเก่าให้ด้วย)`;
  }),
);

// ---- หมวดห้องตั๋ว ----
app.post(
  '/settings/category',
  ...post(async (req) => {
    const id = String(req.body.categoryId ?? '').trim();
    if (!id) throw new Error('ยังไม่ได้เลือกหมวด');

    const r = await actions.setCategory(GUILD_ID, id);

    return `เปลี่ยนหมวดห้องตั๋วเป็น "${r.name}" แล้ว (มีห้องอยู่ ${r.childCount}/50) — มีผลกับตั๋วที่เปิดใหม่`;
  }),
);

// ---- ยศทีมงาน ----
app.post(
  '/settings/staff-role',
  ...post(async (req) => {
    const id = String(req.body.roleId ?? '').trim();
    if (!id) throw new Error('ยศทีมงานต้องเลือก ไม่สามารถเว้นว่างได้');

    const r = await actions.setRole(GUILD_ID, 'staff', id);

    return `เปลี่ยนยศทีมงานเป็น @${r.name} แล้ว`;
  }),
);

// ---- ยศแอดมินใหญ่ (เว้นว่างได้) ----
app.post(
  '/settings/admin-role',
  ...post(async (req) => {
    const id = String(req.body.roleId ?? '').trim();

    const r = await actions.setRole(GUILD_ID, 'admin', id || null);

    return r.cleared
      ? 'ล้างยศแอดมินใหญ่แล้ว — จะใช้สิทธิ์ Administrator ของ Discord แทน'
      : `เปลี่ยนยศแอดมินใหญ่เป็น @${r.name} แล้ว`;
  }),
);

// ---- ห้องแผงทีมงาน ----
app.post(
  '/settings/staff-panel',
  ...post(async (req) => {
    const id = String(req.body.channelId ?? '').trim();

    const r = await actions.movePanel(GUILD_ID, 'staff', id || null, guildInfo());

    return r.removed
      ? 'ถอดแผงทีมงานออกแล้ว (ลบข้อความแผงให้ด้วย)'
      : `ส่งแผงทีมงานไปห้อง #${cache.channels.get(r.channelId) ?? r.channelId} แล้ว`;
  }),
);

// ---- ห้องแผงแอดมินใหญ่ ----
app.post(
  '/settings/super-panel',
  ...post(async (req) => {
    const id = String(req.body.channelId ?? '').trim();

    const r = await actions.movePanel(GUILD_ID, 'super', id || null, guildInfo());

    return r.removed
      ? 'ถอดแผงแอดมินใหญ่ออกแล้ว — ⚠️ ไฟล์ transcript จะไม่ถูกเก็บไว้ตรวจสอบ'
      : `ส่งแผงแอดมินใหญ่ไปห้อง #${cache.channels.get(r.channelId) ?? r.channelId} แล้ว (เป็นปลายทางไฟล์ transcript ด้วย)`;
  }),
);

// ---- ห้องสร้างห้องเสียง ----
app.post(
  '/settings/voice-creator',
  ...post(async (req) => {
    const id = String(req.body.channelId ?? '').trim();
    if (!id) throw new Error('ยังไม่ได้เลือกห้อง');

    const r = await actions.setVoiceCreator(GUILD_ID, id);

    return `เปลี่ยนห้องสร้างห้องเป็น 🔊 ${r.name} แล้ว`;
  }),
);

// ---- โพสต์ข้อความ ----
app.post(
  '/post-message',
  auth.requireLogin,
  async (req, res) => {
    try {
      const channelId = String(req.body.channelId ?? '').trim();
      const content = String(req.body.content ?? '');

      if (!channelId) throw new Error('ยังไม่ได้เลือกห้อง');

      const r = await actions.postMessage(GUILD_ID, channelId, content);

      setFlash(req, true, `ส่งข้อความไปห้อง #${r.channelName} เรียบร้อยแล้ว`);
    } catch (err) {
      console.error(`❌ POST /post-message: ${err.message}`);

      const { DatabaseError } = require('./supabase');
      setFlash(
        req,
        false,
        err instanceof DatabaseError ? err.userMessage.replace(/^❌\s*/, '') : err.message,
      );
    }

    res.redirect('/post');
  },
);

/** ตรวจสุขภาพ — ใช้กับ uptime monitor ไม่ต้องล็อกอิน แต่ไม่บอกข้อมูลอะไร */
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------

app.use((req, res) => {
  res.status(404);
  send(
    res,
    views.errorPage({
      title: 'ไม่พบหน้านี้',
      message: `ไม่มีหน้า ${req.path} ในระบบ`,
      user: req.session?.user,
      level: req.session?.level,
        authOff: AUTH_OFF,
    }),
  );
});

// =====================================================================
//  เริ่มทำงาน
// =====================================================================

async function main() {
  console.log('');
  console.log('═'.repeat(62));
  console.log('  📊 Dashboard — ระบบตั๋ว + ห้องเสียง');
  console.log('═'.repeat(62));
  console.log('');

  // ----- ตรวจ Supabase -----
  const envStatus = checkEnv();
  if (!envStatus.ok) {
    console.error(`❌ ${envStatus.message}`);
    process.exit(1);
  }
  if (envStatus.message) console.warn(envStatus.message);

  console.log('🔌 ทดสอบการเชื่อมต่อ Supabase...');
  const dbStatus = await testConnection();

  if (!dbStatus.ok) {
    console.error('');
    console.error(`❌ ${dbStatus.message}`);
    console.error('');
    process.exit(1);
  }

  console.log(`   ✅ ${dbStatus.message}`);
  console.log('');

  // ----- โหลดชื่อจาก Discord -----
  await refreshNames();
  if (cache.guildName) {
    console.log(`🏠 เซิร์ฟเวอร์: ${cache.guildName}`);
    console.log(`   ห้อง ${cache.channels.size} · ยศ ${cache.roles.size} · สมาชิก ${cache.members.size}`);
    console.log('');
  }

  app.listen(PORT, () => {
    console.log('═'.repeat(62));
    console.log(`  ✅ Dashboard พร้อมใช้งาน`);
    console.log(`     เปิดที่ : ${BASE_URL}`);
    console.log(`     ล็อกอิน : ${AUTH_OFF ? '🔓 ปิดอยู่ (ไม่ต้องล็อกอิน)' : '🔒 ต้องล็อกอินด้วย Discord'}`);
    console.log('═'.repeat(62));
    console.log('');

    if (AUTH_OFF) {
      console.log('⚠️  โหมดไม่ล็อกอิน — ใครเปิด URL นี้ได้ก็เห็นข้อมูลทั้งหมด');
      console.log('     (ชื่อสมาชิกที่เปิดตั๋ว ใครรับเรื่อง การตั้งค่าระบบ)');
      console.log('');
      console.log('     ใช้ได้เฉพาะตอนทดสอบในเครื่องตัวเอง');
      console.log('     ถ้าจะเปิดให้คนอื่นเข้า ให้ลบบรรทัด DASHBOARD_AUTH=off ใน .env');
      console.log('     แล้วตั้ง CLIENT_SECRET + Redirect URI ก่อน');
    } else {
      console.log('⚙️  ต้องตั้ง Redirect URI ใน Discord Developer Portal:');
      console.log('     เลือกแอป -> OAuth2 -> Redirects -> Add Redirect');
      console.log(`     ${REDIRECT_URI}`);
    }

    console.log('');
    console.log('   (กด Ctrl+C เพื่อปิด)');
    console.log('');
  });
}

process.on('unhandledRejection', (reason) => console.error('❌ Promise ที่ไม่ได้จับ error:', reason));

main().catch((err) => {
  console.error('❌ เปิด dashboard ไม่สำเร็จ:', err);
  process.exit(1);
});
