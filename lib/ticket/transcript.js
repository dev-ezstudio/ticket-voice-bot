/**
 * lib/ticket/transcript.js — สร้างไฟล์สรุปบทสนทนา (.txt) ก่อนลบห้องตั๋ว
 *
 * ทำไมต้องสร้างก่อนลบ: เมื่อห้องถูกลบ ข้อความหายถาวร กู้ไม่ได้
 * transcript จึงเป็นหลักฐานเดียวที่เหลือว่าคุยอะไรกันในตั๋วใบนั้น
 *
 * ข้อจำกัดที่จัดการไว้:
 *   - Discord ดึงข้อความได้ทีละ 100 ข้อความ -> วนดึงเป็นหน้าๆ
 *   - ตั๋วที่คุยกันยาวมากอาจมีหลายพันข้อความ -> จำกัดที่ MAX_MESSAGES
 *   - ไฟล์แนบต้องไม่เกิน 8 MB (server ทั่วไป) -> ตัดท้ายถ้าเกิน
 */

const { AttachmentBuilder } = require('discord.js');

/** ดึงข้อความมากสุดกี่ข้อความ (กันตั๋วที่คุยกันยาวเกินไปทำบอทค้าง) */
const MAX_MESSAGES = 2000;

/** ขนาดไฟล์สูงสุดที่ยอมแนบ (7 MB เผื่อไว้จาก limit 8 MB) */
const MAX_FILE_BYTES = 7 * 1024 * 1024;

/** จัดวันเวลาเป็นรูปแบบไทย */
function formatThaiDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 'ไม่ทราบเวลา';

  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'Asia/Bangkok',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * ดึงข้อความทั้งหมดในห้อง เรียงจากเก่าไปใหม่
 * @param {import('discord.js').TextChannel} channel
 * @returns {Promise<import('discord.js').Message[]>}
 */
async function fetchAllMessages(channel) {
  const collected = [];
  let beforeId;

  while (collected.length < MAX_MESSAGES) {
    let batch;

    try {
      batch = await channel.messages.fetch({ limit: 100, before: beforeId });
    } catch (err) {
      // ห้องถูกลบไปแล้ว หรือบอทอ่านประวัติไม่ได้ -> คืนเท่าที่ได้มา
      console.warn(`⚠️  ดึงข้อความในห้อง ${channel.id} ไม่สำเร็จ: ${err.message}`);
      break;
    }

    if (!batch || batch.size === 0) break;

    const messages = [...batch.values()];
    collected.push(...messages);

    beforeId = messages[messages.length - 1].id;

    if (batch.size < 100) break; // ถึงข้อความแรกสุดของห้องแล้ว
  }

  // fetch คืนจากใหม่ไปเก่า -> กลับลำดับให้อ่านตามเวลาจริง
  return collected.reverse();
}

/** แปลง 1 ข้อความเป็นข้อความ text หลายบรรทัด */
function renderMessage(message) {
  const time = formatThaiDateTime(message.createdAt);
  const author = message.author
    ? `${message.author.tag}${message.author.bot ? ' [บอท]' : ''} (${message.author.id})`
    : 'ไม่ทราบผู้ส่ง';

  const lines = [`[${time}] ${author}`];

  if (message.content) {
    for (const line of message.content.split('\n')) lines.push(`   ${line}`);
  }

  for (const embed of message.embeds ?? []) {
    lines.push('   ── Embed ──');
    if (embed.title) lines.push(`   หัวข้อ: ${embed.title}`);
    if (embed.description) {
      for (const line of embed.description.split('\n')) lines.push(`   ${line}`);
    }
    for (const field of embed.fields ?? []) {
      lines.push(`   • ${field.name}: ${String(field.value).replace(/\n/g, ' ')}`);
    }
    if (embed.footer?.text) lines.push(`   footer: ${embed.footer.text}`);
  }

  for (const att of message.attachments?.values() ?? []) {
    lines.push(`   [ไฟล์แนบ] ${att.name} — ${att.url}`);
  }

  for (const sticker of message.stickers?.values() ?? []) {
    lines.push(`   [สติกเกอร์] ${sticker.name}`);
  }

  if (message.editedAt) lines.push(`   (แก้ไขเมื่อ ${formatThaiDateTime(message.editedAt)})`);

  // ถ้าข้อความไม่มีเนื้อหาเลย (เช่น embed ว่าง) ให้ระบุไว้ไม่ให้ดูเหมือนบั๊ก
  if (lines.length === 1) lines.push('   (ไม่มีเนื้อหาข้อความ)');

  return lines.join('\n');
}

/**
 * แปลงข้อความเป็นรูปแบบที่เก็บลงฐานข้อมูลได้ (JSON)
 *
 * ต่างจาก renderMessage() ที่ทำข้อความสำหรับไฟล์ .txt —
 * ตัวนี้เก็บเป็นโครงสร้าง เพื่อให้ dashboard เอาไปจัดหน้าเป็นแชทได้
 *
 * @param {import('discord.js').Message} message
 */
