<#
.SYNOPSIS
    OpenCode one-click build, package, and release script

.DESCRIPTION
    Fully automated pipeline that executes:
    1. Environment validation (Bun, disk space, dependencies)
    2. Code generation (models snapshot)
    3. Parser cache download (tree-sitter WASM + SCM)
    4. CLI binary compilation (Bun.build with --single)
    5. Offline package assembly (exe + parsers + config + scripts)
    6. ZIP compression
    7. SHA256 checksum generation
    8. Build manifest output (version, sizes, checksums)

    Includes comprehensive error handling, timing, and structured logging.

.PARAMETER EnterpriseApiBase
    Enterprise intranet LLM API URL (default: http://YOUR_LLM_SERVER:8080/v1)

.PARAMETER EnterpriseApiKey
    API Key, supports {env:VAR} syntax (default: {env:ENTERPRISE_API_KEY})

.PARAMETER EnterpriseModel
    Model name (default: your-model-name)

.PARAMETER OutputDir
    Output directory (default: dist-offline/ under project root)

.PARAMETER Channel
    Release channel: latest, dev, beta (default: latest)

.PARAMETER EmbedWebUI
    Embed Web UI into the binary (increases size ~15MB, enables web interface)

.PARAMETER SkipCacheParsers
    Skip parser download step

.PARAMETER SkipBuild
    Skip build step (use existing binary)

.PARAMETER SkipEmbedParsers
    Skip parser embedding (use external parsers/ directory only)

.PARAMETER SkipZip
    Skip ZIP compression step

.PARAMETER Clean
    Clean all build artifacts before starting

.EXAMPLE
    .\script\build-win10-x64-release.ps1
    .\script\build-win10-x64-release.ps1 -Channel dev -Clean
    .\script\build-win10-x64-release.ps1 -EnterpriseApiBase "http://10.0.1.100:8000/v1" -EnterpriseModel "deepseek-v3" -EmbedWebUI
#>

param(
    [string]$EnterpriseApiBase = "http://YOUR_LLM_SERVER:8080/v1",
    [string]$EnterpriseApiKey = "{env:ENTERPRISE_API_KEY}",
    [string]$EnterpriseModel = "your-model-name",
    [string]$OutputDir = "",
    [string]$Channel = "latest",
    [switch]$EmbedWebUI,
    [switch]$SkipCacheParsers,
    [switch]$SkipBuild,
    [switch]$SkipEmbedParsers,
    [switch]$SkipZip,
    [switch]$Clean
)

# ============================================================
# Utility functions
# ============================================================

$script:StepNumber = 0
$script:TotalSteps = 8
$script:BuildStart = $null
$script:StepStart = $null
$script:BuildErrors = @()
$script:BuildWarnings = @()

function Write-Banner {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Text)
    $script:StepNumber++
    $script:StepStart = Get-Date
    Write-Host ""
    Write-Host "[Step $script:StepNumber/$script:TotalSteps] $Text" -ForegroundColor Yellow
}

function Write-StepDone {
    $elapsed = (Get-Date) - $script:StepStart
    Write-Host "  Done in $($elapsed.TotalSeconds.ToString('F1'))s" -ForegroundColor DarkGray
}

function Write-Ok {
    param([string]$Text)
    Write-Host "  [OK] $Text" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Text)
    Write-Host "  [FAIL] $Text" -ForegroundColor Red
    $script:BuildErrors += $Text
}

function Write-Warn {
    param([string]$Text)
    Write-Host "  [WARN] $Text" -ForegroundColor DarkYellow
    $script:BuildWarnings += $Text
}

function Write-Info {
    param([string]$Text)
    Write-Host "  $Text" -ForegroundColor DarkGray
}

function Write-FileEntry {
    param([string]$Path, [long]$Size)
    $label = if ($Size -gt 1MB) { "$([math]::Round($Size/1MB,1)) MB" } else { "$([math]::Round($Size/1KB,1)) KB" }
    Write-Host "  [+] $Path ($label)" -ForegroundColor Green
}

function Test-Command {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-SHA256 {
    param([string]$FilePath)
    $hash = Get-FileHash -Path $FilePath -Algorithm SHA256
    return $hash.Hash.ToLower()
}

function Write-Utf8File {
    param([string]$FilePath, [string]$Content)
    $dir = Split-Path $FilePath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($FilePath, $Content, [System.Text.UTF8Encoding]::new($true))
}

function Write-AsciiFile {
    param([string]$FilePath, [string]$Content)
    $dir = Split-Path $FilePath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($FilePath, $Content, [System.Text.ASCIIEncoding]::new())
}

# ============================================================
# Pre-flight checks
# ============================================================

$ErrorActionPreference = "Stop"
$script:BuildStart = Get-Date

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $OutputDir) {
    $OutputDir = Join-Path $ProjectRoot "dist-offline"
}
$OfflineCacheDir = Join-Path $ProjectRoot "offline-cache"
$ParsersCacheDir = Join-Path $OfflineCacheDir "parsers"
$BuildDir = Join-Path $ProjectRoot "packages\opencode"
$ArtifactDir = Join-Path $ProjectRoot "artifacts\win10-x64\release"
$ArtifactDirAttached = Join-Path $ProjectRoot "artifacts\win10-x64\attached"

