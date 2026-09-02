/**
 * dashboard/views.js — สร้าง HTML ของหน้า dashboard
 *
 * เขียน HTML เองแทนการใช้ template engine (ejs/pug) เพื่อไม่เพิ่ม dependency
 * และให้เห็นชัดว่า output คืออะไร
 *
 * ⚠️ กฎสำคัญ: ข้อมูลจากฐานข้อมูลทุกตัว (ชื่อผู้ใช้ ชื่อห้อง) ต้องผ่าน esc() ก่อน
 * เพราะชื่อ Discord ใส่ < > " ได้ ถ้าไม่ escape จะกลายเป็น XSS
 */

/** แปลงอักขระที่ทำให้ HTML พังหรือเกิด XSS */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** วันเวลาแบบไทย */
function thaiDate(value, withTime = true) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: withTime ? 'short' : undefined,
      timeZone: 'Asia/Bangkok',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** เวลาผ่านมาแล้วเท่าไหร่ */
function ago(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '—';

  const min = Math.floor(diff / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;

  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} วันที่แล้ว`;

  return thaiDate(value, false);
}

// =====================================================================
//  CSS — ฝังในหน้าเลย ไม่ต้องโหลดไฟล์แยก
// =====================================================================

const STYLE = `
:root {
  --bg: #0f1117; --panel: #171a21; --panel2: #1e222b; --line: #2a2f3a;
  --text: #e6e8ee; --muted: #9aa3b2;
  --blue: #5865f2; --green: #57f287; --red: #ed4245; --yellow: #fee75c; --purple: #a970ff;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: "Segoe UI", "Noto Sans Thai", Tahoma, sans-serif;
  font-size: 15px; line-height: 1.6;
}
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ---------- โครงหน้า ---------- */
header {
  background: var(--panel); border-bottom: 1px solid var(--line);
  padding: 14px 24px; display: flex; align-items: center; gap: 16px;
  position: sticky; top: 0; z-index: 10; flex-wrap: wrap;
}
header .brand { font-weight: 700; font-size: 17px; }
header nav { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; align-items: center; }
header nav a {
  padding: 7px 14px; border-radius: 8px; color: var(--muted); font-size: 14px;
}
header nav a:hover { background: var(--panel2); color: var(--text); text-decoration: none; }
header nav a.active { background: var(--blue); color: #fff; }
.me { display: flex; align-items: center; gap: 9px; padding-left: 14px; border-left: 1px solid var(--line); }
.me img { width: 30px; height: 30px; border-radius: 50%; }
.me .lv { font-size: 11px; color: var(--muted); }

main { max-width: 1180px; margin: 0 auto; padding: 26px 24px 60px; }
h1 { font-size: 23px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 30px 0 12px; }
.sub { color: var(--muted); font-size: 14px; margin-bottom: 22px; }

/* ---------- การ์ดสถิติ ---------- */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }
.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px;
}
.card .k { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
.card .v { font-size: 27px; font-weight: 700; line-height: 1.2; }
.card .n { color: var(--muted); font-size: 12px; margin-top: 4px; }
.card.hl-green .v { color: var(--green); }
.card.hl-red .v { color: var(--red); }
.card.hl-yellow .v { color: var(--yellow); }
.card.hl-purple .v { color: var(--purple); }

/* ---------- กล่องเนื้อหา ---------- */
.box {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 12px; padding: 18px; margin-bottom: 18px;
}
.box h3 { margin: 0 0 14px; font-size: 15px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 820px) { .two { grid-template-columns: 1fr; } }

/* ---------- ตาราง ---------- */
.tw { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 9px 11px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; font-size: 12.5px; text-transform: uppercase; }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--panel2); }

/* ---------- ป้าย ---------- */
.tag {
  display: inline-block; padding: 2px 9px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
}
.tag.open { background: rgba(87,242,135,.15); color: var(--green); }
.tag.closed { background: rgba(154,163,178,.15); color: var(--muted); }
.tag.wait { background: rgba(254,231,92,.15); color: var(--yellow); }
.tag.lock { background: rgba(237,66,69,.15); color: var(--red); }

