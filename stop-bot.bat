@echo off
chcp 65001 >nul
setlocal
title Stop Bot
cd /d "%~dp0"

echo.
echo ==============================================================
echo   ปิดบอททุกตัวที่กำลังรัน
echo ==============================================================
echo.
echo   ใช้เมื่อ:
echo     - เผลอเปิดบอทซ้อนกันหลายตัว
echo     - หาหน้าต่างที่เปิดบอทไว้ไม่เจอ
echo     - บอทตอบซ้ำ 2 ครั้ง หรือปุ่มกดไม่ติด
echo.

REM ห่อด้วย @() เพื่อให้ .Count ถูกต้องแม้เจอบอทตัวเดียว
REM (ถ้าไม่ห่อ PowerShell จะคืน object เดี่ยว ไม่ใช่ array แล้ว .Count จะว่าง)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'index\.js' }); if ($p.Count -eq 0) { Write-Host '[i] ไม่พบบอทที่กำลังรัน' } else { Write-Host ('[!] พบบอทกำลังรัน ' + $p.Count + ' ตัว'); foreach ($x in $p) { try { Stop-Process -Id $x.ProcessId -Force -ErrorAction Stop; Write-Host ('    ปิด PID ' + $x.ProcessId + ' แล้ว') } catch { Write-Host ('    ปิด PID ' + $x.ProcessId + ' ไม่ได้: ' + $_.Exception.Message) } } }"

REM ลบไฟล์ lock ที่อาจค้างอยู่ เพื่อให้เปิดบอทใหม่ได้ทันที
if exist ".bot.lock" (
    del /q ".bot.lock" >nul 2>&1
    echo     ลบไฟล์ .bot.lock ที่ค้างแล้ว
)

echo.
echo ==============================================================
echo   เสร็จแล้ว - เปิดบอทใหม่ได้ด้วย start-bot.bat
echo ==============================================================
echo.
pause