Write-Banner "OpenCode Build & Release Pipeline"

# --- Step 1: Environment validation ---
Write-Step "Environment validation"

# 1.1 Check Bun
if (-not (Test-Command "bun")) {
    Write-Fail "Bun not installed. Run: irm bun.sh/install.ps1 | iex"
    Write-Host ""
    Write-Host "Exit code: 1" -ForegroundColor Red
    exit 1
}
$bunVersion = & bun --version
$expectedBun = "1.3.11"
Write-Ok "Bun: $bunVersion"
if ($bunVersion -ne $expectedBun) {
    Write-Warn "Expected Bun $expectedBun, got $bunVersion. Build may differ from CI."
}

# 1.2 Check disk space (need at least 2GB free)
$drive = (Get-Item $ProjectRoot).Root.FullName
$freeSpace = (Get-PSDrive -Name $drive.Substring(0,1)).Free
$freeGB = [math]::Round($freeSpace / 1GB, 1)
if ($freeGB -lt 2) {
    Write-Fail "Insufficient disk space: ${freeGB} GB free (need >= 2 GB)"
} else {
    Write-Ok "Disk space: ${freeGB} GB free on $drive"
}

# 1.3 Check/install dependencies
if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Write-Info "Installing project dependencies..."
    Push-Location $ProjectRoot
    try {
        bun install | ForEach-Object { Write-Info $_ }
        Pop-Location
    } catch {
        Pop-Location
        Write-Fail "bun install failed: $_"
    }
} else {
    Write-Ok "Dependencies: installed"
}

# 1.4 Read version
$PackageJson = Get-Content (Join-Path $BuildDir "package.json") -Encoding UTF8 | ConvertFrom-Json
$Version = $PackageJson.version
$ZipName = "lingxicode-offline-v${Version}-win10-x64.zip"
$ZipPath = Join-Path $ArtifactDir $ZipName

Write-Ok "Version: $Version (channel: $Channel)"

Write-Host ""
Write-Host "  Configuration:" -ForegroundColor White
Write-Host "    Project root:  $ProjectRoot"
Write-Host "    Output dir:    $OutputDir"
Write-Host "    Artifact dir:  $ArtifactDir"
Write-Host "    Parser cache:  $ParsersCacheDir"
Write-Host "    ZIP target:    $ZipPath"
Write-Host "    Embed Web UI:  $EmbedWebUI"
Write-Host "    Embed parsers: $(-not $SkipEmbedParsers)"

if ($script:BuildErrors.Count -gt 0) {
    Write-Host ""
    Write-Host "Environment check failed. Fix errors above and retry." -ForegroundColor Red
    exit 1
}
Write-StepDone

# --- Step 2: Clean (optional) ---
Write-Step "Clean build artifacts"

if ($Clean) {
    $cleanDirs = @(
        (Join-Path $BuildDir "dist")
        $OutputDir
        $ArtifactDir
    )
    foreach ($d in $cleanDirs) {
        if (Test-Path $d) {
            Remove-Item $d -Recurse -Force
            Write-Info "Removed: $d"
        }
    }
    Write-Ok "Clean complete"
} else {
    Write-Info "Skipped (use -Clean to clear caches)"
}
Write-StepDone

# --- Step 3: Code generation ---
Write-Step "Code generation (models snapshot)"

$modelsSnapshot = Join-Path $BuildDir "src\provider\models-snapshot.js"
try {
    Push-Location $ProjectRoot
    bun run packages/opencode/script/generate.ts 2>&1 | ForEach-Object { Write-Info $_ }
    Pop-Location
    if (Test-Path $modelsSnapshot) {
        Write-Ok "Models snapshot generated"
    } else {
        Write-Warn "Models snapshot not found (may need network for models.dev)"
    }
} catch {
    Pop-Location
    Write-Warn "Code generation failed (non-fatal): $_"
}
Write-StepDone

# --- Step 4: Download parser cache ---
Write-Step "Download parser cache (tree-sitter)"

if ($SkipCacheParsers) {
    Write-Info "Skipped (-SkipCacheParsers)"
} else {
    try {
        Push-Location $ProjectRoot
        bun run script/offline-cache-parsers.ts 2>&1 | ForEach-Object { Write-Info $_ }
        Pop-Location
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Some parsers failed to download, continuing with cached files"
        }
    } catch {
        Pop-Location
        Write-Warn "Parser download error (non-fatal): $_"
    }
}

