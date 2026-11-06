@echo off
setlocal

set "ROOT=%~dp0.."
set "SOURCE=%ROOT%\packages\cli\dist\custom-linux\cli-linux-x64\bin\opencode"
set "CONTAINER=casio-agent-1"
set "TARGET=/usr/local/lib/node_modules/@opencode-ai/cli/bin/opencode2.exe"

if not exist "%SOURCE%" (
  echo Built Linux binary not found: "%SOURCE%"
  exit /b 1
)

docker cp "%SOURCE%" "%CONTAINER%:/tmp/opencode2.transfer"
if errorlevel 1 exit /b 1

docker exec -u 0 "%CONTAINER%" sh -c "mv -f /tmp/opencode2.transfer %TARGET% && chmod 755 %TARGET%"
if errorlevel 1 exit /b 1

echo.
echo Docker version:
docker exec "%CONTAINER%" /usr/local/bin/opencode2 --version
exit /b %errorlevel%
