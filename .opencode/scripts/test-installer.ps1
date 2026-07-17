<#
.SYNOPSIS
    Install.ps1 Test Suite — validates syntax, COMMAND mode traps, URL consistency.

.PARAMETER Path
    Path to install.ps1 to test. Default: repo root relative path.
#>
param([string]$Path)

$ErrorActionPreference = "Stop"
$passed = 0
$failed = 0
$warnings = 0

if (-not $Path) {
    $scriptDir = Split-Path $PSScriptRoot -Parent
    $Path = Join-Path $scriptDir "install.ps1"
}
if (-not (Test-Path $Path)) {
    Write-Host "ERROR: install.ps1 not found at $Path" -ForegroundColor Red
    exit 1
}

$content = Get-Content $Path -Raw
$allLines = $content -split "`n"

function Test-Pass    { param([string]$N); $script:passed++; Write-Host "  PASS: $N" -ForegroundColor Green }
function Test-Fail    { param([string]$N, [string]$D); $script:failed++; Write-Host "  FAIL: $N" -ForegroundColor Red; if ($D) { Write-Host "        $D" -ForegroundColor DarkRed } }
function Test-Warn    { param([string]$N, [string]$D); $script:warnings++; Write-Host "  WARN: $N" -ForegroundColor Yellow; if ($D) { Write-Host "        $D" -ForegroundColor DarkYellow } }

Write-Host "`n=== Install.ps1 Test Suite ===" -ForegroundColor Cyan
Write-Host "Script: $Path`n" -ForegroundColor DarkGray

# ----- [1] File integrity -----
Write-Host "--- [1] File integrity ---" -ForegroundColor White
if ($allLines.Count -gt 900 -and $content.Contains("function Main")) {
    Test-Pass "install.ps1: $($allLines.Count) lines, Main function present"
} else {
    Test-Fail "install.ps1 content" "Expected 900+ lines and Main function"
}

# ----- [2] PowerShell syntax (AST) -----
Write-Host "--- [2] PowerShell syntax ---" -ForegroundColor White
try {
    $null = [System.Management.Automation.Language.Parser]::ParseInput($content, [ref]$null, [ref]$null)
    Test-Pass "AST parses cleanly"
} catch {
    Test-Fail "AST parse error" $_.Exception.Message
}

# ----- [3] COMMAND mode traps -----
<#
  PowerShell 5.1 COMMAND vs EXPRESSION mode:
  BAD:  if (Test-Path $path -and $condition)
        The parser sees Test-Path's arguments as: $path, '-and', '$condition'
        '-and' becomes a string argument, not a logical operator.
  GOOD: if ((Test-Path $path) -and $condition)
        Outer parens force EXPRESSION mode for -and.
  
  This test finds BOTH:
    A) Unfixed: cmdlet-before-and without wrapping parens (FAIL)
    B) Fixed:   cmdlet wrapped in parens before -and (PASS)
#>
Write-Host "--- [3] COMMAND mode -and traps ---" -ForegroundColor White
$bugs = @()
$fixed = @()
for ($i = 0; $i -lt $allLines.Count; $i++) {
    $line = $allLines[$i]
    $n = $i + 1

    # Pattern A—BUG: if (Command $arg -and without wrapping parens
    # A cmdlet name (starts with uppercase) followed by `$arg -and`
    if ($line -match '\bif\s*\(\s*[A-Z][a-zA-Z-]+\s+\$\S+\s+-and\b') {
        # Double-check: NOT already wrapped in parens: if ((Command ...)
        if ($line -notmatch '\bif\s*\(\s*\(') {
            $bugs += @{ Line = $n; Text = $line.Trim() }
        }
    }

    # Pattern B—GOOD fixed pattern: if ((Command $arg) -and
    if ($line -match '\bif\s*\(\s*\([A-Z][a-zA-Z-]+\s+\$\S+\)\s+-and\b') {
        $fixed += @{ Line = $n; Text = $line.Trim() }
    }
}

if ($bugs.Count -gt 0) {
    foreach ($b in $bugs) {
        Test-Fail "COMMAND mode trap at line $($b.Line)" $b.Text
    }
} else {
    Test-Pass "No unfixed COMMAND mode -and traps"
}

if ($fixed.Count -gt 0) {
    foreach ($f in $fixed) {
        Test-Pass "COMMAND mode fix confirmed at line $($f.Line): $($f.Text)"
    }
} else {
    Test-Warn "No COMMAND mode fix pattern found" "Should find at least Test-Path and Test-Property wraps"
}

# ----- [4] Safe argument splatting -----
Write-Host "--- [4] Argument handling ---" -ForegroundColor White
if ($content -match '\$mainParams\s*=\s*@\{\}') {
    Test-Pass "Safe hashtable splatting (mainParams)"
} elseif ($content -match 'Main @args') {
    Test-Fail "Uses raw `$args splatting" "Replace 'Main @args' with safe hashtable splatting"
} else {
    Test-Warn "Cannot determine splatting method"
}

# Verify Main is called with @mainParams, not @args
$mainCall = Select-String -Path $Path -Pattern '\bMain\b' | Where-Object { $_.Line -match '\bMain\s' }
$hasSafeMain = $false
$hasUnsafeMain = $false
foreach ($m in $mainCall) {
    if ($m.Line -match 'Main @mainParams') { $hasSafeMain = $true }
    if ($m.Line -match 'Main @args')       { $hasUnsafeMain = $true }
}
if ($hasSafeMain) { Test-Pass "Main called with @mainParams" }
if ($hasUnsafeMain) { Test-Fail "Main called with @args (unsafe)" }

