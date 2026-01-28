@echo off
echo ================================
echo 完全清除前端缓存并重启
echo ================================
echo.

cd /d %~dp0packages\app

echo 1. 停止所有 bun 进程...
taskkill /F /IM bun.exe 2>nul
timeout /t 2 >nul

echo 2. 清除 Vite 缓存...
if exist node_modules\.vite (
    rmdir /s /q node_modules\.vite
    echo    - 已删除 node_modules\.vite
)

echo 3. 清除 Bun 缓存...
if exist .bun-cache (
    rmdir /s /q .bun-cache 2>nul
)

echo 4. 清除 dist 目录...
if exist dist (
    rmdir /s /q dist 2>nul
)

echo.
echo ================================
echo 缓存已清除！
echo ================================
echo.
echo 正在启动前端服务器...
echo.

bun run dev
