-- =====================================================================
--  schema.sql — Ticket System + Temporary Voice Channel
--  ใช้กับ Supabase (PostgreSQL)
--
--  วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> New query
--           วางไฟล์นี้ทั้งไฟล์ -> กด Run   (รันครั้งเดียวจบทั้ง 2 ระบบ)
--
--  ไฟล์นี้เขียนแบบ idempotent (รันซ้ำได้ไม่พัง) ทุกคำสั่งใช้ IF NOT EXISTS
--
--  หมายเหตุเรื่องชื่อคอลัมน์:
--    PostgreSQL จะพับตัวพิมพ์ใหญ่เป็นตัวเล็กถ้าไม่ใส่ double quote
--    ("guildId" ต้องพิมพ์ครอบ quote ทุกครั้งตลอดชีวิตโปรเจกต์ = พลาดง่าย)
--    จึงใช้ snake_case ตามธรรมเนียม Postgres: guild_id, channel_id, ...
--    โค้ดบอทฝั่ง JS แปลงชื่อให้เรียบร้อยแล้วใน lib/ticket/repo.js และ lib/voice/repo.js
--
--  Discord snowflake ID เก็บเป็น TEXT ไม่ใช่ BIGINT
--    เพราะ JS number ปลอดภัยแค่ 2^53 แต่ snowflake เป็นเลข 64 bit
-- =====================================================================


-- =====================================================================
--  ระบบที่ 1: TICKET SYSTEM
-- =====================================================================