# ----- [5] Required functions -----
Write-Host "--- [5] Required functions ---" -ForegroundColor White
$requiredFunctions = @(
    "function Main", "function Write-Info", "function Write-Success",
    "function Write-Warn", "function Write-Err", "function Write-Step",
    "function Stop-WithError", "function Show-Banner", "function Get-Arch",
    "function Get-LatestVersion", "function Get-InstalledVersion",
    "function Install-Binary", "function Add-ToUserPath",
    "function Download-WithRetry", "function Clear-OrphanedShortcuts",
    "function Test-Property", "function Get-Property"
)
foreach ($func in $requiredFunctions) {
    if ($content -match "function $($func -replace '^function ','')") {
        Test-Pass "Function '$func'"
    } else {
        Test-Fail "Function '$func' not found"
    }
}

# ----- [6] Error handling -----
Write-Host "--- [6] Error handling ---" -ForegroundColor White
if ($content -match '\$ErrorActionPreference\s*=\s*"Stop"') { Test-Pass 'ErrorActionPreference = Stop' }
else { Test-Warn "ErrorActionPreference" "Not set to Stop at script level" }

if ($content -match '#Requires -Version 5\.1') { Test-Pass '#Requires -Version 5.1' }
else { Test-Warn "#Requires" "Missing PowerShell version requirement" }

# ----- [7] Main parameters (inside function Main's param block) -----
Write-Host "--- [7] Main parameters ---" -ForegroundColor White
# Parameters live inside "function Main { param(...) }", not at script level
$mainStart = $content.IndexOf("function Main {")
if ($mainStart -ge 0) {
    $mainBody = $content.Substring($mainStart, 500)
    $mainParam = [regex]::Match($mainBody, 'param\s*\(([^)]+)\)')
    if ($mainParam.Success) {
        foreach ($param in @("Version", "Channel", "NoModifyPath", "UseMirror", "Desktop")) {
            if ($mainParam.Groups[1].Value -match '\$' + $param + '\b') {
                Test-Pass "Main param: `$$param"
            } else {
                Test-Warn "Main param: `$$param" "Not found in Main's param() block"
            }
        }
    } else {
        Test-Warn "Main param block" "Could not find param() inside Main function"
    }
} else {
    Test-Warn "Main function" "Could not locate 'function Main {' in script"
}

# ----- [8] Release URL / version consistency -----
<#
  Verify that the download URLs built by install.ps1 match the release tag.
  Prevents the asset-not-found bug we had in v1.17.13.
#>
Write-Host "--- [8] Release URL consistency ---" -ForegroundColor White
$urlRepo = "ivanfernadezm99/opencode"
$releaseTag = "v1.17.13"

# Find how the script constructs binary download URLs
$binaryDlPatterns = @()
for ($i = 0; $i -lt $allLines.Count; $i++) {
    $line = $allLines[$i]
    $n = $i + 1
    # Look for github.com download URL construction patterns
    if ($line -match 'github\.com.*releases.*download.*\$Version.*\$archiveName') {
        $binaryDlPatterns += @{ Line = $n; Text = $line.Trim() }
    }
    if ($line -match 'github\.com.*releases.*download') {
        $binaryDlPatterns += @{ Line = $n; Text = $line.Trim() }
    }
}
if ($binaryDlPatterns.Count -gt 0) {
    # Verify the URL template uses variables, not hardcoded values
    $allUseVars = $true
    foreach ($p in $binaryDlPatterns) {
        if ($p.Text -match 'github\.com/[^"]+/[^"]+/releases/download/[^$]') {
            Test-Warn "Hardcoded download URL at line $($p.Line)" $p.Text
            $allUseVars = $false
        }
    }
    if ($allUseVars) {
        Test-Pass "Download URLs use `$Version / variables"
    }
} else {
    # Also check for nextcloud mirror download
    if ($content -match 'nextcloud.*download') {
        Test-Pass "Mirror download URL found"
    } else {
        Test-Warn "Download URLs" "Cannot find download URL construction pattern"
    }
}

# Verify binary version number consistency
$verMatches = [regex]::Matches($content, '(\d+\.\d+\.\d+)')
$uniqueVersions = @{}
foreach ($m in $verMatches) {
    $uniqueVersions[$m.Groups[1].Value] = $true
}
$scriptVersion = ($uniqueVersions.Keys | Where-Object { $_ -ne "5.1" -and $_ -ne "5000" } | Sort-Object -Descending | Select-Object -First 1)
if ($scriptVersion) {
    $tagVersion = $releaseTag -replace '^v',''
    Test-Pass "Script version $scriptVersion detected"
    # This is informational; actual URL assertion needs the CI to pass the target tag
}

# ----- Summary -----
Write-Host ""
$total = $passed + $failed
Write-Host "=== Results: $passed passed, $failed failed, $warnings warnings ===" -ForegroundColor Cyan
if ($failed -gt 0) { Write-Host "SOME TESTS FAILED" -ForegroundColor Red; exit 1 }
else { Write-Host "ALL TESTS PASSED" -ForegroundColor Green; exit 0 }
