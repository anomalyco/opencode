@echo off
setlocal enabledelayedexpansion

echo Building opencode binary...

rem Get the repository root
set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

rem Create output directory
set "OUTPUT_DIR=packages\opencode\dist\local\bin"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

echo Building Go TUI binary...
cd packages\tui
set CGO_ENABLED=0
go build -ldflags="-s -w" -o "..\opencode\dist\local\bin\tui.exe" .\cmd\opencode\main.go
if errorlevel 1 exit /b 1

echo Building main CLI with embedded TUI...
cd ..\opencode
bun build --define OPENCODE_TUI_PATH="'../../../dist/local/bin/tui.exe'" --compile --outfile=dist\local\bin\opencode.exe .\src\index.ts
if errorlevel 1 exit /b 1

echo Testing binary...
.\dist\local\bin\opencode.exe --version
if errorlevel 1 exit /b 1

echo.
echo Build complete!
echo Binary location: %cd%\dist\local\bin\opencode.exe
echo.
echo You can now copy this binary anywhere and run it standalone.