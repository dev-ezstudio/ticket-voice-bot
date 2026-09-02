@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Deploy Slash Commands
cd /d "%~dp0"

echo.
echo ==============================================================
echo   ลงทะเบียน Slash Command กับ Discord
echo ==============================================================
echo.
echo   ต้องรันเมื่อ:
echo     - ติดตั้งบอทครั้งแรก
echo     - แก้ชื่อคำสั่ง หรือ แก้ตัวเลือกของคำสั่ง
echo.
echo   ไม่ต้องรันเมื่อ: แก้แต่ logic ข้างในคำสั่ง ^(รีสตาร์ทบอทพอ^)
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
        echo     สร้างไฟล์ .env ให้แล้ว - กรุณากรอก TOKEN และ CLIENT_ID ก่อน
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

node deploy-commands.js

set "EXITCODE=%errorlevel%"
echo.
if "%EXITCODE%"=="0" (
    echo ==============================================================
    echo   เสร็จแล้ว - เปิดบอทได้เลยด้วย  start-bot.bat
    echo ==============================================================
    echo.
    echo   ถ้าพิมพ์ / ใน Discord แล้วยังไม่เห็นคำสั่ง ให้กด Ctrl+R
    echo   เพื่อรีเฟรช Discord หนึ่งครั้ง
    echo.
) else (
    echo ==============================================================
    echo   ไม่สำเร็จ  ^(รหัส %EXITCODE%^)
    echo ==============================================================
    echo.
    echo   อ่านข้อความด้านบนเพื่อดูสาเหตุ ปัญหาที่พบบ่อย:
    echo     - TOKEN ผิดหรือถูก reset ไปแล้ว
    echo     - CLIENT_ID ไม่ตรงกับ Application ID
    echo     - บอทยังไม่ได้อยู่ในเซิร์ฟเวอร์ที่ระบุใน GUILD_ID
    echo.
)
pause
