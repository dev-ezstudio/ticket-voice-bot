/**
 * dashboard/data.js — ดึงข้อมูลสำหรับหน้า dashboard
 *
 * ไฟล์นี้อ่านข้อมูลเท่านั้น (read-only) ไม่แก้ไขอะไรในฐานข้อมูล
 * เพื่อให้เว็บ dashboard ไม่มีทางทำข้อมูลของบอทเสียหาย
 *
 * ใช้ตาราง 2 ระบบร่วมกันได้ เพราะเป็นมุมมองภาพรวม ไม่ใช่ logic ของระบบใดระบบหนึ่ง
 * (ต่างจาก lib/ticket/repo.js และ lib/voice/repo.js ที่แยกกันเด็ดขาด)
 */

const { supabase, db } = require('../supabase');

/** แปลงนาทีเป็นข้อความไทยอ่านง่าย */
function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 60) return `${minutes} นาที`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours < 24) return rest > 0 ? `${hours} ชม. ${rest} นาที` : `${hours} ชั่วโมง`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} วัน ${restHours} ชม.` : `${days} วัน`;
}

/**
 * ข้อมูลภาพรวมของเซิร์ฟเวอร์ — ใช้กับการ์ดสถิติด้านบนของ dashboard
 * @param {string} guildId
 */
async function getOverview(guildId) {
  const [tickets, rooms, ticketSettings, voiceSettings] = await Promise.all([
    db('dashboard: โหลดตั๋ว', () =>
      supabase
        .from('tickets')
        .select('channel_id, user_id, user_tag, ticket_number, status, claimed_by, claimed_at, closed_by, closed_at, created_at')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false }),
    ),
    db('dashboard: โหลดห้องเสียง', () =>
      supabase
        .from('temp_channels')
        .select('channel_id, owner_id, name, is_locked, user_limit, created_at')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false }),
    ),
    db(
      'dashboard: โหลดตั้งค่าตั๋ว',
      () => supabase.from('ticket_settings').select('*').eq('guild_id', guildId).maybeSingle(),
      { allowCodes: ['PGRST116'] },
    ),
    db(
      'dashboard: โหลดตั้งค่าห้องเสียง',
      () => supabase.from('voice_settings').select('*').eq('guild_id', guildId).maybeSingle(),
      { allowCodes: ['PGRST116'] },
    ),
  ]);

  const all = tickets ?? [];
  const open = all.filter((t) => t.status === 'open');
  const closed = all.filter((t) => t.status === 'closed');
  const unclaimed = open.filter((t) => !t.claimed_by);

  // ---- อันดับทีมงาน ----
  const claimCount = new Map();
  for (const t of all) {
    if (!t.claimed_by) continue;
    claimCount.set(t.claimed_by, (claimCount.get(t.claimed_by) ?? 0) + 1);
  }

  const staffRanking = [...claimCount.entries()]
    .map(([staffId, count]) => ({ staffId, count }))
    .sort((a, b) => b.count - a.count);

  // ---- เวลาเฉลี่ยที่ใช้ปิดตั๋ว ----
  const handleTimes = closed
    .filter((t) => t.closed_at && t.created_at)
    .map((t) => new Date(t.closed_at) - new Date(t.created_at))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);

  const avgHandleMinutes =
    handleTimes.length > 0
      ? Math.round(handleTimes.reduce((a, b) => a + b, 0) / handleTimes.length / 60000)
      : null;

  // ---- เวลาเฉลี่ยที่ทีมงานใช้ก่อนกดรับเรื่อง ----
  const responseTimes = all
    .filter((t) => t.claimed_at && t.created_at)
    .map((t) => new Date(t.claimed_at) - new Date(t.created_at))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);

  const avgResponseMinutes =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length / 60000)
      : null;

  // ---- ตั๋วต่อวัน 14 วันล่าสุด (ใช้ทำกราฟแท่ง) ----
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 13; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    days.push({
      date: day.toISOString().slice(0, 10),
      label: `${day.getDate()}/${day.getMonth() + 1}`,
      opened: all.filter((t) => {
        const at = new Date(t.created_at);
        return at >= day && at < next;
      }).length,
      closed: all.filter((t) => {
        if (!t.closed_at) return false;
        const at = new Date(t.closed_at);
        return at >= day && at < next;
      }).length,
    });
  }

  // ---- ตั๋วที่ค้างนานสุด (ยังไม่มีใครรับ) ----
  const oldestWaiting = [...unclaimed]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, 10);

  return {
    ticket: {
      total: all.length,
      open: open.length,
      closed: closed.length,
      unclaimed: unclaimed.length,
      avgHandleMinutes,
      avgHandleText: formatMinutes(avgHandleMinutes),
      avgResponseMinutes,
      avgResponseText: formatMinutes(avgResponseMinutes),
      counter: ticketSettings?.ticket_counter ?? 0,
      configured: Boolean(ticketSettings),
      settings: ticketSettings
        ? {
            panelChannelId: ticketSettings.panel_channel_id,
            categoryId: ticketSettings.category_id,
            staffRoleId: ticketSettings.staff_role_id,
            adminRoleId: ticketSettings.admin_role_id,
            adminPanelChannelId: ticketSettings.admin_panel_channel_id,
            superPanelChannelId: ticketSettings.super_panel_channel_id,
          }
        : null,
      staffRanking,
      recent: all.slice(0, 15),
      oldestWaiting,
      perDay: days,
    },
    voice: {
      activeRooms: (rooms ?? []).length,
      lockedRooms: (rooms ?? []).filter((r) => r.is_locked).length,
      configured: Boolean(voiceSettings),
      settings: voiceSettings
        ? {
            creatorChannelId: voiceSettings.creator_channel_id,
            categoryId: voiceSettings.category_id,
          }
        : null,
      rooms: rooms ?? [],
    },
  };
}

/**
 * รายการตั๋วแบบละเอียด รองรับกรอง + แบ่งหน้า
 * @param {string} guildId
 * @param {object} [opts]
 * @param {'all'|'open'|'closed'|'unclaimed'} [opts.status]
 * @param {number} [opts.page]
 * @param {number} [opts.perPage]
 */
async function listTickets(guildId, opts = {}) {
  const { status = 'all', page = 1, perPage = 25 } = opts;

  const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
  const safePerPage = Math.min(100, Math.max(5, Math.trunc(Number(perPage)) || 25));

  let query = supabase
    .from('tickets')
    .select('*', { count: 'exact' })
    .eq('guild_id', guildId);

  if (status === 'open') query = query.eq('status', 'open');
  else if (status === 'closed') query = query.eq('status', 'closed');
  else if (status === 'unclaimed') query = query.eq('status', 'open').is('claimed_by', null);

  const from = (safePage - 1) * safePerPage;

  // supabase-js คืนทั้ง data และ count เมื่อใช้ { count: 'exact' }
  // ต้องเรียกตรงๆ ไม่ผ่าน db() เพราะ db() คืนแค่ data
  const res = await query.order('created_at', { ascending: false }).range(from, from + safePerPage - 1);

  if (res.error) {
    const { DatabaseError } = require('../supabase');
    throw new DatabaseError(`[DB] "dashboard: รายการตั๋ว" ล้มเหลว: ${res.error.message}`, {
      operation: 'dashboard: รายการตั๋ว',
      cause: res.error,
      code: res.error.code,
    });
  }

  const total = res.count ?? 0;

  return {
    rows: res.data ?? [],
    total,
    page: safePage,
    perPage: safePerPage,
    totalPages: Math.max(1, Math.ceil(total / safePerPage)),
  };
}

// =====================================================================
//  ประวัติแชทของตั๋ว
//
//  ข้อความอยู่ 2 ที่ ขึ้นกับสถานะตั๋ว:
//    ตั๋วเปิดอยู่  -> ห้องยังมี ดึงสดจาก Discord ได้
//    ตั๋วปิดแล้ว   -> ห้องถูกลบ อ่านจากตาราง ticket_messages ที่บอทเก็บไว้ตอนปิด
//
//  ตั๋วที่ปิดก่อนมีระบบเก็บประวัติ จะไม่มีข้อมูล — บอกผู้ใช้ตรงๆ ว่าดูได้จากไฟล์ .txt
// =====================================================================

/** ดึงข้อความสดจากห้องที่ยังมีอยู่ (ผ่าน Discord API ด้วย bot token) */
async function fetchLiveMessages(channelId, limit = 300) {
  const collected = [];
  let before;

  while (collected.length < limit) {
    const params = new URLSearchParams({ limit: '100' });
    if (before) params.set('before', before);

    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?${params}`, {
      headers: { Authorization: `Bot ${process.env.TOKEN}` },
    });

    if (!res.ok) {
      // 10003 Unknown Channel = ห้องถูกลบไปแล้ว
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message || `Discord API ${res.status}`);
      err.status = res.status;
      err.code = body.code;
      throw err;
    }

    const batch = await res.json();
    if (!batch.length) break;

    collected.push(...batch);
    before = batch[batch.length - 1].id;

    if (batch.length < 100) break;
  }

  // Discord คืนจากใหม่ไปเก่า -> กลับลำดับให้อ่านตามเวลา
  return collected.reverse().map((m) => ({
    at: m.timestamp,
    authorId: m.author?.id ?? null,
    authorTag: m.author
      ? m.author.discriminator && m.author.discriminator !== '0'
        ? `${m.author.username}#${m.author.discriminator}`
        : m.author.username
      : 'ไม่ทราบผู้ส่ง',
    bot: Boolean(m.author?.bot),
    content: m.content ?? '',
    embed:
      (m.embeds ?? [])
        .map((e) =>
          [e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`)]
            .filter(Boolean)
            .join('\n'),
        )
        .filter(Boolean)
        .join('\n---\n') || null,
    attachments: (m.attachments ?? []).map((a) => ({ name: a.filename, url: a.url })),
  }));
}

/**
 * โหลดประวัติแชทของตั๋วใบหนึ่ง
 *
 * @param {string} guildId
 * @param {string} channelId
 * @returns {Promise<{ticket:object|null, messages:Array, source:'live'|'saved'|'none', truncated:boolean, note:string|null}>}
 */
async function getTicketChat(guildId, channelId) {
  const ticketRepo = require('../lib/ticket/repo');

  const ticket = await ticketRepo.getTicketByChannel(channelId);

  // กันดูตั๋วของเซิร์ฟเวอร์อื่น
  if (!ticket || ticket.guildId !== guildId) {
    return { ticket: null, messages: [], source: 'none', truncated: false, note: null };
  }

  // ---- ตั๋วเปิดอยู่: ลองดึงสดก่อน ----
  if (ticket.status === 'open') {
    try {
      const messages = await fetchLiveMessages(channelId);
      return {
        ticket,
        messages,
        source: 'live',
        truncated: false,
        note: null,
      };
    } catch (err) {
      // ห้องถูกลบไปแล้วแต่ฐานข้อมูลยังว่า open — ตกไปอ่านของที่เก็บไว้
      console.warn(`⚠️  [dashboard] ดึงข้อความสดจากห้อง ${channelId} ไม่ได้: ${err.message}`);
    }
  }

  // ---- ตั๋วปิดแล้ว (หรือดึงสดไม่ได้): อ่านจากที่เก็บไว้ ----
  const saved = await ticketRepo.getMessages(channelId);

  if (saved) {
    return {
      ticket,
      messages: saved.messages,
      source: 'saved',
      truncated: saved.truncated,
      note: saved.truncated
        ? `ตั๋วนี้คุยกันยาว ${saved.messageCount} ข้อความ — เก็บไว้ ${saved.messages.length} ข้อความแรก`
        : null,
    };
  }

  return {
    ticket,
    messages: [],
    source: 'none',
    truncated: false,
    note:
      'ตั๋วนี้ปิดก่อนที่ระบบจะเริ่มเก็บประวัติแชท — ดูได้จากไฟล์ .txt ที่บอทส่งไปห้องแอดมินใหญ่ตอนปิดตั๋ว',
  };
}

module.exports = { getOverview, listTickets, getTicketChat, formatMinutes };
