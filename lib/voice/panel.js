/**
 * lib/voice/panel.js — แผงควบคุมแบบปุ่มกดของห้องเสียง
 *
 * แนวคิด: ผู้ใช้ไม่ต้องจำคำสั่ง กดปุ่มได้เลย
 * แผงนี้ถูกส่งเข้าไปในแชทของห้องเสียงที่สร้างใหม่ (ห้องเสียง Discord มีแชทในตัว)
 *
 * ปุ่มที่ต้องรับค่าเพิ่ม (ชื่อห้อง, จำนวนคน) จะเปิด Modal ให้กรอก
 * ปุ่มที่ต้องเลือกคน (เตะ, บล็อก, อนุญาต, โอน) จะเปิด User Select Menu ให้เลือก
 *
 * customId ทุกตัวขึ้นต้นด้วย "voice:" เพื่อไม่ให้ชนกับระบบตั๋ว ("ticket:")
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');

const M = require('../messages');
const { COLORS } = require('../reply');
const { discordTime } = require('../discordUtils');

/** customId ของทุกปุ่ม/modal/select ในระบบห้องเสียง */
const IDS = {
  // ปุ่มบนแผงควบคุม
  RENAME: 'voice:rename',
  LIMIT: 'voice:limit',
  LOCK: 'voice:lock',
  UNLOCK: 'voice:unlock',
  KICK: 'voice:kick',
  BLOCK: 'voice:block',
  UNBLOCK: 'voice:unblock',
  PERMIT: 'voice:permit',
  TRANSFER: 'voice:transfer',
  CLAIM: 'voice:claim',
  INFO: 'voice:info',

  // ปุ่มในห้องคู่มือ — เรียกแผงควบคุมมาให้ (เผื่อหาแผงในห้องเสียงไม่เจอ)
  SUMMON: 'voice:summon',

  // modal (หน้าต่างกรอกข้อความ)
  MODAL_RENAME: 'voice:modal:rename',
  MODAL_LIMIT: 'voice:modal:limit',
  INPUT_NAME: 'voice:input:name',
  INPUT_LIMIT: 'voice:input:limit',

  // select menu เลือกผู้ใช้
  SELECT_KICK: 'voice:select:kick',
  SELECT_BLOCK: 'voice:select:block',
  SELECT_UNBLOCK: 'voice:select:unblock',
  SELECT_PERMIT: 'voice:select:permit',
  SELECT_TRANSFER: 'voice:select:transfer',
};

// ---------------------------------------------------------------------
// embed แผงควบคุม
// ---------------------------------------------------------------------

/**
 * embed แผงควบคุม — แสดงสถานะห้องปัจจุบันด้วย
 * @param {import('discord.js').VoiceChannel} channel
 * @param {object} record ข้อมูลห้องจากฐานข้อมูล
 */
function panelEmbed(channel, record) {
  return new EmbedBuilder()
    .setColor(record.isLocked ? COLORS.warning : COLORS.success)
    .setTitle('🎛️ แผงควบคุมห้องเสียง')
    .setDescription(
      `<@${record.ownerId}> คุณเป็นเจ้าของห้องนี้ — **กดปุ่มด้านล่างเพื่อตั้งค่าได้เลย ไม่ต้องพิมพ์คำสั่ง**\n\n` +
        '⚠️ ห้องนี้จะถูกลบอัตโนมัติเมื่อทุกคนออกจากห้อง',
    )
    .addFields(
      { name: '👑 เจ้าของห้อง', value: `<@${record.ownerId}>`, inline: true },
      {
        name: '🔒 สถานะ',
        value: record.isLocked ? '🔒 ล็อกอยู่' : '🔓 เปิดให้เข้า',
        inline: true,
      },
      {
        name: '👥 จำนวนคน',
        value:
          record.userLimit > 0
            ? `${channel.members.size} / ${record.userLimit}`
            : `${channel.members.size} (ไม่จำกัด)`,
        inline: true,
      },
      {
        name: '🕒 สร้างเมื่อ',
        value: record.createdAt ? discordTime(record.createdAt, 'R') : 'เมื่อสักครู่',
        inline: true,
      },
    )
    .setFooter({ text: 'เฉพาะเจ้าของห้องกดได้ • ปุ่ม ยึดห้อง ใช้ได้เมื่อเจ้าของออกไปแล้ว' })
    .setTimestamp();
}

/**
 * ปุ่มทั้งหมด จัด 3 แถวตามหมวด (Discord จำกัด 5 ปุ่มต่อแถว, 5 แถวต่อข้อความ)
 * @param {object} record ใช้ดูว่าห้องล็อกอยู่ไหม เพื่อสลับปุ่ม lock/unlock
 */
