/**
 * lib/ticket/repo.js — ชั้นเข้าถึงฐานข้อมูลของ "ระบบตั๋ว" เท่านั้น
 *
 * ไฟล์นี้เป็นที่เดียวในระบบตั๋วที่พูดกับ Supabase โดยตรง
 * command และ event handler ของตั๋วต้องเรียกผ่านฟังก์ชันในไฟล์นี้
 * -> เวลาแก้ชื่อคอลัมน์หรือย้ายฐานข้อมูล แก้ที่นี่ที่เดียว
 *
 * แปลงชื่อ: ฐานข้อมูลใช้ snake_case, โค้ด JS ใช้ camelCase
 */

const { supabase, db } = require('../../supabase');

/** โค้ด error ของ Postgres ที่แปลว่า "ไม่พบแถว" (ไม่ใช่ความผิดพลาดจริง) */
const NO_ROWS = 'PGRST116';

// ---------------------------------------------------------------------
// แปลงรูปแบบข้อมูล
// ---------------------------------------------------------------------

function mapSettings(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    panelChannelId: row.panel_channel_id,
    panelMessageId: row.panel_message_id,
    categoryId: row.category_id,
    staffRoleId: row.staff_role_id,
    adminRoleId: row.admin_role_id ?? null,
    adminPanelChannelId: row.admin_panel_channel_id ?? null,
    adminPanelMessageId: row.admin_panel_message_id ?? null,
    superPanelChannelId: row.super_panel_channel_id ?? null,
    superPanelMessageId: row.super_panel_message_id ?? null,
    ticketCounter: row.ticket_counter,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTicket(row) {
  if (!row) return null;
  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    userId: row.user_id,
    userTag: row.user_tag,
    ticketNumber: row.ticket_number,
    status: row.status,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------
// ticket_settings
// ---------------------------------------------------------------------

/**
 * โหลดการตั้งค่าระบบตั๋วของเซิร์ฟเวอร์
 * @returns {Promise<object|null>} null = ยังไม่เคยตั้งค่า (/setup-ticket)
 */
async function getSettings(guildId) {
  const row = await db(
    'โหลดการตั้งค่าระบบตั๋ว',
    () => supabase.from('ticket_settings').select('*').eq('guild_id', guildId).maybeSingle(),
    { allowCodes: [NO_ROWS] },
  );
  return mapSettings(row);
}

/**
 * บันทึกการตั้งค่าระบบตั๋ว (upsert — ตั้งซ้ำได้ ทับค่าเดิม)
 * ไม่แตะ ticket_counter เพื่อไม่ให้เลขตั๋วรีเซ็ตเวลาตั้งค่าใหม่
 */
async function saveSettings({
  guildId,
  panelChannelId,
  panelMessageId,
  categoryId,
  staffRoleId,
  adminRoleId,
  adminPanelChannelId,
  adminPanelMessageId,
  superPanelChannelId,
  superPanelMessageId,
}) {
  const payload = {
    guild_id: guildId,
    panel_channel_id: panelChannelId,
    panel_message_id: panelMessageId ?? null,
    category_id: categoryId,
    staff_role_id: staffRoleId,
  };

  // ฟิลด์ของ 3 หน้า: ส่งเฉพาะที่ระบุมา (undefined = ไม่แตะค่าเดิม)
  // เพื่อให้ตั้งค่าบางส่วนได้โดยไม่ล้างค่าที่ตั้งไว้ก่อนหน้า
  if (adminRoleId !== undefined) payload.admin_role_id = adminRoleId;
  if (adminPanelChannelId !== undefined) payload.admin_panel_channel_id = adminPanelChannelId;
  if (adminPanelMessageId !== undefined) payload.admin_panel_message_id = adminPanelMessageId;
  if (superPanelChannelId !== undefined) payload.super_panel_channel_id = superPanelChannelId;
  if (superPanelMessageId !== undefined) payload.super_panel_message_id = superPanelMessageId;

  const row = await db('บันทึกการตั้งค่าระบบตั๋ว', () =>
    supabase.from('ticket_settings').upsert(payload, { onConflict: 'guild_id' }).select().single(),
  );
  return mapSettings(row);
}

/**
 * ขอเลขตั๋วใบถัดไปแบบ atomic ผ่าน SQL function
 * ป้องกัน race condition ตอนหลายคนกดเปิดตั๋วพร้อมกัน
 * @returns {Promise<number|null>} null = ยังไม่ได้ตั้งค่าระบบตั๋ว
 */
async function nextTicketNumber(guildId) {
  const value = await db('ขอเลขตั๋วใบถัดไป', () =>
    supabase.rpc('next_ticket_number', { p_guild_id: guildId }),
  );
  return typeof value === 'number' ? value : null;
}

// ---------------------------------------------------------------------
// tickets
// ---------------------------------------------------------------------

/**
 * สร้างตั๋วใบใหม่
 * @throws {DatabaseError} รวมถึงกรณีชน unique index (ผู้ใช้มีตั๋วเปิดอยู่แล้ว)
 */
async function createTicket({ channelId, guildId, userId, userTag, ticketNumber }) {
  const row = await db('สร้างตั๋วใหม่', () =>
    supabase
      .from('tickets')
      .insert({
        channel_id: channelId,
        guild_id: guildId,
        user_id: userId,
        user_tag: userTag ?? null,
        ticket_number: ticketNumber ?? null,
        status: 'open',
      })
      .select()
      .single(),
  );
  return mapTicket(row);
}

/** โหลดตั๋วจาก channel id */
async function getTicketByChannel(channelId) {
  const row = await db(
    'โหลดข้อมูลตั๋ว',
    () => supabase.from('tickets').select('*').eq('channel_id', channelId).maybeSingle(),
    { allowCodes: [NO_ROWS] },
  );
  return mapTicket(row);
}

/** หาตั๋วที่ผู้ใช้เปิดค้างอยู่ในเซิร์ฟเวอร์นี้ (มีได้ไม่เกิน 1 ใบตาม unique index) */
async function getOpenTicketByUser(guildId, userId) {
  const rows = await db('ตรวจสอบตั๋วที่เปิดอยู่ของผู้ใช้', () =>
    supabase
      .from('tickets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .eq('status', 'open')
      .limit(1),
  );
  return mapTicket(rows?.[0]);
}

/** บันทึกว่า staff คนนี้รับเรื่องตั๋วใบนี้ */
async function claimTicket(channelId, staffId) {
  const row = await db('บันทึกการรับเรื่อง', () =>
    supabase
      .from('tickets')
      .update({ claimed_by: staffId, claimed_at: new Date().toISOString() })
      .eq('channel_id', channelId)
      .select()
      .single(),
  );
  return mapTicket(row);
}

/** ยกเลิกการรับเรื่อง (staff คนเดิมกดปุ่มซ้ำ) */
async function unclaimTicket(channelId) {
  const row = await db('ยกเลิกการรับเรื่อง', () =>
    supabase
      .from('tickets')
      .update({ claimed_by: null, claimed_at: null })
      .eq('channel_id', channelId)
      .select()
      .single(),
  );
  return mapTicket(row);
}

/** ปิดตั๋ว — เปลี่ยนสถานะเป็น closed พร้อมบันทึกเวลาและคนปิด */
async function closeTicket(channelId, { closedBy, reason = null } = {}) {
  const row = await db('ปิดตั๋ว', () =>
    supabase
      .from('tickets')
      .update({
        status: 'closed',
        closed_by: closedBy ?? null,
        closed_at: new Date().toISOString(),
        close_reason: reason,
      })
      .eq('channel_id', channelId)
      .select()
      .single(),
  );
  return mapTicket(row);
}

/**
 * ลบแถวตั๋วทิ้ง — ใช้เฉพาะตอน rollback (สร้างห้องสำเร็จแต่ส่ง embed ไม่ได้)
 * การปิดตั๋วปกติให้ใช้ closeTicket() เพื่อเก็บสถิติไว้
 */
async function deleteTicket(channelId) {
  await db('ลบข้อมูลตั๋ว', () => supabase.from('tickets').delete().eq('channel_id', channelId));
}

/** โหลดตั๋วที่สถานะ open ทั้งหมดของเซิร์ฟเวอร์ (ใช้ตอนบอทเริ่มทำงาน เพื่อ sync กับห้องจริง) */
async function listOpenTickets(guildId) {
  const rows = await db('โหลดรายการตั๋วที่เปิดอยู่', () =>
    supabase.from('tickets').select('*').eq('guild_id', guildId).eq('status', 'open'),
  );
  return (rows ?? []).map(mapTicket);
}

// ---------------------------------------------------------------------
// ticket_messages — ประวัติแชทของตั๋วที่ปิดแล้ว
//
// ทำไมต้องเก็บ: เมื่อปิดตั๋ว ห้องถูกลบ ข้อความใน Discord หายถาวร
// เก็บไว้ที่นี่เพื่อให้ดูย้อนหลังจาก dashboard ได้
// ---------------------------------------------------------------------

/** เก็บได้มากสุดกี่ข้อความต่อตั๋ว (กันแถวใหญ่เกินไป) */
const MAX_SAVED_MESSAGES = 500;

/**
 * บันทึกประวัติแชทของตั๋ว (upsert — ปิดตั๋วซ้ำก็ทับได้)
 *
 * @param {object} params
 * @param {string} params.channelId
 * @param {string} params.guildId
 * @param {number|null} params.ticketNumber
 * @param {Array<{at:string,authorId:string,authorTag:string,bot:boolean,content:string,attachments:string[]}>} params.messages
 */
async function saveMessages({ channelId, guildId, ticketNumber, messages }) {
  const list = Array.isArray(messages) ? messages : [];

  // เก็บเฉพาะ MAX_SAVED_MESSAGES ข้อความแรก — ตั๋วที่คุยกันยาวมากจะถูกตัด
  const kept = list.slice(0, MAX_SAVED_MESSAGES);
  const truncated = list.length > kept.length;

  await db('บันทึกประวัติแชทตั๋ว', () =>
    supabase.from('ticket_messages').upsert(
      {
        channel_id: channelId,
        guild_id: guildId,
        ticket_number: ticketNumber ?? null,
        message_count: list.length,
        messages: kept,
        truncated,
      },
      { onConflict: 'channel_id' },
    ),
  );

  return { saved: kept.length, total: list.length, truncated };
}

/**
 * อ่านประวัติแชทของตั๋ว
 * @returns {Promise<object|null>} null = ไม่มีประวัติเก็บไว้ (ตั๋วเก่าก่อนมีระบบนี้)
 */
async function getMessages(channelId) {
  const row = await db(
    'โหลดประวัติแชทตั๋ว',
    () => supabase.from('ticket_messages').select('*').eq('channel_id', channelId).maybeSingle(),
    { allowCodes: [NO_ROWS] },
  );

  if (!row) return null;

  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    ticketNumber: row.ticket_number,
    messageCount: row.message_count,
    messages: Array.isArray(row.messages) ? row.messages : [],
    truncated: row.truncated,
    savedAt: row.saved_at,
  };
}

/**
 * ตั๋วไหนมีประวัติแชทเก็บไว้บ้าง — ใช้ทำไอคอนในตารางรายการตั๋ว
 * @param {string[]} channelIds
 * @returns {Promise<Set<string>>}
 */
async function whichHaveMessages(channelIds) {
  if (!channelIds?.length) return new Set();

  const rows = await db('ตรวจว่าตั๋วไหนมีประวัติแชท', () =>
    supabase.from('ticket_messages').select('channel_id').in('channel_id', channelIds),
  );

  return new Set((rows ?? []).map((r) => r.channel_id));
}

// ---------------------------------------------------------------------
// สถิติ (/ticket-stats)
// ---------------------------------------------------------------------

/**
 * รวบรวมสถิติตั๋วของเซิร์ฟเวอร์
 * @returns {Promise<{total:number,open:number,closed:number,claimedRanking:Array,recentTickets:Array,avgHandleMinutes:number|null}>}
 */
async function getStats(guildId) {
  // ดึงเฉพาะคอลัมน์ที่ใช้คำนวณ ลดขนาดข้อมูลที่โหลดมา
  const rows = await db('โหลดสถิติตั๋ว', () =>
    supabase
      .from('tickets')
      .select('channel_id, user_id, user_tag, ticket_number, status, claimed_by, created_at, closed_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false }),
  );

  const tickets = rows ?? [];

  const total = tickets.length;
  const open = tickets.filter((t) => t.status === 'open').length;
  const closed = total - open;

  // นับจำนวนตั๋วที่ staff แต่ละคนรับเรื่อง
  const claimCount = new Map();
  for (const t of tickets) {
    if (!t.claimed_by) continue;
    claimCount.set(t.claimed_by, (claimCount.get(t.claimed_by) ?? 0) + 1);
  }

  const claimedRanking = [...claimCount.entries()]
    .map(([staffId, count]) => ({ staffId, count }))
    .sort((a, b) => b.count - a.count);

  // เวลาเฉลี่ยที่ใช้จัดการตั๋ว (นับเฉพาะใบที่ปิดแล้ว)
  const durations = tickets
    .filter((t) => t.status === 'closed' && t.closed_at && t.created_at)
    .map((t) => new Date(t.closed_at) - new Date(t.created_at))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);

  const avgHandleMinutes =
    durations.length > 0
      ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length / 60000)
      : null;

  return {
    total,
    open,
    closed,
    claimedRanking,
    unclaimedOpen: tickets.filter((t) => t.status === 'open' && !t.claimed_by).length,
    avgHandleMinutes,
    recentTickets: tickets.slice(0, 5).map(mapTicket),
  };
}

/**
 * ตั๋วที่เปิดอยู่และยังไม่มีใครรับเรื่อง — เรียงจากเก่าไปใหม่ (รอนานสุดอยู่บนสุด)
 * ใช้กับปุ่ม "ตั๋วที่รอรับเรื่อง" และ "รับใบที่รอนานสุด" ในหน้าทีมงาน
 */
async function listUnclaimedTickets(guildId) {
  const rows = await db('โหลดตั๋วที่รอรับเรื่อง', () =>
    supabase
      .from('tickets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'open')
      .is('claimed_by', null)
      .order('created_at', { ascending: true }),
  );
  return (rows ?? []).map(mapTicket);
}

/**
 * ตั๋วที่ staff คนนี้รับเรื่องอยู่ (ยังไม่ปิด)
 * ใช้กับปุ่ม "ตั๋วของฉัน" ในหน้าทีมงาน
 */
async function listTicketsClaimedBy(guildId, staffId) {
  const rows = await db('โหลดตั๋วที่ฉันรับเรื่อง', () =>
    supabase
      .from('tickets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'open')
      .eq('claimed_by', staffId)
      .order('created_at', { ascending: true }),
  );
  return (rows ?? []).map(mapTicket);
}

/**
 * รับเรื่องแบบ atomic — สำเร็จเฉพาะเมื่อยังไม่มีใครรับ
 *
 * ทำไมต้องมีแยกจาก claimTicket(): ปุ่ม "รับใบที่รอนานสุด" อาจมี staff 2 คน
 * กดพร้อมกันแล้วได้ตั๋วใบเดียวกัน เงื่อนไข .is('claimed_by', null) ในคำสั่ง UPDATE
 * ทำให้คนที่มาช้ากว่าอัปเดตไม่โดนแถว แล้วรู้ว่าถูกคนอื่นแย่งไปแล้ว
 *
 * @returns {Promise<object|null>} null = มีคนรับไปก่อนแล้ว
 */
async function claimTicketIfUnclaimed(channelId, staffId) {
  const rows = await db('รับเรื่องแบบกันแย่ง', () =>
    supabase
      .from('tickets')
      .update({ claimed_by: staffId, claimed_at: new Date().toISOString() })
      .eq('channel_id', channelId)
      .eq('status', 'open')
      .is('claimed_by', null)
      .select(),
  );
  return rows?.length ? mapTicket(rows[0]) : null;
}

module.exports = {
  getSettings,
  saveMessages,
  getMessages,
  whichHaveMessages,
  MAX_SAVED_MESSAGES,
  listUnclaimedTickets,
  listTicketsClaimedBy,
  claimTicketIfUnclaimed,
  saveSettings,
  nextTicketNumber,
  createTicket,
  getTicketByChannel,
  getOpenTicketByUser,
  claimTicket,
  unclaimTicket,
  closeTicket,
  deleteTicket,
  listOpenTickets,
  getStats,
};
