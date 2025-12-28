# Open DeepSeek Native Launch Script (Auto-Restart)
param(
    [Parameter(Mandatory = $false)]
    [switch]$SkipInstall
)

# Set correct location
$scriptDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($scriptDir)) { $scriptDir = (Get-Item .).FullName }
Set-Location $scriptDir

Clear-Host
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OPEN DEEPSEEK - AUTO RESTART MODE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Uygulama kapandığında otomatik olarak yeniden başlatılacak." -ForegroundColor Yellow
Write-Host "Çıkmak için: CTRL+C veya pencereyi kapatın" -ForegroundColor Yellow
Write-Host ""

# Step 1: Resolution (only once)
Write-Host "[1/3] Resolving monorepo dependencies..." -ForegroundColor Yellow
node resolve-catalogs.js 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { 
    Write-Host "[ERROR] resolve-catalogs.js failed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1 
}

# Step 2: Installation (only once)
if (-not $SkipInstall) {
    Write-Host "[2/3] Installing essential packages (Using Bun for speed)..." -ForegroundColor Yellow
    if (Test-Path "package-lock.json") { Remove-Item "package-lock.json" -Force }
    
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        & bun install
    }
    else {
        & npm install --legacy-peer-deps --ignore-engines --loglevel info --no-audit --no-fund
    }
    
    if ($LASTEXITCODE -ne 0) { 
        Write-Host "[ERROR] Package installation failed." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1 
    }
}

# Step 3: Launch loop
$restartCount = 0
$maxRestarts = 100 # Sonsuz döngü koruması

while ($restartCount -lt $maxRestarts) {
    if ($restartCount -eq 0) {
        Write-Host "[3/3] Building native components and launching..." -ForegroundColor Yellow
    } else {
        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host "  RESTARTING APPLICATION (#$restartCount)" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Start-Sleep -Seconds 2
    }
    
    Set-Location "$scriptDir\packages\tauri"
    
    # Launch the app
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        & bun tauri dev
    }
    else {
        & npx tauri dev
    }
    
    $exitCode = $LASTEXITCODE
    
    # Check if it was a clean exit (CTRL+C or user closed)
    if ($exitCode -eq 0) {
        Write-Host "`nUygulama normal şekilde kapatıldı." -ForegroundColor Green
        Write-Host "Yeniden başlatılıyor..." -ForegroundColor Yellow
    }
    elseif ($exitCode -eq -1073741510) {
        # CTRL+C was pressed
        Write-Host "`nKullanıcı tarafından iptal edildi." -ForegroundColor Yellow
        break
    }
    else {
        Write-Host "`nUygulama beklenmedik şekilde kapandı (Exit Code: $exitCode)" -ForegroundColor Yellow
        Write-Host "Yeniden başlatılıyor..." -ForegroundColor Yellow
    }
    
    $restartCount++
}

if ($restartCount -ge $maxRestarts) {
    Write-Host "`n[WARNING] Maksimum restart sayısına ulaşıldı." -ForegroundColor Red
}

Write-Host "`nProcess finished." -ForegroundColor Green
Read-Host "Press Enter to exit"