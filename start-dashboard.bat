@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Dashboard
cd /d "%~dp0"

echo.
echo ==============================================================
echo   เปิดเว็บ Dashboard
echo ==============================================================
echo.

REM ---------- ตรวจ Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [X] ไม่พบ Node.js ในเครื่อง
    echo     ดาวน์โหลดที่ https://nodejs.org  ^(เลือกแบบ LTS^)
    echo.
    pause
    exit /b 1
)

REM ---------- ตรวจไฟล์ .env ----------
if not exist ".env" (
    echo [X] ไม่พบไฟล์ .env
    echo.
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo     สร้างไฟล์ .env ให้แล้ว - กรุณากรอกค่าก่อนรันอีกครั้ง
        set /p "OPENENV=เปิดไฟล์ .env เลยไหม? (y/n): "
        if /i "!OPENENV!"=="y" notepad ".env"
    )
    echo.
    pause
    exit /b 1
)

REM ---------- ตรวจว่ามี CLIENT_SECRET (ข้ามถ้าปิดล็อกอินไว้) ----------
set "HASSECRET="
set "AUTHOFF="
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="CLIENT_SECRET" if not "%%b"=="" set "HASSECRET=1"
    if /i "%%a"=="DASHBOARD_AUTH" if /i "%%b"=="off" set "AUTHOFF=1"
)

if defined AUTHOFF (
    echo [i] โหมดไม่ล็อกอิน  ^(DASHBOARD_AUTH=off ใน .env^)
    echo     ใครเปิด URL นี้ได้ก็เห็นข้อมูลทั้งหมด - ใช้เฉพาะในเครื่องตัวเอง
    echo     ถ้าจะเปิดให้คนอื่นเข้า ให้ลบบรรทัด DASHBOARD_AUTH=off ก่อน
    goto :skipsecret
)

if not defined HASSECRET (
    echo [X] ยังไม่ได้กรอก CLIENT_SECRET ในไฟล์ .env
    echo.
    echo     Dashboard ใช้ Discord ล็อกอิน จึงต้องมี Client Secret
    echo.
    echo     วิธีเอา:
    echo       1. เปิด https://discord.com/developers/applications
    echo       2. เลือกแอปของคุณ -^> เมนู OAuth2
    echo       3. หา Client Secret -^> กด Reset Secret -^> คัดลอก
    echo       4. ใส่ใน .env ที่บรรทัด CLIENT_SECRET=
    echo.
    echo     และตั้ง Redirect URI ในหน้า OAuth2 เดียวกัน:
    echo       Redirects -^> Add Redirect -^> http://localhost:3210/auth/callback
    echo       ^(ต้องตรงกับ DASHBOARD_URL ใน .env^)
    echo.
    set /p "OPENENV2=เปิดไฟล์ .env เลยไหม? (y/n): "
    if /i "!OPENENV2!"=="y" notepad ".env"
    echo.
    pause
    exit /b 1
)
echo [OK] พบ CLIENT_SECRET ในไฟล์ .env

:skipsecret

REM ---------- ตรวจ node_modules ----------
if not exist "node_modules" (
    echo [!] ยังไม่ได้ติดตั้ง package - กำลังติดตั้งให้...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [X] ติดตั้ง package ไม่สำเร็จ
        echo.
        pause
        exit /b 1
    )
    echo.
)

echo.
echo ==============================================================
echo   กำลังเปิด Dashboard...   ^(กด Ctrl+C เพื่อปิด^)
echo ==============================================================
echo.

node dashboard/server.js

set "EXITCODE=%errorlevel%"
echo.
echo ==============================================================
if "%EXITCODE%"=="0" (
    echo   ปิด Dashboard เรียบร้อยแล้ว
) else (
    echo   Dashboard หยุดทำงาน  ^(รหัส %EXITCODE%^)
    echo.
    echo   ปัญหาที่พบบ่อย:
    echo     - ยังไม่ได้กรอก CLIENT_SECRET หรือ GUILD_ID ใน .env
    echo     - พอร์ตถูกโปรแกรมอื่นใช้อยู่  ^(เปลี่ยน DASHBOARD_PORT ใน .env^)
    echo     - ยังไม่ได้สร้างตารางในฐานข้อมูล  ^(รัน setup-database.bat^)
)
echo ==============================================================
echo.
pause