/* ---------- กราฟแท่ง ---------- */
.chart { display: flex; align-items: flex-end; gap: 5px; height: 150px; margin-top: 10px; }
.chart .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.chart .bars { display: flex; align-items: flex-end; gap: 2px; height: 118px; width: 100%; justify-content: center; }
.chart .bar { width: 46%; border-radius: 3px 3px 0 0; min-height: 2px; }
.chart .bar.o { background: var(--blue); }
.chart .bar.c { background: #3a4050; }
.chart .lb { font-size: 10.5px; color: var(--muted); }
.legend { display: flex; gap: 16px; font-size: 12.5px; color: var(--muted); margin-top: 10px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }

/* ---------- อันดับ ---------- */
.rank { display: flex; flex-direction: column; gap: 9px; }
.rank .row { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.rank .row .n { width: 26px; color: var(--muted); font-size: 13px; }
.rank .row .id { flex: 1; font-family: ui-monospace, monospace; font-size: 12.5px; color: var(--muted); }
.rank .row .track { flex: 2; height: 7px; background: var(--panel2); border-radius: 4px; overflow: hidden; }
.rank .row .fill { height: 100%; background: var(--blue); }
.rank .row .c { width: 52px; text-align: right; font-weight: 600; }

/* ---------- เบ็ดเตล็ด ---------- */
.empty { color: var(--muted); text-align: center; padding: 26px 0; font-size: 14px; }
.warn {
  background: rgba(254,231,92,.09); border: 1px solid rgba(254,231,92,.3);
  border-radius: 10px; padding: 13px 16px; margin-bottom: 18px; font-size: 14px;
}
.warn b { color: var(--yellow); }
.filters { display: flex; gap: 7px; margin-bottom: 14px; flex-wrap: wrap; }
.filters a {
  padding: 6px 13px; border-radius: 8px; background: var(--panel);
  border: 1px solid var(--line); color: var(--muted); font-size: 13.5px;
}
.filters a.on { background: var(--blue); border-color: var(--blue); color: #fff; }
.filters a:hover { text-decoration: none; color: var(--text); }
.pager { display: flex; gap: 7px; justify-content: center; margin-top: 18px; align-items: center; }
.pager a, .pager span {
  padding: 6px 13px; border-radius: 8px; background: var(--panel);
  border: 1px solid var(--line); font-size: 13.5px; color: var(--muted);
}
.pager a:hover { color: var(--text); text-decoration: none; }
.pager .cur { background: var(--blue); border-color: var(--blue); color: #fff; }
code { background: var(--panel2); padding: 1px 6px; border-radius: 4px; font-size: 12.5px; }
.mono { font-family: ui-monospace, monospace; font-size: 12.5px; color: var(--muted); }

/* ---------- ประวัติแชท ---------- */
.srcbar {
  display: inline-block; font-size: 12.5px; color: var(--muted);
  background: var(--panel2); padding: 5px 12px; border-radius: 20px;
}
.chat { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
.daysep { text-align: center; margin: 14px 0 6px; position: relative; }
.daysep::before {
  content: ''; position: absolute; top: 50%; left: 0; right: 0;
  height: 1px; background: var(--line);
}
.daysep span {
  position: relative; background: var(--panel); padding: 0 14px;
  font-size: 12px; color: var(--muted);
}
.msg {
  background: var(--panel2); border-radius: 10px; padding: 11px 14px;
  border-left: 3px solid var(--line);
}
.msg.opener { border-left-color: var(--blue); }
.msg.staff  { border-left-color: var(--green); }
.msg.bot    { border-left-color: #3a4050; opacity: .82; }
.msg .mh {
  display: flex; align-items: center; gap: 9px;
  font-size: 12.5px; margin-bottom: 5px; flex-wrap: wrap;
}
.msg .mh b { font-size: 13.5px; }
.msg .tagwho { color: var(--muted); font-size: 11.5px; }
.msg .mt { color: var(--muted); font-size: 11.5px; margin-left: auto; }
.msg .ct { font-size: 14px; line-height: 1.65; word-break: break-word; }
.msg .emb {
  margin-top: 7px; padding: 8px 11px; border-left: 2px solid var(--line);
  background: rgba(0,0,0,.18); border-radius: 5px;
  font-size: 13px; color: var(--muted); line-height: 1.6;
}
.msg .att { margin-top: 6px; font-size: 13px; }

/* ---------- ฟอร์มตั้งค่า ---------- */
.frow {
  display: grid; grid-template-columns: 1fr 260px auto; gap: 14px;
  align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line);
}
.frow:last-of-type { border-bottom: none; }
.flabel { font-size: 14px; font-weight: 600; }
.fnote { font-weight: 400; font-size: 12.5px; color: var(--muted); margin-top: 3px; line-height: 1.5; }
.fnote b { color: var(--text); font-weight: 600; }
.fctl select {
  width: 100%; padding: 8px 11px; border-radius: 8px;
  background: var(--panel2); color: var(--text);
  border: 1px solid var(--line); font-size: 13.5px;
  font-family: inherit;
}
.fctl select:focus { outline: none; border-color: var(--blue); }
.frow button {
  padding: 8px 18px; border-radius: 8px; border: none;
  background: var(--blue); color: #fff; font-size: 13.5px; font-weight: 600;
  cursor: pointer; font-family: inherit; white-space: nowrap;
  transition: background .2s;
}
.frow button:hover { background: #4752c4; }
.frow button:active { transform: scale(0.98); }
@media (max-width: 760px) {
  .frow { grid-template-columns: 1fr; gap: 9px; }
  .frow button { width: 100%; }
}

/* ---------- ข้อความผลลัพธ์ ---------- */
.flash {
  border-radius: 10px; padding: 13px 16px; margin-bottom: 18px; font-size: 14px;
}
.flash.ok { background: rgba(87,242,135,.1); border: 1px solid rgba(87,242,135,.35); }
.flash.bad { background: rgba(237,66,69,.1); border: 1px solid rgba(237,66,69,.35); }

/* ---------- ตัวช่วยเขียนโพสต์ ---------- */
.markdown-editor {
  margin-bottom: 10px; padding: 14px; background: var(--panel2);
  border: 1px solid var(--line); border-bottom: none; border-radius: 10px 10px 0 0;
}
.composer-label { color: var(--text); font-size: 13px; font-weight: 600; }
.markdown-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.markdown-actions button {
  padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel); color: var(--text); cursor: pointer;
  font: inherit; font-size: 13.5px;
}
.markdown-actions button.primary { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 600; }
.markdown-actions button:hover { filter: brightness(1.08); }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 12px; }
.theme-card {
  text-align: left; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--panel2); color: var(--text); cursor: pointer; font: inherit;
}
.theme-card:hover { border-color: var(--blue); background: #242936; }
.theme-card.on { border-color: var(--blue); background: rgba(88,101,242,.16); }
.theme-card b { display: block; font-size: 14px; margin-bottom: 3px; }
.theme-card span { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
.composer {
  background: var(--panel2); border: 1px solid var(--line); border-radius: 12px;
  padding: 14px; margin-bottom: 12px;
}
.composer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.composer-field.full { grid-column: 1 / -1; }
.composer-field label { display: block; color: var(--muted); font-size: 12.5px; font-weight: 600; margin-bottom: 5px; }
.composer-field input, .composer-field textarea {
  width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel); color: var(--text); font: inherit; font-size: 13.5px;
}
.composer-field textarea { min-height: 82px; resize: vertical; line-height: 1.55; }
.composer-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.composer-actions button {
  padding: 9px 14px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel); color: var(--text); cursor: pointer; font: inherit; font-size: 13.5px;
}
.composer-actions .primary { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 700; }
@media (max-width: 760px) { .composer-grid { grid-template-columns: 1fr; } }

/* ---------- หน้าล็อกอิน ---------- */
.mid { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.login {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  padding: 40px; max-width: 430px; text-align: center;
}
.login h1 { font-size: 21px; margin-bottom: 10px; }
.login p { color: var(--muted); font-size: 14px; margin-bottom: 26px; }
.btn {
  display: inline-block; background: var(--blue); color: #fff; padding: 12px 26px;
  border-radius: 10px; font-weight: 600; font-size: 15px;
}
.btn:hover { background: #4752c4; text-decoration: none; }
.err { background: rgba(237,66,69,.12); border: 1px solid rgba(237,66,69,.35);
  border-radius: 10px; padding: 13px; margin-bottom: 20px; font-size: 14px; text-align: left; }
`;

// =====================================================================
//  โครงหน้า
// =====================================================================

function layout({ title, body, user, level, active = '', authOff = false }) {
  const nav = user
    ? `
    <nav>
      <a href="/" class="${active === 'home' ? 'active' : ''}">ภาพรวม</a>
      <a href="/tickets" class="${active === 'tickets' ? 'active' : ''}">ตั๋ว</a>
      <a href="/voice" class="${active === 'voice' ? 'active' : ''}">ห้องเสียง</a>
      <a href="/post" class="${active === 'post' ? 'active' : ''}">โพสต์ข้อความ</a>
      ${level === 'admin' ? `<a href="/settings" class="${active === 'settings' ? 'active' : ''}">ตั้งค่า</a>` : ''}
      <div class="me">
        <img src="${esc(user.avatar)}" alt="">
        <div>
          <div>${esc(user.username)}</div>
          <div class="lv">${
            authOff ? '🔓 ไม่ได้ล็อกอิน' : level === 'admin' ? '👑 แอดมินใหญ่' : '🛠️ ทีมงาน'
          }</div>
        </div>
      </div>
      ${authOff ? '' : '<a href="/logout">ออก</a>'}
    </nav>`
    : '';

  // แถบเตือนตอนปิด login — ให้เห็นชัดว่าเว็บนี้ไม่มีการป้องกัน
  const banner = authOff
    ? `<div style="background:#ed4245;color:#fff;padding:9px 24px;font-size:13.5px;text-align:center">
        🔓 <b>โหมดไม่ล็อกอิน</b> — ใครเปิด URL นี้ได้ก็เห็นข้อมูลทั้งหมด
        ห้ามเปิดออกอินเทอร์เน็ต · เปิดล็อกอินกลับด้วยการลบ <code style="background:rgba(0,0,0,.25)">DASHBOARD_AUTH=off</code> ใน .env
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — Dashboard</title>
<style>${STYLE}</style>
</head>
<body>
${banner}
<header>
  <div class="brand">📊 Dashboard</div>
  ${nav}
</header>
<main>${body}</main>
</body>
</html>`;
}

// =====================================================================
//  หน้าล็อกอิน
// =====================================================================

function loginPage({ error, guildName } = {}) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>เข้าสู่ระบบ — Dashboard</title>
<style>${STYLE}</style>
</head>
<body>
<div class="mid">
  <div class="login">
    <h1>📊 Dashboard</h1>
    <p>${guildName ? esc(guildName) : 'ระบบตั๋ว + ห้องเสียง'}<br>เข้าได้เฉพาะทีมงานและแอดมินใหญ่</p>
    ${error ? `<div class="err">❌ ${esc(error)}</div>` : ''}
    <a href="/auth/discord" class="btn">เข้าสู่ระบบด้วย Discord</a>
  </div>
</div>
</body>
</html>`;
}

function errorPage({ title, message, user, level, authOff }) {
  return layout({
    title,
    user,
    level,
    authOff,
    body: `<h1>${esc(title)}</h1><div class="warn"><b>${esc(message)}</b></div><p><a href="/">← กลับหน้าภาพรวม</a></p>`,
  });
}

// =====================================================================
//  หน้าภาพรวม
// =====================================================================

function overviewPage({ data, user, level, guildName, resolve, authOff }) {
  const t = data.ticket;
  const v = data.voice;

  const warnings = [];
  if (!t.configured) warnings.push('ยังไม่ได้ตั้งค่าระบบตั๋ว — ใช้คำสั่ง <code>/setup-ticket</code> ใน Discord');
  if (!v.configured) warnings.push('ยังไม่ได้ตั้งค่าระบบห้องเสียง — ใช้คำสั่ง <code>/setup-voice</code>');
  if (t.configured && !t.settings?.superPanelChannelId) {
    warnings.push('ยังไม่ได้ตั้งห้องแอดมินใหญ่ — ไฟล์ transcript จะไม่ถูกเก็บไว้ตรวจสอบ');
  }
  if (t.unclaimed > 0) warnings.push(`มีตั๋ว <b>${t.unclaimed} ใบ</b> ที่ยังไม่มีทีมงานรับเรื่อง`);

  const maxDay = Math.max(1, ...t.perDay.map((d) => Math.max(d.opened, d.closed)));

  const chart = t.perDay
    .map(
      (d) => `
    <div class="col">
      <div class="bars">
        <div class="bar o" style="height:${Math.round((d.opened / maxDay) * 100)}%" title="${d.label} เปิด ${d.opened}"></div>
        <div class="bar c" style="height:${Math.round((d.closed / maxDay) * 100)}%" title="${d.label} ปิด ${d.closed}"></div>
      </div>
      <div class="lb">${esc(d.label)}</div>
    </div>`,
    )
    .join('');

  const maxRank = Math.max(1, ...t.staffRanking.map((r) => r.count));
  const MEDALS = ['🥇', '🥈', '🥉'];

  const ranking = t.staffRanking.length
    ? t.staffRanking
        .slice(0, 10)
        .map(
          (r, i) => `
      <div class="row">
        <span class="n">${MEDALS[i] ?? i + 1}</span>
        <span class="id">${esc(resolve.user(r.staffId))}</span>
        <span class="track"><span class="fill" style="width:${Math.round((r.count / maxRank) * 100)}%"></span></span>
        <span class="c">${r.count} ใบ</span>
      </div>`,
        )
        .join('')
    : '<div class="empty">ยังไม่มีทีมงานคนไหนกดรับเรื่อง</div>';

  const waiting = t.oldestWaiting.length
    ? `<div class="tw"><table>
        <thead><tr><th>เลขตั๋ว</th><th>ผู้เปิด</th><th>รอมาแล้ว</th></tr></thead>
        <tbody>${t.oldestWaiting
          .map(
            (x) => `<tr>
            <td><b>#${esc(x.ticket_number ?? '-')}</b></td>
            <td>${esc(x.user_tag || resolve.user(x.user_id))}</td>
            <td><span class="tag wait">${esc(ago(x.created_at))}</span></td>
          </tr>`,
          )
          .join('')}</tbody></table></div>`
    : '<div class="empty">✅ ไม่มีตั๋วค้างรอทีมงาน</div>';

  const recent = t.recent.length
    ? `<div class="tw"><table>
        <thead><tr><th>เลขตั๋ว</th><th>ผู้เปิด</th><th>สถานะ</th><th>ผู้รับเรื่อง</th><th>เปิดเมื่อ</th></tr></thead>
        <tbody>${t.recent
          .slice(0, 10)
          .map(
            (x) => `<tr>
            <td><b>#${esc(x.ticket_number ?? '-')}</b></td>
            <td>${esc(x.user_tag || resolve.user(x.user_id))}</td>
            <td>${
              x.status === 'open'
                ? x.claimed_by
                  ? '<span class="tag open">กำลังดูแล</span>'
                  : '<span class="tag wait">รอรับเรื่อง</span>'
                : '<span class="tag closed">ปิดแล้ว</span>'
            }</td>
            <td>${x.claimed_by ? esc(resolve.user(x.claimed_by)) : '<span style="color:var(--muted)">—</span>'}</td>
            <td>${esc(ago(x.created_at))}</td>
          </tr>`,
          )
          .join('')}</tbody></table></div>`
    : '<div class="empty">ยังไม่มีตั๋วในเซิร์ฟเวอร์นี้</div>';

  return layout({
    title: 'ภาพรวม',
    user,
    level,
    authOff,
    active: 'home',
    body: `
    <h1>ภาพรวม</h1>
    <div class="sub">${esc(guildName ?? '')} · อัปเดตเมื่อ ${esc(thaiDate(new Date()))}</div>

    ${warnings.map((w) => `<div class="warn">⚠️ ${w}</div>`).join('')}

    <div class="cards">
      <div class="card"><div class="k">ตั๋วทั้งหมด</div><div class="v">${t.total}</div><div class="n">เลขล่าสุด #${t.counter}</div></div>
      <div class="card hl-green"><div class="k">เปิดอยู่</div><div class="v">${t.open}</div><div class="n">${t.closed} ใบปิดแล้ว</div></div>
      <div class="card ${t.unclaimed > 0 ? 'hl-yellow' : ''}"><div class="k">รอรับเรื่อง</div><div class="v">${t.unclaimed}</div><div class="n">${t.unclaimed > 0 ? 'ต้องรีบดู' : 'ไม่มีค้าง'}</div></div>
      <div class="card"><div class="k">เวลาตอบเฉลี่ย</div><div class="v" style="font-size:20px">${esc(t.avgResponseText ?? '—')}</div><div class="n">ตั้งแต่เปิดถึงรับเรื่อง</div></div>
      <div class="card"><div class="k">เวลาปิดเฉลี่ย</div><div class="v" style="font-size:20px">${esc(t.avgHandleText ?? '—')}</div><div class="n">ตั้งแต่เปิดถึงปิด</div></div>
      <div class="card hl-purple"><div class="k">ห้องเสียงที่ใช้อยู่</div><div class="v">${v.activeRooms}</div><div class="n">ล็อกไว้ ${v.lockedRooms} ห้อง</div></div>
    </div>

    <div class="box" style="margin-top:18px">
      <h3>ตั๋วต่อวัน (14 วันล่าสุด)</h3>
      <div class="chart">${chart}</div>
      <div class="legend">
        <span><i style="background:var(--blue)"></i>เปิดตั๋ว</span>
        <span><i style="background:#3a4050"></i>ปิดตั๋ว</span>
      </div>
    </div>

    <div class="two">
      <div class="box"><h3>🏆 อันดับทีมงาน</h3><div class="rank">${ranking}</div></div>
      <div class="box"><h3>⏳ ตั๋วที่รอนานสุด</h3>${waiting}</div>
    </div>

    <div class="box">
      <h3>🕒 ตั๋วล่าสุด</h3>
      ${recent}
      <p style="margin:14px 0 0"><a href="/tickets">ดูตั๋วทั้งหมด →</a></p>
    </div>`,
  });
}

// =====================================================================
//  หน้ารายการตั๋ว
// =====================================================================

function ticketsPage({ result, status, user, level, resolve, authOff }) {
  const FILTERS = [
    ['all', 'ทั้งหมด'],
    ['open', 'เปิดอยู่'],
    ['unclaimed', 'รอรับเรื่อง'],
    ['closed', 'ปิดแล้ว'],
  ];

  const filters = FILTERS.map(
    ([k, label]) => `<a href="/tickets?status=${k}" class="${status === k ? 'on' : ''}">${label}</a>`,
  ).join('');

  const rows = result.rows.length
    ? result.rows
        .map(
          (x) => `<tr>
        <td><b>#${esc(x.ticket_number ?? '-')}</b></td>
        <td>${esc(x.user_tag || resolve.user(x.user_id))}</td>
        <td>${
          x.status === 'open'
            ? x.claimed_by
              ? '<span class="tag open">กำลังดูแล</span>'
              : '<span class="tag wait">รอรับเรื่อง</span>'
            : '<span class="tag closed">ปิดแล้ว</span>'
        }</td>
        <td>${x.claimed_by ? esc(resolve.user(x.claimed_by)) : '<span style="color:var(--muted)">—</span>'}</td>
        <td>${x.closed_by ? esc(resolve.user(x.closed_by)) : '<span style="color:var(--muted)">—</span>'}</td>
        <td>${esc(thaiDate(x.created_at))}</td>
        <td>${esc(x.closed_at ? thaiDate(x.closed_at) : '—')}</td>
        <td><a href="/tickets/${esc(x.channel_id)}/chat" style="color:var(--blue);text-decoration:none;font-size:13px">💬 ดูแชท</a></td>
      </tr>`,
        )
        .join('')
    : '';

  // แบ่งหน้า — แสดงหน้ารอบๆ หน้าปัจจุบัน ไม่แสดงทุกหน้า
  const pages = [];
  const { page, totalPages } = result;
  const from = Math.max(1, page - 2);
  const to = Math.min(totalPages, page + 2);

  if (page > 1) pages.push(`<a href="/tickets?status=${status}&page=${page - 1}">← ก่อน</a>`);
  if (from > 1) pages.push(`<a href="/tickets?status=${status}&page=1">1</a><span>…</span>`);
  for (let i = from; i <= to; i += 1) {
    pages.push(
      i === page
        ? `<span class="cur">${i}</span>`
        : `<a href="/tickets?status=${status}&page=${i}">${i}</a>`,
    );
  }
  if (to < totalPages) {
    pages.push(`<span>…</span><a href="/tickets?status=${status}&page=${totalPages}">${totalPages}</a>`);
  }
  if (page < totalPages) pages.push(`<a href="/tickets?status=${status}&page=${page + 1}">ถัดไป →</a>`);

  return layout({
    title: 'ตั๋ว',
    user,
    level,
    authOff,
    active: 'tickets',
    body: `
    <h1>รายการตั๋ว</h1>
    <div class="sub">ทั้งหมด ${result.total} ใบ · หน้า ${result.page} จาก ${result.totalPages}</div>

    <div class="filters">${filters}</div>

    <div class="box">
      ${
        rows
          ? `<div class="tw"><table>
        <thead><tr><th>เลขตั๋ว</th><th>ผู้เปิด</th><th>สถานะ</th><th>ผู้รับเรื่อง</th><th>ผู้ปิด</th><th>เปิดเมื่อ</th><th>ปิดเมื่อ</th><th>แชท</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
          : '<div class="empty">ไม่มีตั๋วในเงื่อนไขนี้</div>'
      }
    </div>

    ${result.totalPages > 1 ? `<div class="pager">${pages.join('')}</div>` : ''}`,
  });
}

// =====================================================================
//  หน้าห้องเสียง
// =====================================================================

function voicePage({ data, user, level, resolve, authOff }) {
  const v = data.voice;

  const rows = v.rooms.length
    ? v.rooms
        .map(
          (r) => `<tr>
        <td><b>${esc(r.name || 'ไม่มีชื่อ')}</b></td>
        <td>${esc(resolve.user(r.owner_id))}</td>
        <td>${r.is_locked ? '<span class="tag lock">🔒 ล็อก</span>' : '<span class="tag open">🔓 เปิด</span>'}</td>
        <td>${r.user_limit > 0 ? `${r.user_limit} คน` : 'ไม่จำกัด'}</td>
        <td>${esc(ago(r.created_at))}</td>
        <td class="mono">${esc(r.channel_id)}</td>
      </tr>`,
        )
        .join('')
    : '';

  return layout({
    title: 'ห้องเสียง',
    user,
    level,
    authOff,
    active: 'voice',
    body: `
    <h1>ห้องเสียงชั่วคราว</h1>
    <div class="sub">ห้องที่กำลังใช้งานอยู่ตอนนี้ — ห้องว่างจะถูกลบอัตโนมัติ</div>

    <div class="cards">
      <div class="card hl-purple"><div class="k">ห้องที่ใช้อยู่</div><div class="v">${v.activeRooms}</div></div>
      <div class="card hl-red"><div class="k">ล็อกไว้</div><div class="v">${v.lockedRooms}</div></div>
      <div class="card"><div class="k">ตั้งค่าระบบ</div><div class="v" style="font-size:19px">${v.configured ? '✅ แล้ว' : '❌ ยังไม่'}</div></div>
    </div>

    <div class="box" style="margin-top:18px">
      <h3>รายการห้อง</h3>
      ${
        rows
          ? `<div class="tw"><table>
        <thead><tr><th>ชื่อห้อง</th><th>เจ้าของ</th><th>สถานะ</th><th>จำกัดคน</th><th>สร้างเมื่อ</th><th>รหัสห้อง</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
          : '<div class="empty">ไม่มีห้องเสียงที่ใช้งานอยู่ตอนนี้</div>'
      }
    </div>`,
  });
}

// =====================================================================
//  หน้าตั้งค่า (แอดมินใหญ่เท่านั้น)
// =====================================================================

function settingsPage({ data, user, level, resolve, authOff, lists, flash }) {
  const t = data.ticket.settings;
  const v = data.voice.settings;

  const textChannels = lists?.textChannels ?? [];
  const voiceChannels = lists?.voiceChannels ?? [];
  const categories = lists?.categories ?? [];
  const roles = lists?.roles ?? [];

  /**
   * dropdown เลือกจากรายการ
   * ใช้ <select> เพราะแสดง "ทุกตัวเลือก" ได้จริง ต่างจากรายการเลือกห้องของ Discord
   * ที่ไม่แสดงทุกห้อง (ปัญหาที่เจอตอนใช้ /setup-ticket)
   */
  const select = (name, items, current, { emptyLabel = null, prefix = '' } = {}) => {
    const opts = [
      emptyLabel
        ? `<option value="">${esc(emptyLabel)}</option>`
        : '',
      ...items.map(
        (x) =>
          `<option value="${esc(x.id)}"${x.id === current ? ' selected' : ''}>${esc(prefix + x.name)}</option>`,
      ),
    ].join('');

    return `<select name="${esc(name)}">${opts}</select>`;
  };

  /** 1 แถวของฟอร์ม = 1 ค่าที่แก้ได้ */
  const field = (action, label, control, note, btn = 'บันทึก') => `
    <form method="post" action="${esc(action)}" class="frow">
      <div class="flabel">
        ${esc(label)}
        ${note ? `<div class="fnote">${note}</div>` : ''}
      </div>
      <div class="fctl">${control}</div>
      <button type="submit">${esc(btn)}</button>
    </form>`;

  const notice = flash
    ? `<div class="${flash.ok ? 'flash ok' : 'flash bad'}">${flash.ok ? '✅' : '❌'} ${esc(flash.message)}</div>`
    : '';

  const ticketBody = t
    ? `
    ${field(
      '/settings/panel-channel',
      'ห้องเปิดตั๋ว',
      select('channelId', textChannels, t.panelChannelId, { prefix: '#' }),
      `ตอนนี้: <b>${esc(resolve.channel(t.panelChannelId))}</b> — เปลี่ยนแล้วบอทจะ<b>ย้ายปุ่มเปิดตั๋วไปห้องใหม่</b>และลบใบเก่าให้`,
      'ย้าย',
    )}
    ${field(
      '/settings/category',
      'หมวดห้องตั๋ว',
      select('categoryId', categories, t.categoryId),
      `ตอนนี้: <b>${esc(resolve.channel(t.categoryId))}</b> — มีผลกับตั๋วที่เปิด<b>ใหม่</b> ห้องตั๋วเดิมไม่ย้าย`,
    )}
    ${field(
      '/settings/staff-role',
      'ยศทีมงาน',
      select('roleId', roles, t.staffRoleId, { prefix: '@' }),
      `ตอนนี้: <b>${esc(resolve.role(t.staffRoleId))}</b> — คนที่เห็นห้องตั๋วและกดรับเรื่องได้`,
    )}
    ${field(
      '/settings/admin-role',
      'ยศแอดมินใหญ่',
      select('roleId', roles, t.adminRoleId, { emptyLabel: '— ใช้สิทธิ์ Administrator —', prefix: '@' }),
      t.adminRoleId
        ? `ตอนนี้: <b>${esc(resolve.role(t.adminRoleId))}</b>`
        : 'ตอนนี้: <b>ใช้สิทธิ์ Administrator ของ Discord</b>',
    )}
    ${field(
      '/settings/staff-panel',
      'ห้องแผงทีมงาน',
      select('channelId', textChannels, t.adminPanelChannelId, { emptyLabel: '— ไม่ใช้ —', prefix: '#' }),
      t.adminPanelChannelId
        ? `ตอนนี้: <b>${esc(resolve.channel(t.adminPanelChannelId))}</b> — เลือก "ไม่ใช้" เพื่อถอดแผงออก`
        : 'ยังไม่ได้ตั้ง — เลือกห้องแล้วบอทจะส่งแผง 4 ปุ่มให้ทีมงาน',
    )}
    ${field(
      '/settings/super-panel',
      'ห้องแผงแอดมินใหญ่',
      select('channelId', textChannels, t.superPanelChannelId, { emptyLabel: '— ไม่ใช้ —', prefix: '#' }),
      t.superPanelChannelId
        ? `ตอนนี้: <b>${esc(resolve.channel(t.superPanelChannelId))}</b> — เป็นปลายทางไฟล์ <code>.txt</code> ตอนปิดตั๋วด้วย`
        : '<b style="color:var(--yellow)">ยังไม่ได้ตั้ง</b> — ไฟล์ transcript จะไม่ถูกเก็บไว้ตรวจสอบ',
    )}
    <div class="frow" style="border:none">
      <div class="flabel">เลขตั๋วล่าสุด<div class="fnote">เปลี่ยนไม่ได้จากที่นี่</div></div>
      <div class="fctl"><b>#${data.ticket.counter}</b></div>
      <span></span>
    </div>`
    : '<div class="empty">ยังไม่ได้ตั้งค่า — ใช้คำสั่ง <code>/setup-ticket</code> ใน Discord ก่อน</div>';

  const voiceBody = v
    ? `
    ${field(
      '/settings/voice-creator',
      'ห้องสร้างห้อง',
      select('channelId', voiceChannels, v.creatorChannelId, { prefix: '🔊 ' }),
      `ตอนนี้: <b>${esc(resolve.channel(v.creatorChannelId))}</b> — ห้องที่สมาชิกเข้าแล้วได้ห้องส่วนตัว`,
    )}
    <div class="frow" style="border:none">
      <div class="flabel">หมวดห้องเสียง<div class="fnote">เปลี่ยนตามหมวดของห้องสร้างห้องอัตโนมัติ</div></div>
      <div class="fctl"><b>${esc(resolve.channel(v.categoryId))}</b></div>
      <span></span>
    </div>`
    : '<div class="empty">ยังไม่ได้ตั้งค่า — ใช้คำสั่ง <code>/setup-voice</code> ใน Discord ก่อน</div>';

  return layout({
    title: 'ตั้งค่า',
    user,
    level,
    authOff,
    active: 'settings',
    body: `
    <h1>ตั้งค่าบอท</h1>
    <div class="sub">เปลี่ยนค่าได้จากที่นี่เลย — บอทจะย้าย panel จริงใน Discord ให้ด้วย</div>

    ${notice}

    ${
      authOff
        ? `<div class="warn" style="background:rgba(237,66,69,.1);border-color:rgba(237,66,69,.4)">
      <b style="color:var(--red)">⚠️ ล็อกอินปิดอยู่</b> — ใครเปิด URL นี้ได้ก็แก้การตั้งค่าบอทได้
      ถ้าจะเปิดให้คนอื่นเข้า ให้ลบ <code>DASHBOARD_AUTH=off</code> ใน .env ก่อน
    </div>`
        : ''
    }

    <div class="box">
      <h3>🎫 ระบบตั๋ว</h3>
      ${ticketBody}
    </div>

    <div class="box">
      <h3>🎙️ ระบบห้องเสียง</h3>
      ${voiceBody}
    </div>

    <div class="box">
      <h3>ℹ️ สิ่งที่แก้จากที่นี่ไม่ได้</h3>
      <ul style="margin:0;padding-left:20px;color:var(--muted);font-size:14px;line-height:1.9">
        <li><b>ข้อความของบอท</b> — แก้ที่ไฟล์ <code>messages.json</code> แล้วรีสตาร์ทบอท</li>
        <li><b>เลขตั๋ว</b> — เดินขึ้นเองอัตโนมัติ ป้องกันเลขซ้ำ</li>
        <li><b>ห้องตั๋วที่เปิดอยู่</b> — ปิดได้จากปุ่มในห้องตั๋วเท่านั้น (ต้องทำ transcript ก่อนลบ)</li>
      </ul>
    </div>`,
  });
}

/**
 * หน้าดูประวัติแชทของตั๋ว
 *
 * @param {object} p
 * @param {object} p.ticket
 * @param {Array} p.messages
 * @param {'live'|'saved'|'none'} p.source  live = ดึงสดจากห้อง, saved = จากที่เก็บไว้
 * @param {string|null} p.note
 */
function ticketChatPage({ ticket, messages, source, note, user, level, resolve, authOff }) {
  const SOURCE_LABEL = {
    live: '🟢 ดึงสดจากห้องที่ยังเปิดอยู่',
    saved: '💾 จากประวัติที่บอทเก็บไว้ตอนปิดตั๋ว',
    none: '⚠️ ไม่มีประวัติเก็บไว้',
  };

  // จัดกลุ่มข้อความตามวัน เพื่อใส่เส้นคั่นวันให้อ่านง่าย
  const groups = [];
  let lastDay = null;

  for (const m of messages) {
    const day = m.at ? String(m.at).slice(0, 10) : 'unknown';
    if (day !== lastDay) {
      groups.push({ day, items: [] });
      lastDay = day;
    }
    groups[groups.length - 1].items.push(m);
  }

  const bubbles = groups
    .map((g) => {
      const items = g.items
        .map((m) => {
          const isOpener = m.authorId === ticket.userId;
          const isBot = m.bot;

          // สีขอบบอกว่าใครพูด: ผู้เปิดตั๋ว / ทีมงาน / บอท
          const side = isBot ? 'bot' : isOpener ? 'opener' : 'staff';
          const who = isBot ? '🤖 บอท' : isOpener ? '👤 ผู้เปิดตั๋ว' : '🛠️ ทีมงาน';

          const files = (m.attachments ?? [])
            .map(
              (a) =>
                `<div class="att">📎 <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a></div>`,
            )
            .join('');

          // เนื้อหาต้อง escape ก่อนแล้วค่อยแปลง \n เป็น <br>
          const content = m.content
            ? `<div class="ct">${esc(m.content).replace(/\n/g, '<br>')}</div>`
            : '';

          const embed = m.embed
            ? `<div class="emb">${esc(m.embed).replace(/\n/g, '<br>')}</div>`
            : '';

          const empty = !m.content && !m.embed && !(m.attachments ?? []).length
            ? '<div class="ct" style="color:var(--muted);font-style:italic">(ไม่มีเนื้อหาข้อความ)</div>'
            : '';

          return `
      <div class="msg ${side}">
        <div class="mh">
          <b>${esc(m.authorTag)}</b>
          <span class="tagwho">${who}</span>
          <span class="mt">${esc(thaiDate(m.at))}</span>
        </div>
        ${content}${embed}${files}${empty}
      </div>`;
        })
        .join('');

      return `<div class="daysep"><span>${esc(thaiDate(g.day + 'T00:00:00Z', false))}</span></div>${items}`;
    })
    .join('');

  const statusTag =
    ticket.status === 'open'
      ? ticket.claimedBy
        ? '<span class="tag open">กำลังดูแล</span>'
        : '<span class="tag wait">รอรับเรื่อง</span>'
      : '<span class="tag closed">ปิดแล้ว</span>';

  return layout({
    title: `ตั๋ว #${ticket.ticketNumber ?? '-'}`,
    user,
    level,
    authOff,
    active: 'tickets',
    body: `
    <h1>ประวัติแชท — ตั๋ว #${esc(ticket.ticketNumber ?? '-')}</h1>
    <div class="sub"><a href="/tickets">← กลับรายการตั๋ว</a></div>

    <div class="box">
      <div class="tw"><table>
        <tr><td style="color:var(--muted)">ผู้เปิดตั๋ว</td><td><b>${esc(ticket.userTag || resolve.user(ticket.userId))}</b></td>
            <td style="color:var(--muted)">สถานะ</td><td>${statusTag}</td></tr>
        <tr><td style="color:var(--muted)">ผู้รับเรื่อง</td><td><b>${ticket.claimedBy ? esc(resolve.user(ticket.claimedBy)) : '—'}</b></td>
            <td style="color:var(--muted)">ผู้ปิดตั๋ว</td><td><b>${ticket.closedBy ? esc(resolve.user(ticket.closedBy)) : '—'}</b></td></tr>
        <tr><td style="color:var(--muted)">เปิดเมื่อ</td><td>${esc(thaiDate(ticket.createdAt))}</td>
            <td style="color:var(--muted)">ปิดเมื่อ</td><td>${esc(ticket.closedAt ? thaiDate(ticket.closedAt) : '—')}</td></tr>
      </table></div>
    </div>

    <div class="box">
      <h3>💬 บทสนทนา (${messages.length} ข้อความ)</h3>
      <div class="srcbar">${esc(SOURCE_LABEL[source] ?? '')}</div>
      ${note ? `<div class="warn" style="margin-top:12px">⚠️ ${esc(note)}</div>` : ''}
      ${
        messages.length
          ? `<div class="chat">${bubbles}</div>`
          : '<div class="empty">ไม่มีข้อความให้แสดง</div>'
      }
    </div>`,
  });
}

// =====================================================================
//  หน้าโพสต์ข้อความ
// =====================================================================

function postMessagePage({ user, level, authOff, lists, flash }) {
  const textChannels = lists?.textChannels ?? [];

  const notice = flash
    ? `<div class="${flash.ok ? 'flash ok' : 'flash bad'}">${flash.ok ? '✅' : '❌'} ${esc(flash.message)}</div>`
    : '';

  const channelOptions = textChannels
    .map((ch) => `<option value="${esc(ch.id)}">${esc('#' + ch.name)}</option>`)
    .join('');

  return layout({
    title: 'โพสต์ข้อความ',
    user,
    level,
    authOff,
    active: 'post',
    body: `
    <script>
    // Define functions before HTML to avoid ReferenceError
    const tick = String.fromCharCode(96);
    const themeConfig = {
      announce: {
        label: 'ประกาศสำคัญ',
        icon: '📢',
        title: 'แจ้งประกาศจากทีมงาน',
        details: 'ใส่รายละเอียดประกาศตรงนี้\\nระบุเงื่อนไขหรือข้อมูลที่ผู้เล่นต้องรู้',
        meta: 'โปรดอ่านให้ครบก่อนสอบถามทีมงาน',
        metaLabel: 'หมายเหตุ'
      },
      update: {
        label: 'อัปเดตแพตช์',
        icon: '🛠️',
        title: 'รายการอัปเดตประจำวันนี้',
        details: 'ปรับสมดุล: ...\\nแก้ไขบัค: ...\\nเพิ่มระบบ/ไอเทม: ...',
        meta: 'มีผลตั้งแต่วันนี้',
        metaLabel: 'มีผลตั้งแต่'
      },
      event: {
        label: 'กิจกรรมพิเศษ',
        icon: '🎉',
        title: 'ชื่อกิจกรรม',
        details: 'เวลา: ...\\nสถานที่/แชนแนล: ...\\nกติกา: ...',
        meta: 'ของรางวัล: ...',
        metaLabel: 'ของรางวัล'
      },
      code: {
        label: 'แจกโค้ด',
        icon: '🎁',
        title: 'โค้ดรางวัลสำหรับผู้เล่น',
        details: 'วิธีใช้:\\n1. เข้าเกม\\n2. เปิดหน้าแลกรางวัล\\n3. กรอกโค้ดและรับของรางวัล',
        meta: 'MU-XXXX-XXXX',
        metaLabel: 'โค้ด'
      }
    };
    let selectedTheme = 'announce';

    function applyTheme(theme, btn) {
      const textarea = document.getElementById('messageContent');
      const cfg = themeConfig[theme];
      selectedTheme = theme;
      document.querySelectorAll('[data-theme]').forEach((el) => el.classList.remove('on'));
      if (btn) btn.classList.add('on');
      document.getElementById('composerTitle').value = cfg.title;
      document.getElementById('composerDetails').value = cfg.details;
      document.getElementById('composerMetaLabel').textContent = cfg.metaLabel;
      document.getElementById('composerMeta').value = cfg.meta;
      generateThemePost();
      textarea.focus();
    }

    function bulletLines(value) {
      return value.split('\\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        return /^\\d+\\.|^- /.test(line) ? line : '- ' + line;
      });
    }

    function generateThemePost() {
      const textarea = document.getElementById('messageContent');
      const cfg = themeConfig[selectedTheme];
      const title = document.getElementById('composerTitle').value.trim() || cfg.title;
      const details = bulletLines(document.getElementById('composerDetails').value);
      const meta = document.getElementById('composerMeta').value.trim();
      const lines = [
        cfg.icon + ' **' + cfg.label + '**',
        '**หัวข้อ:** ' + title,
        ''
      ];

      if (details.length) lines.push('รายละเอียด:', ...details, '');
      if (meta) {
        const isCode = selectedTheme === 'code';
        lines.push('**' + cfg.metaLabel + ':** ' + (isCode ? tick + meta + tick : meta), '');
      }
      lines.push('> MU Online | ขอให้สนุกกับการเล่นครับ');

      textarea.value = lines.join('\\n');
      updateCharCount();
      updatePreview();
    }

    function formatText(prefix, suffix) {
      const textarea = document.getElementById('messageContent');
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const selectedText = text.substring(start, end) || 'text';

      const before = text.substring(0, start);
      const after = text.substring(end);

      const newText = before + prefix + selectedText + suffix + after;
      textarea.value = newText;

      const newPos = start + prefix.length + selectedText.length + suffix.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);

      updateCharCount();
      updatePreview();
    }

    function updateCharCount() {
      const textarea = document.getElementById('messageContent');
      const charCount = document.getElementById('charCount');
      const len = textarea.value.length;
      charCount.textContent = '(' + len + '/2000)';

      if (len > 1900) {
        charCount.style.color = 'var(--red)';
      } else if (len > 1500) {
        charCount.style.color = 'var(--yellow)';
      } else {
        charCount.style.color = 'var(--muted)';
      }
    }
    </script>

    <h1>โพสต์ข้อความ</h1>
    <div class="sub">ส่งข้อความจากบอทไปยังห้องที่เลือก — รองรับ Discord Markdown</div>

    ${notice}

    <div class="box">
      <form method="post" action="/post-message" id="postForm">
        <div class="frow" style="grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)">
          <div class="flabel">
            เลือกห้อง
            <div class="fnote">ห้องที่บอทจะส่งข้อความเข้าไป</div>
          </div>
          <div class="fctl">
            <select name="channelId" required style="width:100%;padding:10px 12px;border-radius:8px;background:var(--panel2);color:var(--text);border:1px solid var(--line);font-size:14px;font-family:inherit">
              <option value="">-- เลือกห้อง --</option>
              ${channelOptions}
            </select>
          </div>
        </div>

        <div style="padding:18px 0">
          <label style="display:block;font-weight:600;margin-bottom:10px;font-size:14px">
            ข้อความ
            <span style="color:var(--muted);font-weight:400;font-size:13px" id="charCount">(0/2000)</span>
          </label>

          <div class="composer">
            <div class="composer-label">ธีมโพสต์</div>
            <div class="theme-grid">
            <button type="button" class="theme-card on" data-theme="announce" onclick="applyTheme('announce', this)">
              <b>ประกาศ</b>
              <span>แจ้งข่าวสำคัญ กฎ หรือข้อมูลที่ผู้เล่นต้องอ่าน</span>
            </button>
            <button type="button" class="theme-card" data-theme="update" onclick="applyTheme('update', this)">
              <b>อัปเดต</b>
              <span>แพตช์โน้ต ปรับสมดุล แก้บัค เพิ่มระบบ</span>
            </button>
            <button type="button" class="theme-card" data-theme="event" onclick="applyTheme('event', this)">
              <b>กิจกรรม</b>
              <span>นัดเวลา รายละเอียดกิจกรรม และของรางวัล</span>
            </button>
            <button type="button" class="theme-card" data-theme="code" onclick="applyTheme('code', this)">
              <b>แจกโค้ด</b>
              <span>โค้ดรางวัล เงื่อนไข วันหมดเขต วิธีใช้งาน</span>
            </button>
            </div>

            <div class="composer-grid">
              <div class="composer-field">
                <label for="composerTitle">หัวข้อ</label>
                <input id="composerTitle" type="text" value="แจ้งประกาศจากทีมงาน" oninput="generateThemePost()">
              </div>
              <div class="composer-field">
                <label id="composerMetaLabel" for="composerMeta">หมายเหตุ</label>
                <input id="composerMeta" type="text" value="โปรดอ่านให้ครบก่อนสอบถามทีมงาน" oninput="generateThemePost()">
              </div>
              <div class="composer-field full">
                <label for="composerDetails">รายละเอียด</label>
                <textarea id="composerDetails" oninput="generateThemePost()">ใส่รายละเอียดประกาศตรงนี้
ระบุเงื่อนไขหรือข้อมูลที่ผู้เล่นต้องรู้</textarea>
              </div>
            </div>

            <div class="composer-actions">
              <button type="button" class="primary" onclick="generateThemePost()">สร้างข้อความจากธีม</button>
              <button type="button" onclick="document.getElementById('composerTitle').value='';document.getElementById('composerDetails').value='';document.getElementById('composerMeta').value='';generateThemePost()">ล้างฟอร์ม</button>
            </div>
          </div>

          <div class="markdown-editor">
            <div class="markdown-actions" style="margin-top:0">
              <button type="button" onclick="formatText('**', '**')">ตัวหนา</button>
              <button type="button" onclick="formatText('*', '*')">ตัวเอียง</button>
              <button type="button" onclick="formatText('__', '__')">ขีดเส้นใต้</button>
              <button type="button" onclick="formatText('~~', '~~')">ขีดฆ่า</button>
              <button type="button" onclick="formatText('&#96;', '&#96;')">โค้ด</button>
              <button type="button" onclick="formatText('> ', '')">อ้างอิง</button>
              <button type="button" onclick="formatText('||', '||')">ซ่อนข้อความ</button>
            </div>
          </div>

          <textarea
            name="content"
            id="messageContent"
            required
            rows="10"
            maxlength="2000"
            placeholder="พิมพ์ข้อความที่ต้องการส่ง...

**ตัวหนา** *ตัวเอียง* __ขีดเส้นใต้__ ~~ขีดฆ่า~~
\`inline code\` \`\`\`code block\`\`\`
> Quote ||Spoiler||

หรือใช้ปุ่มด้านบนเพื่อจัดรูปแบบ"
            style="width:100%;padding:12px 14px;border-radius:0 0 10px 10px;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-top:none;font-size:14px;font-family:inherit;resize:vertical;line-height:1.6"
          ></textarea>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:12.5px;color:var(--muted);flex-wrap:wrap">
            <div>💡 รองรับ Discord Markdown</div>
            <div>📝 สูงสุด 2,000 ตัวอักษร</div>
          </div>

          <!-- Preview Section -->
          <div style="margin-top:20px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <label style="font-weight:600;font-size:14px">ตัวอย่าง</label>
              <button type="button" onclick="updatePreview()" style="padding:5px 12px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--muted);font-size:12px;cursor:pointer">🔄 อัปเดต</button>
            </div>
            <div id="preview" style="min-height:120px;padding:14px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);font-size:14px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;color:var(--text)">
              <span style="color:var(--muted);font-style:italic">พิมพ์ข้อความแล้วกด "🔄 อัปเดต" เพื่อดูตัวอย่าง</span>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:10px;padding-top:10px;border-top:1px solid var(--line)">
          <button type="submit" style="flex:1;padding:12px 24px;border-radius:10px;border:none;background:var(--blue);color:#fff;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .2s">
            📤 ส่งข้อความ
          </button>
          <button type="button" onclick="document.getElementById('messageContent').value='';updateCharCount();updatePreview()" style="padding:12px 20px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">
            ล้าง
          </button>
        </div>
      </form>
    </div>

    <div class="box">
      <h3>📋 Discord Markdown ที่รองรับ</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:12px">
        <div style="font-size:13px;line-height:1.8">
          <div style="color:var(--muted);margin-bottom:6px;font-weight:600">✨ การจัดรูปแบบ</div>
          <code>**ตัวหนา**</code> → <b>ตัวหนา</b><br>
          <code>*ตัวเอียง*</code> → <i>ตัวเอียง</i><br>
          <code>__ขีดเส้นใต้__</code> → <u>ขีดเส้นใต้</u><br>
          <code>~~ขีดฆ่า~~</code> → <s>ขีดฆ่า</s>
        </div>
        <div style="font-size:13px;line-height:1.8">
          <div style="color:var(--muted);margin-bottom:6px;font-weight:600">💻 โค้ด</div>
          <code>\`inline code\`</code><br>
          <code>\`\`\`</code><br>
          <code>code block</code><br>
          <code>\`\`\`</code>
        </div>
      </div>
    </div>

    <script>
    // Initialize DOM elements
    const textarea = document.getElementById('messageContent');
    const charCount = document.getElementById('charCount');
    const submitBtn = document.querySelector('button[type="submit"]');
    const preview = document.getElementById('preview');

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function updatePreview() {
      renderPreview();
    }

    function renderPreview() {
      let text = textarea.value;

      if (!text.trim()) {
        preview.innerHTML = '<span style="color:var(--muted);font-style:italic">พิมพ์ข้อความแล้วกด "🔄 อัปเดต" เพื่อดูตัวอย่าง</span>';
        return;
      }

      const protectedBlocks = [];

      function protectBlock(html) {
        const key = '%%PREVIEW_BLOCK_' + protectedBlocks.length + '%%';
        protectedBlocks.push(html);
        return key;
      }

      text = escapeHtml(text);

      // Code blocks (plain)
      const codeBlockRegex = new RegExp(tick + tick + tick + '\\n([\\s\\S]*?)\\n' + tick + tick + tick, 'g');
      text = text.replace(codeBlockRegex, function(match, content) {
        return protectBlock('<pre style="background:var(--panel);padding:12px;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:13px;line-height:1.6">' + content + '</pre>');
      });

      // Discord Markdown parsing (simplified)
      text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>');
      text = text.replace(/\\*(.+?)\\*/g, '<i>$1</i>');
      text = text.replace(/__(.+?)__/g, '<u>$1</u>');
      text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');

      const inlineCodePattern = new RegExp(tick + '([^' + tick + ']+?)' + tick, 'g');
      text = text.replace(inlineCodePattern, '<code style="background:var(--panel);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13px">$1</code>');
      text = text.replace(/\\|\\|(.+?)\\|\\|/g, '<span style="background:#000;color:#000;padding:0 4px;border-radius:3px" title="Spoiler (คลิกเพื่อดู)">$1</span>');
      text = text.replace(/^&gt; (.+)$/gm, '<div style="border-left:3px solid var(--muted);padding-left:12px;color:var(--muted)">$1</div>');

      protectedBlocks.forEach(function(html, index) {
        text = text.replace('%%PREVIEW_BLOCK_' + index + '%%', html);
      });

      preview.innerHTML = text;
    }

    textarea.addEventListener('input', updateCharCount);

    // Auto-update preview on input (debounced)
    let previewTimeout;
    textarea.addEventListener('input', function() {
      clearTimeout(previewTimeout);
      previewTimeout = setTimeout(updatePreview, 500);
    });

    // ป้องกันการกดส่งซ้ำ
    document.getElementById('postForm').addEventListener('submit', function() {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.6';
      submitBtn.textContent = '⏳ กำลังส่ง...';
    });

    // Prevent toolbar buttons from submitting form
    document.querySelectorAll('button[type="button"]').forEach(btn => {
      btn.addEventListener('click', (e) => e.preventDefault());
    });

    generateThemePost();
    </script>`,
  });
}

module.exports = {
  esc,
  ticketChatPage,
  thaiDate,
  ago,
  layout,
  loginPage,
  errorPage,
  overviewPage,
  ticketsPage,
  voicePage,
  settingsPage,
  postMessagePage,
};
