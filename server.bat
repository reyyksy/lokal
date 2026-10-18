@echo off
chcp 65001 > nul
:: ═══════════════════════════════════════════════════════════
::   LAN File Explorer — Launcher Script (Windows)
::   Jalankan: klik dua kali  atau  server.bat  di CMD
:: ═══════════════════════════════════════════════════════════

cd /d "%~dp0"

:: Cek Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   [X] Node.js tidak ditemukan!
    echo       Install Node.js dari https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:MENU
cls
echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║         LAN FILE EXPLORER — Launcher                 ║
echo   ╚══════════════════════════════════════════════════════╝
echo.
echo   Pilih mode:
echo.
echo   1) Jalankan Server Langsung (port 3000)
echo   2) Buka Menu Manajemen (Akun, Traffic Log, dll)
echo   3) Keluar
echo.
set /p pilihan="  Pilihan [1/2/3]: "

if "%pilihan%"=="1" goto :START_SERVER
if "%pilihan%"=="2" goto :MANAGE
if "%pilihan%"=="3" goto :EXIT
goto :MENU

:START_SERVER
echo.
echo   Menjalankan LAN File Server di http://localhost:3000 ...
echo   Tekan Ctrl+C untuk menghentikan server.
echo.
node server.js
echo.
echo   Server dihentikan.
pause
goto :MENU

:MANAGE
echo.
echo   Membuka Menu Manajemen ...
echo.
node manage-account.js
goto :MENU

:EXIT
echo.
echo   Keluar.
echo.
exit /b 0