if (Test-Path $ParsersCacheDir) {
    $parserLangs = (Get-ChildItem $ParsersCacheDir -Directory).Count
    $parserFiles = (Get-ChildItem $ParsersCacheDir -Recurse -File).Count
    Write-Ok "Parser cache: $parserLangs languages, $parserFiles files"
} else {
    Write-Warn "No parser cache available"
}
Write-StepDone

# --- Step 5: Build CLI binary ---
Write-Step "Build CLI binary (Bun.compile)"

$ExePath = Join-Path $BuildDir "dist\opencode-windows-x64\bin\opencode.exe"

if ($SkipBuild) {
    Write-Info "Skipped (-SkipBuild)"
    if (-not (Test-Path $ExePath)) {
        Write-Fail "opencode.exe not found: $ExePath"
    }
} else {
    # Temporarily move offline-cache if SkipEmbedParsers
    $cacheMoved = $false
    if ($SkipEmbedParsers -and (Test-Path $OfflineCacheDir)) {
        $tempCache = Join-Path $ProjectRoot "_offline-cache-bak"
        Move-Item $OfflineCacheDir $tempCache
        $cacheMoved = $true
        Write-Info "Temporarily moved offline-cache (SkipEmbedParsers)"
    }

    try {
        Push-Location $BuildDir
        $env:OPENCODE_CHANNEL = $Channel

        $buildArgs = @("run", "script/build.ts", "--single")
        if (-not $EmbedWebUI) {
            $buildArgs += "--skip-embed-web-ui"
        }
        $buildArgs += "--skip-install"

        Write-Info "Running: bun $($buildArgs -join ' ')"
        & bun @buildArgs 2>&1 | ForEach-Object { Write-Info $_ }

        Pop-Location

        # Restore offline-cache
        if ($cacheMoved) {
            if (Test-Path (Join-Path $ProjectRoot "offline-cache")) {
                Remove-Item (Join-Path $ProjectRoot "offline-cache") -Recurse -Force
            }
            Move-Item (Join-Path $ProjectRoot "_offline-cache-bak") $OfflineCacheDir
            Write-Info "Restored offline-cache"
        }

        if (-not (Test-Path $ExePath)) {
            Write-Fail "Build failed: opencode.exe not generated"
        }
    } catch {
        Pop-Location
        # Restore offline-cache on error
        if ($cacheMoved -and (Test-Path (Join-Path $ProjectRoot "_offline-cache-bak"))) {
            if (Test-Path (Join-Path $ProjectRoot "offline-cache")) {
                Remove-Item (Join-Path $ProjectRoot "offline-cache") -Recurse -Force
            }
            Move-Item (Join-Path $ProjectRoot "_offline-cache-bak") $OfflineCacheDir
        }
        Write-Fail "Build error: $_"
    }
}

if (Test-Path $ExePath) {
    $exeSize = (Get-Item $ExePath).Length
    Write-FileEntry "opencode.exe" $exeSize

    # Smoke test
    Write-Info "Running smoke test..."
    try {
        $versionOutput = & $ExePath --version 2>&1
        Write-Ok "Smoke test passed: $($versionOutput | Select-Object -First 1)"
    } catch {
        Write-Warn "Smoke test failed: $_"
    }
}
Write-StepDone

if ($script:BuildErrors.Count -gt 0) {
    Write-Host ""
    Write-Host "Build failed with errors. Cannot continue to packaging." -ForegroundColor Red
    exit 1
}

# --- Step 6: Assemble offline package ---
Write-Step "Assemble offline package"

# Clean output directory
if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# 6.1 Copy binary
Copy-Item $ExePath (Join-Path $OutputDir "opencode.exe") -Force
Write-FileEntry "opencode.exe" (Get-Item (Join-Path $OutputDir "opencode.exe")).Length

# 6.2 Copy parser cache
if (Test-Path $ParsersCacheDir) {
    Copy-Item -Path $ParsersCacheDir -Destination (Join-Path $OutputDir "parsers") -Recurse -Force
    $parserDirs = (Get-ChildItem (Join-Path $OutputDir "parsers") -Directory).Count
    $parserTotalSize = (Get-ChildItem (Join-Path $OutputDir "parsers") -Recurse -File | Measure-Object -Property Length -Sum).Sum
    Write-FileEntry "parsers/" $parserTotalSize
    Write-Info "  ($parserDirs languages)"
}