function panelRows(record) {
  // แถว 1 — ตั้งค่าห้อง
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.RENAME)
      .setLabel('เปลี่ยนชื่อ')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDS.LIMIT)
      .setLabel('จำกัดคน')
      .setEmoji('👥')
      .setStyle(ButtonStyle.Primary),
    record.isLocked
      ? new ButtonBuilder()
          .setCustomId(IDS.UNLOCK)
          .setLabel('ปลดล็อกห้อง')
          .setEmoji('🔓')
          .setStyle(ButtonStyle.Success)
      : new ButtonBuilder()
          .setCustomId(IDS.LOCK)
          .setLabel('ล็อกห้อง')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(IDS.INFO)
      .setLabel('ดูข้อมูลห้อง')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
  );

  // แถว 2 — จัดการสมาชิก
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.KICK)
      .setLabel('เตะออก')
      .setEmoji('👢')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(IDS.BLOCK)
      .setLabel('บล็อก')
      .setEmoji('🚫')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(IDS.UNBLOCK)
      .setLabel('ปลดบล็อก')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(IDS.PERMIT)
      .setLabel('อนุญาตให้เข้า')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Secondary),
  );

  // แถว 3 — ความเป็นเจ้าของ
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.TRANSFER)
      .setLabel('โอนห้อง')
      .setEmoji('👑')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDS.CLAIM)
      .setLabel('ยึดห้อง')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

// ---------------------------------------------------------------------
// modal (หน้าต่างกรอกข้อความ)
// ---------------------------------------------------------------------

/** modal กรอกชื่อห้องใหม่ */
function renameModal(currentName) {
  return new ModalBuilder()
    .setCustomId(IDS.MODAL_RENAME)
    .setTitle('เปลี่ยนชื่อห้อง')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(IDS.INPUT_NAME)
          .setLabel('ชื่อห้องใหม่')
          .setPlaceholder('เช่น ห้องปาร์ตี้บอส')
          .setValue(String(currentName ?? '').slice(0, 100))
          .setMinLength(1)
          .setMaxLength(100)
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
}

/** modal กรอกจำนวนคน */
function limitModal(currentLimit) {
  return new ModalBuilder()
    .setCustomId(IDS.MODAL_LIMIT)
    .setTitle('จำกัดจำนวนคนในห้อง')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(IDS.INPUT_LIMIT)
          .setLabel('จำนวนคนสูงสุด (0 = ไม่จำกัด)')
          .setPlaceholder('กรอกตัวเลข 0-99')
          .setValue(String(currentLimit ?? 0))
          .setMinLength(1)
          .setMaxLength(2)
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
}

// ---------------------------------------------------------------------
// select menu เลือกผู้ใช้
// ---------------------------------------------------------------------

/** ข้อความชวนเลือกคนของแต่ละ action */
const SELECT_PROMPTS = {
  [IDS.SELECT_KICK]: { title: '👢 เลือกคนที่จะเตะออกจากห้อง', placeholder: 'เลือกสมาชิก' },
  [IDS.SELECT_BLOCK]: { title: '🚫 เลือกคนที่จะบล็อก', placeholder: 'เลือกสมาชิก' },
  [IDS.SELECT_UNBLOCK]: { title: '✅ เลือกคนที่จะปลดบล็อก', placeholder: 'เลือกสมาชิก' },
  [IDS.SELECT_PERMIT]: { title: '🎟️ เลือกคนที่จะอนุญาตให้เข้าห้อง', placeholder: 'เลือกสมาชิก' },
  [IDS.SELECT_TRANSFER]: { title: '👑 เลือกคนที่จะรับโอนห้อง', placeholder: 'เลือกสมาชิกที่อยู่ในห้อง' },
};

/**
 * สร้างข้อความ ephemeral ที่มี user select menu ให้เลือกคน
 * @param {string} selectId customId ของ select menu
 * @param {string} [note] ข้อความเพิ่มเติมใต้หัวข้อ
 */
function userSelect(selectId, note) {
  const prompt = SELECT_PROMPTS[selectId] ?? { title: 'เลือกสมาชิก', placeholder: 'เลือกสมาชิก' };

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(prompt.title)
    .setDescription(note ?? 'เลือกจากรายการด้านล่าง (พิมพ์ชื่อเพื่อค้นหาได้)');

  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(selectId)
      .setPlaceholder(prompt.placeholder)
      .setMinValues(1)
      .setMaxValues(1),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * ปุ่ม "เปิดแผงควบคุม" สำหรับวางในห้องคู่มือ
 * ให้สมาชิกกดเรียกแผงได้ทุกเมื่อ ไม่ต้องเลื่อนหาในแชทของห้องเสียง
 */
function summonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.SUMMON)
      .setLabel(M.t('voice.guide.buttonSummon'))
      .setEmoji('🎛️')
      .setStyle(ButtonStyle.Primary),
  );
}

module.exports = {
  IDS,
  summonRow,
  panelEmbed,
  panelRows,
  renameModal,
  limitModal,
  userSelect,
};
