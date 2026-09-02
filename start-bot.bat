@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
REM หมายเหตุ: ห้ามใส่ & ในบรรทัด title เพราะ cmd จะตีว่าเป็นตัวคั่นคำสั่ง
title Ticket and Voice Bot
cd /d "%~dp0"

echo.
echo ==============================================================
echo   บอทระบบตั๋วสนับสนุน + ห้องเสียงชั่วคราว
echo ==============================================================
echo.

REM ---------- ตรวจ Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [X] ไม่พบ Node.js ในเครื่อง
    echo.
    echo     บอทนี้ต้องใช้ Node.js เวอร์ชัน 18 ขึ้นไป
    echo     ดาวน์โหลดที่ https://nodejs.org  ^(เลือกแบบ LTS^)
    echo     ติดตั้งเสร็จแล้วปิดหน้าต่างนี้แล้วเปิดใหม่
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo [OK] Node.js !NODEVER!

REM ---------- ตรวจไฟล์ .env ----------
if not exist ".env" (
    echo [X] ไม่พบไฟล์ .env
    echo.
    if exist ".env.example" (
        echo     กำลังสร้างไฟล์ .env จาก .env.example ให้...
        copy /y ".env.example" ".env" >nul
        echo     [OK] สร้างแล้ว
        echo.
        echo     ขั้นตอนต่อไป: เปิดไฟล์ .env แล้วกรอกค่าให้ครบ
        echo       TOKEN         = Bot Token จาก Discord Developer Portal
        echo       CLIENT_ID     = Application ID
        echo       SUPABASE_URL  = Project URL ของ Supabase
        echo       SUPABASE_KEY  = key ฝั่ง secret ^(sb_secret_... หรือ service_role^)
        echo.
        echo     กรอกเสร็จแล้วรันไฟล์นี้อีกครั้ง
        echo.
        set /p "OPENENV=ต้องการเปิดไฟล์ .env เลยไหม? (y/n): "
        if /i "!OPENENV!"=="y" notepad ".env"
    ) else (
        echo     ไม่พบ .env.example ด้วย - ไฟล์โปรเจกต์อาจไม่ครบ
    )
    echo.
    pause
    exit /b 1
)
echo [OK] พบไฟล์ .env

REM ---------- ตรวจว่า TOKEN ในไฟล์ .env มีค่าจริง ----------
set "HASTOKEN="
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="TOKEN" if not "%%b"=="" set "HASTOKEN=1"
)
if not defined HASTOKEN (
    echo [X] ยังไม่ได้กรอก TOKEN ในไฟล์ .env
    echo.
    echo     เอา Bot Token จาก https://discord.com/developers/applications
    echo     -^> เลือกแอปของคุณ -^> เมนู Bot -^> กด Reset Token
    echo.
    echo     อย่าลืมเปิด Privileged Gateway Intents ทั้ง 2 อันด้วย:
    echo       - SERVER MEMBERS INTENT
    echo       - MESSAGE CONTENT INTENT
    echo.
    set /p "OPENENV2=ต้องการเปิดไฟล์ .env เลยไหม? (y/n): "
    if /i "!OPENENV2!"=="y" notepad ".env"
    echo.
    pause
    exit /b 1
)
echo [OK] มี TOKEN ในไฟล์ .env

REM ---------- ตรวจ node_modules ----------
if not exist "node_modules" (
    echo.
    echo [!] ยังไม่ได้ติดตั้ง package - กำลังติดตั้งให้ ^(ใช้เวลาสักครู่^)...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [X] ติดตั้ง package ไม่สำเร็จ
        echo     ลองตรวจอินเทอร์เน็ต แล้วรันคำสั่ง  npm install  เองอีกครั้ง
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] ติดตั้ง package เสร็จแล้ว
) else (
    echo [OK] package ติดตั้งไว้แล้ว
)

echo.
echo ==============================================================
echo   กำลังเปิดบอท...   ^(กด Ctrl+C เพื่อปิด^)
echo ==============================================================
echo.

node index.js

REM ---------- บอทหยุดทำงาน ----------
set "EXITCODE=%errorlevel%"
echo.
echo ==============================================================
if "%EXITCODE%"=="0" (
    echo   บอทปิดเรียบร้อยแล้ว
) else (
    echo   บอทหยุดทำงาน  ^(รหัส %EXITCODE%^)
    echo.
    echo   อ่านข้อความผิดพลาดด้านบนเพื่อดูสาเหตุ
    echo   ปัญหาที่พบบ่อย:
    echo     - TOKEN ผิดหรือถูก reset ไปแล้ว
    echo     - ยังไม่เปิด Privileged Gateway Intents ใน Developer Portal
    echo     - ยังไม่ได้สร้างตารางในฐานข้อมูล  ^(รัน setup-database.bat^)
    echo     - เปิดบอทซ้อนกันอยู่แล้ว  ^(รัน stop-bot.bat ก่อน^)
)
echo ==============================================================
echo.
pause
