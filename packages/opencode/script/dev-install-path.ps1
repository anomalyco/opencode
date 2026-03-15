# Add dev opencode to PATH
# Run with: powershell -ExecutionPolicy Bypass -File script/dev-install-path.ps1

$opencodeDir = "$env:LOCALAPPDATA\opencode\bin"

Write-Host "Checking PATH configuration..." -ForegroundColor Cyan

# Get current PATH
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")

if ($currentPath -like "*$opencodeDir*") {
    Write-Host "✓ $opencodeDir is already in your PATH" -ForegroundColor Green
    exit 0
}

Write-Host "Adding $opencodeDir to PATH..." -ForegroundColor Yellow

# Add to user PATH
$newPath = "$opencodeDir;$currentPath"
[Environment]::SetEnvironmentVariable("PATH", $newPath, "User")

Write-Host "✓ Updated user PATH" -ForegroundColor Green
Write-Host ""
Write-Host "PATH changes will take effect in new terminal windows." -ForegroundColor Cyan
Write-Host "You can refresh the current terminal with: `$env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','User') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','Machine')" -ForegroundColor Gray