# 6.3 Add attached directory
if (Test-Path $ArtifactDirAttached) {
    Copy-Item -Path "$ArtifactDirAttached\*" -Destination $OutputDir -Recurse -Force
    Write-Info "Copied attached files"
}
Write-StepDone

# --- Step 7: Package ZIP ---
Write-Step "Package ZIP archive"

if ($SkipZip) {
    Write-Info "Skipped (-SkipZip)"
    $zipSize = 0
} else {
    if (-not (Test-Path $ArtifactDir)) {
        New-Item -ItemType Directory -Path $ArtifactDir -Force | Out-Null
    }
    if (Test-Path $ZipPath) {
        Remove-Item $ZipPath -Force
    }

    try {
        Compress-Archive -Path "$OutputDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal
        $zipSize = (Get-Item $ZipPath).Length
        Write-FileEntry $ZipName $zipSize
    } catch {
        Write-Fail "ZIP compression failed: $_"
        $zipSize = 0
    }
}
Write-StepDone

# --- Step 8: Generate build manifest ---
Write-Step "Generate build manifest"

$manifest = @{
    version = $Version
    channel = $Channel
    build_date = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    build_host = $env:COMPUTERNAME
    bun_version = $bunVersion
    platform = "windows-x64"
    files = @{}
    checksums = @{}
}

# Collect file info
if (Test-Path (Join-Path $OutputDir "opencode.exe")) {
    $exeItem = Get-Item (Join-Path $OutputDir "opencode.exe")
    $manifest.files["opencode.exe"] = @{
        size = $exeItem.Length
        sha256 = Get-SHA256 $exeItem.FullName
    }
    $manifest.checksums["opencode.exe"] = $manifest.files["opencode.exe"].sha256
    Write-Ok "SHA256(opencode.exe): $($manifest.files['opencode.exe'].sha256)"
}

if ($zipSize -gt 0 -and (Test-Path $ZipPath)) {
    $zipSha = Get-SHA256 $ZipPath
    $manifest.files[$ZipName] = @{
        size = $zipSize
        sha256 = $zipSha
    }
    $manifest.checksums[$ZipName] = $zipSha
    Write-Ok "SHA256($ZipName): $zipSha"
}

# Parser count
if (Test-Path $ParsersCacheDir) {
    $manifest.parser_languages = (Get-ChildItem $ParsersCacheDir -Directory).Count
    $manifest.parser_files = (Get-ChildItem $ParsersCacheDir -Recurse -File).Count
}

$manifestJson = $manifest | ConvertTo-Json -Depth 5
$manifestPath = Join-Path $ArtifactDir "build-manifest.json"
Write-Utf8File $manifestPath $manifestJson
Write-Ok "Build manifest: $manifestPath"

# Also write checksums file (portable format)
$checksumsPath = Join-Path $ArtifactDir "SHA256SUMS"
$checksumLines = @()
foreach ($entry in $manifest.checksums.GetEnumerator()) {
    $checksumLines += "$($entry.Value)  $($entry.Key)"
}
Write-Utf8File $checksumsPath ($checksumLines -join "`n")
Write-Ok "Checksums: $checksumsPath"

Write-StepDone

# ============================================================
# Final summary
# ============================================================

$buildDuration = (Get-Date) - $script:BuildStart

Write-Banner "Build Complete"

if ($script:BuildErrors.Count -gt 0) {
    Write-Host "Errors ($($script:BuildErrors.Count)):" -ForegroundColor Red
    foreach ($e in $script:BuildErrors) { Write-Host "  - $e" -ForegroundColor Red }
    Write-Host ""
}

if ($script:BuildWarnings.Count -gt 0) {
    Write-Host "Warnings ($($script:BuildWarnings.Count)):" -ForegroundColor DarkYellow
    foreach ($w in $script:BuildWarnings) { Write-Host "  - $w" -ForegroundColor DarkYellow }
    Write-Host ""
}

Write-Host "  Version:       v$Version ($Channel)" -ForegroundColor White
Write-Host "  Duration:      $($buildDuration.TotalSeconds.ToString('F1'))s" -ForegroundColor White
Write-Host "  Output:        $OutputDir" -ForegroundColor White
if ($zipSize -gt 0) {
    Write-Host "  ZIP:           $ZipPath ($([math]::Round($zipSize/1MB,1)) MB)" -ForegroundColor White
}
Write-Host "  Manifest:      $manifestPath" -ForegroundColor White
Write-Host ""

Write-Host "  Target deployment:" -ForegroundColor Cyan
Write-Host "  1. Expand-Archive -Path `"$ZipName`" -DestinationPath C:\opencode"
Write-Host "  2. Edit C:\opencode\config\opencode.json"
Write-Host "  3. C:\opencode\run.bat"
Write-Host ""

if ($script:BuildErrors.Count -gt 0) {
    exit 1
}
exit 0
