@echo off
chcp 65001 > nul
cd /d "%~dp0..\.."
echo ===== Push to origin/main =====
echo.
echo 當前狀態:
git log --oneline origin/main..HEAD
echo.
echo 開始推送...
git push origin main
echo.
if %errorlevel% == 0 (
    echo ✓ 推送成功!Vercel + Railway 會自動部署,1-2 分鐘後生效。
) else (
    echo ✗ 推送失敗,errorlevel=%errorlevel%
)
echo.
echo 請按任意鍵關閉此視窗...
pause > nul
