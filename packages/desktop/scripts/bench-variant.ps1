param([Parameter(Mandatory)][string]$Name, [int]$Runs = 5)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..
# electron-vite directly: the package's prebuild hook re-downloads the CLI, which the bench keeps fixed.
bunx electron-vite build 2>&1 | Select-String -Pattern "built in|error" | Select-Object -Last 3
if (-not (Test-Path out\main\index.js)) { throw "build failed" }
bunx electron-builder --win --dir --config electron-builder.config.ts 2>&1 | Select-String -Pattern "error|signing with signtool.*OpenCode Dev" | Select-Object -Last 2
if (Test-Path "dist\$Name-unpacked") { Remove-Item "dist\$Name-unpacked" -Recurse -Force }
Rename-Item -Path dist\win-unpacked -NewName "$Name-unpacked"
bun ./scripts/bench-startup.ts --exe "dist\base-unpacked\OpenCode Dev.exe" --compare "dist\$Name-unpacked\OpenCode Dev.exe" --runs $Runs --warmup 1 --window-at=-1700,20 --out "dist\bench-startup\$Name" 2>&1 | Select-String -Pattern "^warm service|^\s{2,}|^phases|^\S+\s+\d+\s+\(|^report|^warm-up|Error|error" | Select-Object -Last 45
