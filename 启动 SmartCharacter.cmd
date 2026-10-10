@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-local-web.ps1" -Mode start
set "SC_RESULT=%ERRORLEVEL%"
if not "%SC_ENTRY_NO_PAUSE%"=="1" pause
exit /b %SC_RESULT%
