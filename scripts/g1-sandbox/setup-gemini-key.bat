@echo off
REM Setup Gemini API Key for G1 sandbox auto-gen scripts
REM 雙擊本檔即可。會跳出 PowerShell 視窗讓你輸入 Key。
chcp 65001 > nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-gemini-key.ps1"
