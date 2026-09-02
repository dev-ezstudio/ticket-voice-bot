/**
 * dashboard/actions.js — การกระทำที่แก้ข้อมูลจริง (เขียน)
 *
 * แยกจาก data.js ที่อ่านเท่านั้น เพื่อให้เห็นชัดว่าไฟล์ไหนแก้อะไรได้
 *
 * ⚠️ เรื่องสำคัญที่สุดของไฟล์นี้:
 *   แก้ค่าในฐานข้อมูลอย่างเดียว "ไม่พอ" — ต้องย้าย panel จริงใน Discord ตามด้วย
 *   ถ้าแก้แค่ DB ปุ่มเปิดตั๋วจะยังค้างอยู่ห้องเดิม แล้วข้อมูลกับของจริงไม่ตรงกัน
 *
 *   ลำดับที่ปลอดภัย:
 *     1. ส่ง panel ใบใหม่ไปห้องใหม่ก่อน  (ถ้าพลาด ยังไม่มีอะไรเปลี่ยน)
 *     2. บันทึกลงฐานข้อมูล              (ถ้าพลาด ลบ panel ที่เพิ่งส่ง)
 *     3. ลบ panel ใบเก่า                (พลาดได้ ไม่กระทบการทำงาน)
 */

const ticketRepo = require('../lib/ticket/repo');
const voiceRepo = require('../lib/voice/repo');
const ticketUi = require('../lib/ticket/ui');
const ticketPanels = require('../lib/ticket/panels');

/** เรียก Discord API ด้วย bot token */
async function api(path, options = {}) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${process.env.TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return null;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(body.message || `Discord API ${res.status}`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }

  return body;
}

