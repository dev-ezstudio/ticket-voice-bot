/**
 * lib/voice/repo.js — ชั้นเข้าถึงฐานข้อมูลของ "ระบบห้องเสียงชั่วคราว" เท่านั้น
 *
 * ไฟล์นี้เป็นที่เดียวในระบบห้องเสียงที่พูดกับ Supabase โดยตรง
 * แยกจาก lib/ticket/repo.js อย่างสิ้นเชิง — แก้ระบบหนึ่งไม่กระทบอีกระบบ
 */

const { supabase, db } = require('../../supabase');

const NO_ROWS = 'PGRST116';

// ---------------------------------------------------------------------
// แปลงรูปแบบข้อมูล
// ---------------------------------------------------------------------

function mapSettings(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    creatorChannelId: row.creator_channel_id,
    categoryId: row.category_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChannel(row) {
  if (!row) return null;
  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    ownerId: row.owner_id,
    name: row.name,
    isLocked: row.is_locked,
    userLimit: row.user_limit,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------
// voice_settings
// ---------------------------------------------------------------------

/**
 * โหลดการตั้งค่าระบบห้องเสียงของเซิร์ฟเวอร์
 * @returns {Promise<object|null>} null = ยังไม่เคยตั้งค่า (/setup-voice)
 */
async function getSettings(guildId) {
  const row = await db(
    'โหลดการตั้งค่าระบบห้องเสียง',
    () => supabase.from('voice_settings').select('*').eq('guild_id', guildId).maybeSingle(),
    { allowCodes: [NO_ROWS] },
  );
  return mapSettings(row);
}

/** บันทึกการตั้งค่าระบบห้องเสียง (upsert — ตั้งซ้ำได้ ทับค่าเดิม) */
async function saveSettings({ guildId, creatorChannelId, categoryId }) {
  const row = await db('บันทึกการตั้งค่าระบบห้องเสียง', () =>
    supabase
      .from('voice_settings')
      .upsert(
        {
          guild_id: guildId,
          creator_channel_id: creatorChannelId,
          category_id: categoryId,
        },
        { onConflict: 'guild_id' },
      )
      .select()
      .single(),
  );
  return mapSettings(row);
}

// ---------------------------------------------------------------------
// temp_channels
// ---------------------------------------------------------------------

/** บันทึกห้องเสียงชั่วคราวที่สร้างใหม่ */
async function createTempChannel({ channelId, guildId, ownerId, name, userLimit = 0, isLocked = false }) {
  const row = await db('บันทึกห้องเสียงชั่วคราว', () =>
    supabase
      .from('temp_channels')
      .insert({
        channel_id: channelId,
        guild_id: guildId,
        owner_id: ownerId,
        name: name ?? null,
        user_limit: userLimit,
        is_locked: isLocked,
      })
      .select()
      .single(),
  );
  return mapChannel(row);
}

/**
 * โหลดข้อมูลห้องเสียงชั่วคราว
 * @returns {Promise<object|null>} null = ไม่ใช่ห้องชั่วคราว หรือถูกลบไปแล้ว
 */
async function getTempChannel(channelId) {
  const row = await db(
    'โหลดข้อมูลห้องเสียง',
    () => supabase.from('temp_channels').select('*').eq('channel_id', channelId).maybeSingle(),
    { allowCodes: [NO_ROWS] },
  );
  return mapChannel(row);
}

/** โหลดห้องชั่วคราวทั้งหมดของเซิร์ฟเวอร์ (ใช้ตอนบอทเริ่มทำงาน เพื่อเก็บกวาดห้องที่ค้าง) */
async function listTempChannels(guildId) {
  const rows = await db('โหลดรายการห้องเสียงชั่วคราว', () =>
    supabase.from('temp_channels').select('*').eq('guild_id', guildId),
  );
  return (rows ?? []).map(mapChannel);
}

/**
 * อัปเดตข้อมูลห้อง — ส่งเฉพาะ field ที่ต้องการเปลี่ยน
 * @param {string} channelId
 * @param {{name?: string, isLocked?: boolean, userLimit?: number, ownerId?: string}} patch
 */
async function updateTempChannel(channelId, patch) {
  const payload = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.isLocked !== undefined) payload.is_locked = patch.isLocked;
  if (patch.userLimit !== undefined) payload.user_limit = patch.userLimit;
  if (patch.ownerId !== undefined) payload.owner_id = patch.ownerId;

  if (Object.keys(payload).length === 0) return getTempChannel(channelId);

  const row = await db('อัปเดตข้อมูลห้องเสียง', () =>
    supabase.from('temp_channels').update(payload).eq('channel_id', channelId).select().single(),
  );
  return mapChannel(row);
}

/**
 * ลบข้อมูลห้องออกจากฐานข้อมูล
 * blocked_users จะถูกลบตามอัตโนมัติด้วย ON DELETE CASCADE ใน schema.sql
 */
async function deleteTempChannel(channelId) {
  await db('ลบข้อมูลห้องเสียง', () =>
    supabase.from('temp_channels').delete().eq('channel_id', channelId),
  );
}

/** ลบข้อมูลห้องหลายห้องพร้อมกัน (ใช้ตอนเก็บกวาดห้างที่ค้างตอนบอทเริ่มทำงาน) */
async function deleteTempChannels(channelIds) {
  if (!channelIds?.length) return;
  await db('ลบข้อมูลห้องเสียงหลายห้อง', () =>
    supabase.from('temp_channels').delete().in('channel_id', channelIds),
  );
}

// ---------------------------------------------------------------------
// blocked_users
// ---------------------------------------------------------------------

/** เพิ่มผู้ใช้เข้ารายการบล็อกของห้อง (กดซ้ำไม่ error เพราะใช้ upsert) */
async function blockUser(channelId, blockedUserId, blockedBy) {
  await db('บันทึกการบล็อกผู้ใช้', () =>
    supabase.from('blocked_users').upsert(
      {
        channel_id: channelId,
        blocked_user_id: blockedUserId,
        blocked_by: blockedBy ?? null,
      },
      { onConflict: 'channel_id,blocked_user_id' },
    ),
  );
}

/** เอาผู้ใช้ออกจากรายการบล็อก */
async function unblockUser(channelId, blockedUserId) {
  await db('ยกเลิกการบล็อกผู้ใช้', () =>
    supabase
      .from('blocked_users')
      .delete()
      .eq('channel_id', channelId)
      .eq('blocked_user_id', blockedUserId),
  );
}

/**
 * รายชื่อผู้ใช้ที่ถูกบล็อกในห้องนี้
 * @returns {Promise<string[]>} array ของ user id
 */
async function listBlockedUsers(channelId) {
  const rows = await db('โหลดรายการผู้ถูกบล็อก', () =>
    supabase.from('blocked_users').select('blocked_user_id').eq('channel_id', channelId),
  );
  return (rows ?? []).map((r) => r.blocked_user_id);
}

/** เช็คว่าผู้ใช้ถูกบล็อกในห้องนี้หรือไม่ */
async function isBlocked(channelId, userId) {
  const rows = await db('ตรวจสอบสถานะการบล็อก', () =>
    supabase
      .from('blocked_users')
      .select('blocked_user_id')
      .eq('channel_id', channelId)
      .eq('blocked_user_id', userId)
      .limit(1),
  );
  return (rows?.length ?? 0) > 0;
}

module.exports = {
  getSettings,
  saveSettings,
  createTempChannel,
  getTempChannel,
  listTempChannels,
  updateTempChannel,
  deleteTempChannel,
  deleteTempChannels,
  blockUser,
  unblockUser,
  listBlockedUsers,
  isBlocked,
};
