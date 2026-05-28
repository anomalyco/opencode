@echo off
echo SecureCode は Windows ネイティブ環境では動作しません。
echo WSL (Windows Subsystem for Linux) 経由でご使用ください。
echo.
echo WSL のインストール:
echo   https://learn.microsoft.com/windows/wsl/install
echo.
echo WSL をインストール後、WSL のターミナルを開き以下を実行してください:
echo   curl -fsSL https://github.com/acompany-develop/securecode-release/releases/latest/download/install ^| bash
echo.
pause
exit /b 1