/** ส่งข้อความพร้อม embed + ปุ่ม เข้าห้อง */
async function sendPanel(channelId, payload) {
  return api(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** ลบข้อความ — ล้มเหลวได้ ไม่ throw (ข้อความอาจถูกลบไปแล้ว) */
async function deleteMessage(channelId, messageId) {
  if (!channelId || !messageId) return;

  try {
    await api(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
  } catch (err) {
    // 10008 Unknown Message = ถูกลบไปแล้ว ถือว่าสำเร็จ
    if (err.code !== 10008) {
      console.warn(`⚠️  ลบ panel เก่า (${messageId}) ไม่สำเร็จ: ${err.message}`);
    }
  }
}

/** ตรวจว่าห้องนี้เป็นห้องข้อความในเซิร์ฟเวอร์ที่ถูกต้อง */
async function assertTextChannel(channelId, guildId, label) {
  let ch;

  try {
    ch = await api(`/channels/${channelId}`);
  } catch (err) {
    throw new Error(`${label}: ไม่พบห้องนี้ หรือบอทมองไม่เห็น (${err.message})`);
  }

  // 0 = GuildText, 5 = GuildAnnouncement
  if (ch.type !== 0 && ch.type !== 5) {
    throw new Error(`${label}: ต้องเป็นห้องข้อความ (ห้องที่เลือกเป็นชนิดอื่น)`);
  }

  if (ch.guild_id !== guildId) {
    throw new Error(`${label}: ห้องนี้ไม่ได้อยู่ในเซิร์ฟเวอร์ที่ dashboard ดูแล`);
  }

  return ch;
}

// =====================================================================
//  ย้ายห้องเปิดตั๋ว (หน้าที่ 1)
// =====================================================================

/**
 * ย้าย panel ปุ่มเปิดตั๋วไปห้องใหม่
 *
 * @param {string} guildId
 * @param {string} newChannelId
 * @param {object} guildInfo ข้อมูลเซิร์ฟเวอร์ (ใช้ทำ footer ของ embed)
 * @returns {Promise<{ channelId: string, messageId: string, movedFrom: string|null }>}
 */
async function movePanelChannel(guildId, newChannelId, guildInfo = {}) {
  const settings = await ticketRepo.getSettings(guildId);

  if (!settings) {
    throw new Error('ยังไม่ได้ตั้งค่าระบบตั๋ว — ใช้คำสั่ง /setup-ticket ใน Discord ก่อน');
  }

  await assertTextChannel(newChannelId, guildId, 'ห้องเปิดตั๋ว');

  if (settings.panelChannelId === newChannelId) {
    throw new Error('ห้องนี้เป็นห้องเปิดตั๋วอยู่แล้ว');
  }

  // ---- 1) ส่ง panel ใบใหม่ก่อน ----
  // ทำก่อนบันทึก เพราะถ้าส่งไม่ได้ (สิทธิ์ไม่พอ) จะยังไม่มีอะไรเปลี่ยน
  const guild = { name: guildInfo.name ?? '', iconURL: () => guildInfo.iconURL ?? null };

  let sent;
  try {
    sent = await sendPanel(newChannelId, {
      embeds: [ticketUi.panelEmbed(guild).toJSON()],
      components: [ticketUi.panelRow().toJSON()],
    });
  } catch (err) {
    if (err.status === 403) {
      throw new Error(
        'บอทส่งข้อความในห้องนั้นไม่ได้ — ตรวจสิทธิ์ มองเห็นห้อง / ส่งข้อความ / ฝัง Embed',
      );
    }
    throw new Error(`ส่ง panel ไม่สำเร็จ: ${err.message}`);
  }

  // ---- 2) บันทึกลงฐานข้อมูล ----
  try {
    await ticketRepo.saveSettings({
      guildId,
      panelChannelId: newChannelId,
      panelMessageId: sent.id,
      categoryId: settings.categoryId,
      staffRoleId: settings.staffRoleId,
    });
  } catch (err) {
    // บันทึกไม่ได้ -> เก็บ panel ที่เพิ่งส่งคืน ไม่ให้เหลือปุ่มลอยอยู่ 2 ห้อง
    await deleteMessage(newChannelId, sent.id);
    throw err;
  }

  // ---- 3) ลบ panel ใบเก่า ----
  // ทำหลังบันทึกสำเร็จ และล้มเหลวได้ (ห้องเก่าอาจถูกลบไปแล้ว)
  await deleteMessage(settings.panelChannelId, settings.panelMessageId);

  return {
    channelId: newChannelId,
    messageId: sent.id,
    movedFrom: settings.panelChannelId,
  };
}

// =====================================================================
//  ตั้ง / ย้ายห้องแผงทีมงาน (หน้าที่ 2) และแผงแอดมินใหญ่ (หน้าที่ 3)
// =====================================================================

/**
 * ตั้งห้องแผงควบคุม (ทีมงาน หรือ แอดมินใหญ่)
 *
 * @param {string} guildId
 * @param {'staff'|'super'} which
 * @param {string|null} newChannelId  null = ถอดแผงออก (ไม่ใช้ห้องนี้แล้ว)
 * @param {object} guildInfo
 */
async function movePanel(guildId, which, newChannelId, guildInfo = {}) {
  const settings = await ticketRepo.getSettings(guildId);

  if (!settings) {
    throw new Error('ยังไม่ได้ตั้งค่าระบบตั๋ว — ใช้คำสั่ง /setup-ticket ใน Discord ก่อน');
  }

  const isStaff = which === 'staff';
  const label = isStaff ? 'ห้องแผงทีมงาน' : 'ห้องแผงแอดมินใหญ่';

  const oldChannelId = isStaff ? settings.adminPanelChannelId : settings.superPanelChannelId;
  const oldMessageId = isStaff ? settings.adminPanelMessageId : settings.superPanelMessageId;

  // ---- ถอดแผงออก ----
  if (!newChannelId) {
    if (!oldChannelId) throw new Error(`${label} ยังไม่ได้ตั้งไว้ ไม่มีอะไรให้ถอด`);

    await ticketRepo.saveSettings({
      guildId,
      panelChannelId: settings.panelChannelId,
      panelMessageId: settings.panelMessageId,
      categoryId: settings.categoryId,
      staffRoleId: settings.staffRoleId,
      ...(isStaff
        ? { adminPanelChannelId: null, adminPanelMessageId: null }
        : { superPanelChannelId: null, superPanelMessageId: null }),
    });

    await deleteMessage(oldChannelId, oldMessageId);

    return { removed: true, label };
  }

  await assertTextChannel(newChannelId, guildId, label);

  if (oldChannelId === newChannelId) {
    throw new Error(`ห้องนี้เป็น${label}อยู่แล้ว`);
  }

  // ---- 1) ส่งแผงใบใหม่ ----
  const stats = await ticketRepo.getStats(guildId);
  const guild = { name: guildInfo.name ?? '', iconURL: () => guildInfo.iconURL ?? null };

  const payload = isStaff
    ? {
        embeds: [ticketPanels.staffPanelEmbed(guild, stats, settings.staffRoleId).toJSON()],
        components: ticketPanels.staffPanelRows().map((r) => r.toJSON()),
      }
    : {
        embeds: [
          ticketPanels
            .superPanelEmbed(guild, stats, { ...settings, ticketCounter: settings.ticketCounter })
            .toJSON(),
        ],
        components: ticketPanels.superPanelRows().map((r) => r.toJSON()),
      };

  let sent;
  try {
    sent = await sendPanel(newChannelId, payload);
  } catch (err) {
    if (err.status === 403) {
      throw new Error(
        'บอทส่งข้อความในห้องนั้นไม่ได้ — ตรวจสิทธิ์ มองเห็นห้อง / ส่งข้อความ / ฝัง Embed',
      );
    }
    throw new Error(`ส่งแผงไม่สำเร็จ: ${err.message}`);
  }

  // ---- 2) บันทึก ----
  try {
    await ticketRepo.saveSettings({
      guildId,
      panelChannelId: settings.panelChannelId,
      panelMessageId: settings.panelMessageId,
      categoryId: settings.categoryId,
      staffRoleId: settings.staffRoleId,
      ...(isStaff
        ? { adminPanelChannelId: newChannelId, adminPanelMessageId: sent.id }
        : { superPanelChannelId: newChannelId, superPanelMessageId: sent.id }),
    });
  } catch (err) {
    await deleteMessage(newChannelId, sent.id);
    throw err;
  }

  // ---- 3) ลบใบเก่า ----
  await deleteMessage(oldChannelId, oldMessageId);

  return { channelId: newChannelId, messageId: sent.id, movedFrom: oldChannelId, label };
}

// =====================================================================
//  เปลี่ยนหมวดห้องตั๋ว
// =====================================================================

/**
 * เปลี่ยนหมวดที่ห้องตั๋วใหม่จะถูกสร้างเข้าไป
 * ห้องตั๋วที่มีอยู่แล้วไม่ย้าย (ย้ายจะทำให้สิทธิ์เปลี่ยนโดยไม่คาดคิด)
 */
async function setCategory(guildId, categoryId) {
  const settings = await ticketRepo.getSettings(guildId);

  if (!settings) throw new Error('ยังไม่ได้ตั้งค่าระบบตั๋ว');

  let cat;
  try {
    cat = await api(`/channels/${categoryId}`);
  } catch (err) {
    throw new Error(`ไม่พบหมวดนี้ (${err.message})`);
  }

  if (cat.type !== 4) throw new Error('ต้องเลือก Category ไม่ใช่ห้องธรรมดา');
  if (cat.guild_id !== guildId) throw new Error('หมวดนี้ไม่ได้อยู่ในเซิร์ฟเวอร์ที่ dashboard ดูแล');

  // นับห้องในหมวด — Discord จำกัด 50 ห้องต่อหมวด
  const channels = await api(`/guilds/${guildId}/channels`);
  const childCount = channels.filter((c) => c.parent_id === categoryId).length;

  if (childCount >= 50) {
    throw new Error(`หมวดนี้มีห้องครบ 50 ห้องแล้ว (ขีดจำกัดของ Discord) — เลือกหมวดอื่น`);
  }

  await ticketRepo.saveSettings({
    guildId,
    panelChannelId: settings.panelChannelId,
    panelMessageId: settings.panelMessageId,
    categoryId,
    staffRoleId: settings.staffRoleId,
  });

  return { categoryId, name: cat.name, childCount };
}

// =====================================================================
//  เปลี่ยนยศ
// =====================================================================

/**
 * เปลี่ยนยศทีมงาน หรือ ยศแอดมินใหญ่
 * @param {'staff'|'admin'} which
 * @param {string|null} roleId  null = ล้างค่า (ใช้ได้กับยศแอดมินเท่านั้น)
 */
async function setRole(guildId, which, roleId) {
  const settings = await ticketRepo.getSettings(guildId);

  if (!settings) throw new Error('ยังไม่ได้ตั้งค่าระบบตั๋ว');

  const isStaff = which === 'staff';

  if (!roleId) {
    if (isStaff) throw new Error('ยศทีมงานต้องมีค่า ไม่สามารถล้างได้');

    await ticketRepo.saveSettings({
      guildId,
      panelChannelId: settings.panelChannelId,
      panelMessageId: settings.panelMessageId,
      categoryId: settings.categoryId,
      staffRoleId: settings.staffRoleId,
      adminRoleId: null,
    });

    return { cleared: true };
  }

  const roles = await api(`/guilds/${guildId}/roles`);
  const role = roles.find((r) => r.id === roleId);

  if (!role) throw new Error('ไม่พบยศนี้ในเซิร์ฟเวอร์');
  if (role.id === guildId) throw new Error('ใช้ยศ @everyone ไม่ได้');
  if (role.managed) {
    throw new Error(`ยศ "${role.name}" เป็นยศที่บอทหรือระบบอื่นจัดการอยู่ มอบให้คนไม่ได้`);
  }

  await ticketRepo.saveSettings({
    guildId,
    panelChannelId: settings.panelChannelId,
    panelMessageId: settings.panelMessageId,
    categoryId: settings.categoryId,
    staffRoleId: isStaff ? roleId : settings.staffRoleId,
    ...(isStaff ? {} : { adminRoleId: roleId }),
  });

  return { roleId, name: role.name };
}

// =====================================================================
//  ระบบห้องเสียง
// =====================================================================

/** เปลี่ยนห้อง creator (ห้องที่เข้าแล้วได้ห้องใหม่) */
async function setVoiceCreator(guildId, channelId) {
  const settings = await voiceRepo.getSettings(guildId);

  if (!settings) {
    throw new Error('ยังไม่ได้ตั้งค่าระบบห้องเสียง — ใช้คำสั่ง /setup-voice ใน Discord ก่อน');
  }

  let ch;
  try {
    ch = await api(`/channels/${channelId}`);
  } catch (err) {
    throw new Error(`ไม่พบห้องนี้ (${err.message})`);
  }

  // 2 = GuildVoice
  if (ch.type !== 2) throw new Error('ต้องเลือกห้องเสียง (voice channel)');
  if (ch.guild_id !== guildId) throw new Error('ห้องนี้ไม่ได้อยู่ในเซิร์ฟเวอร์ที่ dashboard ดูแล');

  await voiceRepo.saveSettings({
    guildId,
    creatorChannelId: channelId,
    categoryId: ch.parent_id ?? settings.categoryId,
  });

  return { channelId, name: ch.name };
}

// =====================================================================
//  โพสต์ข้อความ
// =====================================================================

function stripAnsiFormatting(content) {
  return String(content ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/```ansi\r?\n/gi, '```\n');
}

/**
 * ส่งข้อความไปยังห้องที่เลือก
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} content - ข้อความที่จะส่ง
 * @returns {Promise<{ channelId: string, messageId: string, channelName: string }>}
 */
async function postMessage(guildId, channelId, content) {
  if (!content || !content.trim()) {
    throw new Error('ข้อความต้องไม่เป็นค่าว่าง');
  }

  const trimmed = stripAnsiFormatting(content).trim();
  if (trimmed.length > 2000) {
    throw new Error(`ข้อความยาวเกินไป (${trimmed.length}/2000 ตัวอักษร)`);
  }

  // ตรวจสอบว่าห้องนี้อยู่ในเซิร์ฟเวอร์ที่ถูกต้อง
  await assertTextChannel(channelId, guildId, 'ห้องที่จะโพสต์');

  // ส่งข้อความ
  let sent;
  try {
    sent = await api(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: trimmed }),
    });
  } catch (err) {
    if (err.status === 403) {
      throw new Error('บอทส่งข้อความในห้องนั้นไม่ได้ — ตรวจสิทธิ์ มองเห็นห้อง / ส่งข้อความ');
    }
    throw new Error(`ส่งข้อความไม่สำเร็จ: ${err.message}`);
  }

  // ดึงชื่อห้อง
  const channel = await api(`/channels/${channelId}`);

  return {
    channelId,
    messageId: sent.id,
    channelName: channel.name || 'ไม่ทราบชื่อห้อง',
  };
}

module.exports = {
  movePanelChannel,
  movePanel,
  setCategory,
  setRole,
  setVoiceCreator,
  postMessage,
};
