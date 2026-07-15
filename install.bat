@echo off
echo.
echo    Gentle OpenCode - One-Click Installer
echo    ------------------------------------
echo.
echo    This will install opencode + gentle-ai in a few minutes.
echo    The window will stay open so you can see the result.
echo.

set SCRIPT_URL=https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1

if exist "%~dp0install.ps1" (
    echo    Checking for updates...
    powershell -ExecutionPolicy Bypass -Command "& { $local = (Select-String -Path '%~dp0install.ps1' -Pattern '\$FALLBACK_VERSION\s*=\s*\"(v[\d.]+)\"').Matches.Groups[1].Value; try { $resp = Invoke-WebRequest 'https://github.com/ivanfernadezm99/opencode/releases/latest' -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop } catch { $resp = $_.Exception.Response }; if ($resp.Headers['Location'] -match '/tag/(v[\d.]+)') { $remote = $matches[1]; if ($remote -gt $local) { Write-Host ('    New version: ' + $remote + ' (local: ' + $local + ')'); exit 1 } else { Write-Host ('    Up to date (' + $local + ')'); exit 0 } }; exit 0 }"
    if %errorlevel% equ 1 (
        echo    Downloading new installer...
        powershell -ExecutionPolicy Bypass -Command "& { irm '%SCRIPT_URL%' | Out-File -Encoding utf8 '%~dp0install.ps1' }"
    )
    powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
) else (
    echo    Downloading latest installer...
    powershell -ExecutionPolicy Bypass -Command "& { irm '%SCRIPT_URL%' | iex }"
)
pause