-- ตั้งค่าระบบตั๋วต่อเซิร์ฟเวอร์ (1 แถวต่อ 1 guild)
CREATE TABLE IF NOT EXISTS ticket_settings (
    guild_id          TEXT PRIMARY KEY,
    panel_channel_id  TEXT        NOT NULL,   -- ห้องที่วาง embed ปุ่มเปิดตั๋ว
    panel_message_id  TEXT,                   -- id ข้อความ panel (ไว้อ้างอิง/ลบภายหลัง)
    category_id       TEXT        NOT NULL,   -- category ที่จะสร้างห้องตั๋วเข้าไป
    staff_role_id     TEXT        NOT NULL,   -- role ที่เห็นตั๋วและกดรับเรื่องได้
    ticket_counter    INTEGER     NOT NULL DEFAULT 0,  -- เลขรันนิ่งของตั๋ว
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  ticket_settings IS 'ตั้งค่าระบบตั๋ว 1 แถวต่อ 1 เซิร์ฟเวอร์ (ตั้งผ่าน /setup-ticket)';
COMMENT ON COLUMN ticket_settings.ticket_counter IS 'เลขรันนิ่ง เพิ่มขึ้นทุกครั้งที่เปิดตั๋วใหม่';

-- ตั๋วแต่ละใบ
CREATE TABLE IF NOT EXISTS tickets (
    channel_id     TEXT PRIMARY KEY,          -- id ห้องตั๋ว (unique โดยธรรมชาติ)
    guild_id       TEXT        NOT NULL,
    user_id        TEXT        NOT NULL,      -- ผู้เปิดตั๋ว
    user_tag       TEXT,                      -- ชื่อผู้ใช้ตอนเปิด (เก็บเผื่อ user ออกจากเซิร์ฟเวอร์)
    ticket_number  INTEGER,                   -- เลขตั๋วที่ได้จาก ticket_counter
    status         TEXT        NOT NULL DEFAULT 'open',
    claimed_by     TEXT,                      -- staff ที่รับเรื่อง (NULL = ยังไม่มีใครรับ)
    claimed_at     TIMESTAMPTZ,
    closed_by      TEXT,                      -- ใครกดปิด
    closed_at      TIMESTAMPTZ,
    close_reason   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tickets_status_check CHECK (status IN ('open', 'closed'))
);

COMMENT ON TABLE  tickets IS 'ตั๋วสนับสนุนแต่ละใบ 1 แถวต่อ 1 ห้อง';
COMMENT ON COLUMN tickets.status IS 'open = เปิดอยู่, closed = ปิดแล้ว (ห้องถูกลบไปแล้ว)';

-- index สำหรับ query ที่ /ticket-stats และ handler ใช้บ่อย
CREATE INDEX IF NOT EXISTS idx_tickets_guild        ON tickets (guild_id);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets (guild_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_user         ON tickets (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_claimed      ON tickets (guild_id, claimed_by)
    WHERE claimed_by IS NOT NULL;

-- กันเปิดตั๋วซ้ำ: 1 คน เปิดตั๋วสถานะ open ได้ทีละ 1 ใบต่อเซิร์ฟเวอร์
-- partial unique index — ตั๋วที่ closed แล้วไม่นับ จึงเปิดใบใหม่ได้เรื่อยๆ
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_one_open_per_user
    ON tickets (guild_id, user_id)
    WHERE status = 'open';


-- =====================================================================
--  ระบบที่ 2: TEMPORARY VOICE CHANNEL
-- =====================================================================

-- ตั้งค่าระบบห้องเสียงต่อเซิร์ฟเวอร์ (1 แถวต่อ 1 guild)
CREATE TABLE IF NOT EXISTS voice_settings (
    guild_id            TEXT PRIMARY KEY,
    creator_channel_id  TEXT        NOT NULL,  -- ห้อง "➕ สร้างห้องของคุณ"
    category_id         TEXT        NOT NULL,  -- category "🎙️ ห้องเสียงชั่วคราว"
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE voice_settings IS 'ตั้งค่าระบบห้องเสียงชั่วคราว 1 แถวต่อ 1 เซิร์ฟเวอร์ (ตั้งผ่าน /setup-voice)';

-- ห้องเสียงชั่วคราวที่ยังมีอยู่ (ห้องถูกลบ = แถวถูกลบ)
CREATE TABLE IF NOT EXISTS temp_channels (
    channel_id  TEXT PRIMARY KEY,
    guild_id    TEXT        NOT NULL,
    owner_id    TEXT        NOT NULL,      -- เจ้าของห้องปัจจุบัน (เปลี่ยนได้ด้วย /voice transfer หรือ /voice claim)
    name        TEXT,                      -- ชื่อห้องล่าสุดที่บอทตั้ง
    is_locked   BOOLEAN     NOT NULL DEFAULT FALSE,
    user_limit  INTEGER     NOT NULL DEFAULT 0,   -- 0 = ไม่จำกัด
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT temp_channels_user_limit_check CHECK (user_limit >= 0 AND user_limit <= 99)
);

COMMENT ON TABLE  temp_channels IS 'ห้องเสียงชั่วคราวที่ยังไม่ถูกลบ';
COMMENT ON COLUMN temp_channels.user_limit IS '0 = ไม่จำกัดจำนวนคน (ตาม Discord API)';

CREATE INDEX IF NOT EXISTS idx_temp_channels_guild ON temp_channels (guild_id);
CREATE INDEX IF NOT EXISTS idx_temp_channels_owner ON temp_channels (guild_id, owner_id);

-- ผู้ใช้ที่ถูกบล็อกจากห้องนั้นๆ (/voice block)
-- ON DELETE CASCADE: ห้องหาย -> รายการบล็อกหายตาม ไม่ต้องเก็บกวาดเอง
CREATE TABLE IF NOT EXISTS blocked_users (
    channel_id      TEXT        NOT NULL REFERENCES temp_channels (channel_id) ON DELETE CASCADE,
    blocked_user_id TEXT        NOT NULL,
    blocked_by      TEXT,                  -- ใครสั่งบล็อก
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, blocked_user_id)
);

COMMENT ON TABLE blocked_users IS 'ผู้ใช้ที่ถูกบล็อกจากห้องเสียงชั่วคราว ผูกกับ temp_channels แบบ CASCADE';

CREATE INDEX IF NOT EXISTS idx_blocked_users_channel ON blocked_users (channel_id);


-- =====================================================================
--  ส่วนขยาย: แผงควบคุม 3 หน้าของระบบตั๋ว
--
--  เพิ่มภายหลัง จึงใช้ ADD COLUMN IF NOT EXISTS เพื่อให้ฐานข้อมูลที่มีข้อมูลอยู่แล้ว
--  อัปเกรดได้โดยไม่ต้องลบตารางและไม่เสียข้อมูล (รันไฟล์นี้ซ้ำได้ตามปกติ)
--
--  3 หน้าคือ:
--    1. หน้าเปิดตั๋ว     — ทุกคนเห็น กดเปิดตั๋วได้
--    2. หน้าทีมงาน      — staff เห็น: ดูตั๋วที่ค้าง รับเรื่อง สถิติตัวเอง
--    3. หน้าแอดมินใหญ่  — admin เห็น: สถิติรวม จัดการตั๋วทั้งหมด ตั้งค่าระบบ
-- =====================================================================

ALTER TABLE ticket_settings
    ADD COLUMN IF NOT EXISTS admin_role_id           TEXT,
    ADD COLUMN IF NOT EXISTS admin_panel_channel_id  TEXT,
    ADD COLUMN IF NOT EXISTS admin_panel_message_id  TEXT,
    ADD COLUMN IF NOT EXISTS super_panel_channel_id  TEXT,
    ADD COLUMN IF NOT EXISTS super_panel_message_id  TEXT;

COMMENT ON COLUMN ticket_settings.admin_role_id IS 'ยศแอดมินใหญ่ — เห็นหน้าแอดมินใหญ่และจัดการตั๋วทุกใบได้ (NULL = ใช้สิทธิ์ Administrator ของ Discord แทน)';
COMMENT ON COLUMN ticket_settings.admin_panel_channel_id IS 'ห้องที่วางแผงควบคุมของทีมงาน';
COMMENT ON COLUMN ticket_settings.super_panel_channel_id IS 'ห้องที่วางแผงควบคุมของแอดมินใหญ่';


-- =====================================================================
--  ส่วนขยาย: เก็บประวัติแชทของตั๋วที่ปิดแล้ว
--
--  ทำไมต้องมี: เมื่อปิดตั๋ว ห้องถูกลบ ข้อความใน Discord หายถาวร
--  ถ้าไม่เก็บไว้ จะดูย้อนหลังได้แค่จากไฟล์ .txt ที่ส่งไปห้องแอดมิน
--  ตารางนี้ทำให้เปิดดูประวัติแชทจาก dashboard ได้
--
--  ⚠️ ตารางนี้เก็บ "ข้อความจริงของสมาชิก" — เป็นข้อมูลส่วนตัว
--     เข้าถึงได้เฉพาะแอดมินใหญ่ผ่าน dashboard และ RLS ปิดตายจาก key ฝั่ง public
-- =====================================================================

CREATE TABLE IF NOT EXISTS ticket_messages (
    channel_id     TEXT PRIMARY KEY,          -- ผูกกับตั๋ว 1:1 (1 ตั๋ว = 1 transcript)
    guild_id       TEXT        NOT NULL,
    ticket_number  INTEGER,
    message_count  INTEGER     NOT NULL DEFAULT 0,
    -- ข้อความทั้งหมดเก็บเป็น JSON array: [{ at, authorId, authorTag, bot, content, attachments }]
    -- ใช้ JSONB เพื่อให้ query เข้าไปในข้อมูลได้ถ้าจำเป็นในอนาคต
    messages       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    truncated      BOOLEAN     NOT NULL DEFAULT FALSE,  -- true = ข้อความยาวเกิน เก็บไม่ครบ
    saved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  ticket_messages IS 'ประวัติแชทของตั๋วที่ปิดแล้ว (ห้องถูกลบไปแล้ว) — เก็บไว้ให้ดูย้อนหลังใน dashboard';
COMMENT ON COLUMN ticket_messages.messages IS 'JSON array ของข้อความ เรียงจากเก่าไปใหม่';
COMMENT ON COLUMN ticket_messages.truncated IS 'true = ตั๋วคุยกันยาวมาก เก็บเฉพาะช่วงต้น';

CREATE INDEX IF NOT EXISTS idx_ticket_messages_guild ON ticket_messages (guild_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_number ON ticket_messages (guild_id, ticket_number);

ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;


-- =====================================================================
--  FUNCTION: เพิ่มเลขตั๋วแบบ atomic
--  เรียกจากบอทด้วย supabase.rpc('next_ticket_number', { p_guild_id: '...' })
--  ทำใน SQL เพื่อกัน race condition ตอนมีคนกดเปิดตั๋วพร้อมกันหลายคน
-- =====================================================================

CREATE OR REPLACE FUNCTION next_ticket_number(p_guild_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $BODY$
DECLARE
    v_next INTEGER;
BEGIN
    UPDATE ticket_settings
       SET ticket_counter = ticket_counter + 1
     WHERE guild_id = p_guild_id
    RETURNING ticket_counter INTO v_next;

    RETURN v_next;   -- NULL ถ้ายังไม่เคยตั้งค่า /setup-ticket
END;
$BODY$;


-- =====================================================================
--  TRIGGER: อัปเดต updated_at อัตโนมัติ
-- =====================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $BODY$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$BODY$;

DROP TRIGGER IF EXISTS trg_ticket_settings_updated_at ON ticket_settings;
CREATE TRIGGER trg_ticket_settings_updated_at
    BEFORE UPDATE ON ticket_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_voice_settings_updated_at ON voice_settings;
CREATE TRIGGER trg_voice_settings_updated_at
    BEFORE UPDATE ON voice_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
--  ROW LEVEL SECURITY
--  เปิด RLS ไว้แต่ไม่สร้าง policy ใดๆ = ปิดตายสำหรับ anon / authenticated key
--  บอทใช้ service_role key ซึ่ง bypass RLS ได้ตามปกติ
--  ผลลัพธ์: ถ้า anon key รั่วออกไป ก็อ่านข้อมูลตารางเหล่านี้ไม่ได้
-- =====================================================================

ALTER TABLE ticket_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE temp_channels   ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_users   ENABLE ROW LEVEL SECURITY;


-- =====================================================================
--  ตรวจผลลัพธ์ — query นี้จะแสดงตารางที่สร้างเสร็จ ควรได้ 5 แถว
-- =====================================================================

SELECT table_name AS "ตารางที่สร้างสำเร็จ"
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('ticket_settings', 'tickets', 'ticket_messages', 'voice_settings', 'temp_channels', 'blocked_users')
ORDER BY table_name;