function toRecord(message) {
  const embedText = (message.embeds ?? [])
    .map((e) => {
      const parts = [];
      if (e.title) parts.push(e.title);
      if (e.description) parts.push(e.description);
      for (const f of e.fields ?? []) parts.push(`${f.name}: ${f.value}`);
      return parts.join('\n');
    })
    .filter(Boolean)
    .join('\n---\n');

  return {
    at: message.createdAt?.toISOString() ?? null,
    authorId: message.author?.id ?? null,
    authorTag: message.author?.tag ?? 'ไม่ทราบผู้ส่ง',
    bot: Boolean(message.author?.bot),
    content: message.content ?? '',
    embed: embedText || null,
    attachments: [...(message.attachments?.values() ?? [])].map((a) => ({
      name: a.name,
      url: a.url,
    })),
  };
}

/**
 * สร้าง transcript ของห้องตั๋ว
 *
 * ฟังก์ชันนี้ "ไม่ throw" — ถ้าสร้างไม่ได้จะคืน attachment = null
 * เพราะการปิดตั๋วต้องเดินหน้าต่อได้แม้ transcript ล้มเหลว
 *
 * @param {import('discord.js').TextChannel} channel ห้องตั๋ว
 * @param {object} ticket ข้อมูลตั๋วจากฐานข้อมูล
 * @param {object} [meta]
 * @param {import('discord.js').User} [meta.closedBy] ผู้กดปิดตั๋ว
 * @returns {Promise<{attachment: AttachmentBuilder|null, messageCount: number, fileName: string, error: string|null}>}
 */
async function buildTranscript(channel, ticket, meta = {}) {
  const fileName = `transcript-ticket-${ticket?.ticketNumber ?? channel.id}.txt`;

  try {
    const messages = await fetchAllMessages(channel);

    const header = [
      '='.repeat(70),
      '  สรุปบทสนทนาในตั๋วสนับสนุน (Ticket Transcript)',
      '='.repeat(70),
      '',
      `ห้อง            : #${channel.name} (${channel.id})`,
      `เซิร์ฟเวอร์      : ${channel.guild?.name ?? 'ไม่ทราบ'} (${ticket?.guildId ?? '-'})`,
      `เลขตั๋ว          : #${ticket?.ticketNumber ?? '-'}`,
      `ผู้เปิดตั๋ว       : ${ticket?.userTag ?? 'ไม่ทราบ'} (${ticket?.userId ?? '-'})`,
      `ผู้รับเรื่อง      : ${ticket?.claimedBy ? `<@${ticket.claimedBy}> (${ticket.claimedBy})` : 'ไม่มีผู้รับเรื่อง'}`,
      `เปิดตั๋วเมื่อ     : ${ticket?.createdAt ? formatThaiDateTime(ticket.createdAt) : 'ไม่ทราบ'}`,
      `ปิดตั๋วเมื่อ      : ${formatThaiDateTime(new Date())}`,
      `ผู้ปิดตั๋ว        : ${meta.closedBy ? `${meta.closedBy.tag} (${meta.closedBy.id})` : 'ไม่ทราบ'}`,
      `จำนวนข้อความ    : ${messages.length}${messages.length >= MAX_MESSAGES ? ` (แสดงเฉพาะ ${MAX_MESSAGES} ข้อความล่าสุด)` : ''}`,
      '',
      '='.repeat(70),
      '',
    ].join('\n');

    const body =
      messages.length > 0
        ? messages.map(renderMessage).join('\n\n')
        : '(ไม่มีข้อความในห้องนี้)';

    const footer = [
      '',
      '',
      '='.repeat(70),
      `  จบสรุปบทสนทนา — สร้างโดยบอทเมื่อ ${formatThaiDateTime(new Date())}`,
      '='.repeat(70),
      '',
    ].join('\n');

    let content = header + body + footer;
    let buffer = Buffer.from(content, 'utf8');

    // ถ้าไฟล์ใหญ่เกินไป ตัดเนื้อหาส่วนกลางออกแต่คงหัวและท้ายไว้
    if (buffer.byteLength > MAX_FILE_BYTES) {
      const notice =
        '\n\n... [เนื้อหาถูกตัดเพราะไฟล์ใหญ่เกิน 7 MB — แสดงเฉพาะช่วงต้นของบทสนทนา] ...\n\n';
      const budget = MAX_FILE_BYTES - Buffer.byteLength(header + notice + footer, 'utf8');
      const trimmedBody = Buffer.from(body, 'utf8').subarray(0, Math.max(0, budget)).toString('utf8');
      content = header + trimmedBody + notice + footer;
      buffer = Buffer.from(content, 'utf8');
    }

    return {
      attachment: new AttachmentBuilder(buffer, { name: fileName }),
      messageCount: messages.length,
      fileName,
      error: null,
      // ข้อมูลแบบโครงสร้าง สำหรับเก็บลงฐานข้อมูลให้ dashboard อ่าน
      records: messages.map(toRecord),
    };
  } catch (err) {
    console.error(`❌ สร้าง transcript ของห้อง ${channel?.id} ไม่สำเร็จ:`, err);
    return { attachment: null, messageCount: 0, fileName, error: err.message, records: [] };
  }
}

module.exports = { buildTranscript, formatThaiDateTime, toRecord, MAX_MESSAGES };
