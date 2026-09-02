@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Setup Database
cd /d "%~dp0"

echo.
echo ==============================================================
echo   ติดตั้งตารางฐานข้อมูลขึ้น Supabase
echo ==============================================================
echo.
echo   ทำครั้งเดียวก่อนเปิดบอทครั้งแรก
echo   ปลอดภัยกับการรันซ้ำ - ข้อมูลเดิมไม่หาย
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

node setup-db.js

set "EXITCODE=%errorlevel%"
echo.
if "%EXITCODE%"=="0" (
    echo ==============================================================
    echo   เสร็จแล้ว - ขั้นตอนต่อไป
    echo ==============================================================
    echo.
    echo   1. รัน  deploy-commands.bat   ^(ลงทะเบียนคำสั่ง / ทำครั้งเดียว^)
    echo   2. รัน  start-bot.bat         ^(เปิดบอท^)
    echo.
) else (
    echo ==============================================================
    echo   ไม่สำเร็จ  ^(รหัส %EXITCODE%^)
    echo ==============================================================
    echo.
    echo   อ่านข้อความด้านบนเพื่อดูสาเหตุและวิธีแก้
    echo.
    echo   ทางเลือก: ทำมือผ่านเว็บได้
    echo     Supabase Dashboard -^> SQL Editor -^> New query
    echo     -^> วางไฟล์ schema.sql ทั้งไฟล์ -^> กด Run
    echo.
)
pause
