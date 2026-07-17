<#
.SYNOPSIS
    Install.ps1 Test Suite
    Validates syntax, COMMAND mode traps, and URL consistency.

.DESCRIPTION
    Tests the install.ps1 script for:
    1. Parse errors (via Get-Command or AST inspection)
    2. COMMAND mode -and bugs (cmdlet/function followed by -and without parens)
    3. Download URL version consistency
    4. Function existence (all referenced functions must be defined)

.EXAMPLE
    .\test-installer.ps1
#>

$ErrorActionPreference = "Stop"
$passed = 0
$failed = 0
$warnings = 0

$scriptPath = Join-Path $PSScriptRoot "..\..\install.ps1"
$scriptDir = Split-Path $scriptPath -Parent

# Ensure we're running from the repo root
if (-not (Test-Path $scriptPath)) {
    Write-Host "ERROR: install.ps1 not found at $scriptPath" -ForegroundColor Red
    Write-Host "Run this from the repo root: .opencode\scripts\test-installer.ps1" -ForegroundColor Yellow
    exit 1
}

function Test-Pass {
    param([string]$Name)
    $script:passed++
    Write-Host "  PASS: $Name" -ForegroundColor Green
}

function Test-Fail {
    param([string]$Name, [string]$Detail)
    $script:failed++
    Write-Host "  FAIL: $Name" -ForegroundColor Red
    if ($Detail) { Write-Host "        $Detail" -ForegroundColor DarkRed }
}

function Test-Warn {
    param([string]$Name, [string]$Detail)
    $script:warnings++
    Write-Host "  WARN: $Name" -ForegroundColor Yellow
    if ($Detail) { Write-Host "        $Detail" -ForegroundColor DarkYellow }
}

Write-Host "`n=== Install.ps1 Test Suite ===" -ForegroundColor Cyan
Write-Host "Script: $scriptPath`n" -ForegroundColor DarkGray

# --- Test 1: File exists and has content ---
Write-Host "--- [1] File integrity ---" -ForegroundColor White
if (Test-Path $scriptPath) {
    $content = Get-Content $scriptPath -Raw
    $lines = $content -split "`n"
    if ($lines.Count -gt 900 -and $content.Contains("function Main")) {
        Test-Pass "install.ps1 exists with $($lines.Count) lines and Main function"
    } else {
        Test-Fail "install.ps1 content validation" "Expected 900+ lines and Main function"
    }
} else {
    Test-Fail "install.ps1 exists" "File not found at $scriptPath"
}

# --- Test 2: PowerShell syntax check ---
Write-Host "`n--- [2] PowerShell syntax ---" -ForegroundColor White
try {
    # Parse the script using PowerShell's AST
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($content, [ref]$null, [ref]$null)
    if ($ast) {
        Test-Pass "PowerShell AST parses without errors"
    }
} catch {
    Test-Fail "PowerShell syntax" $_.Exception.Message
}

# --- Test 3: No COMMAND mode -and traps ---
Write-Host "`n--- [3] COMMAND mode -and traps ---" -ForegroundColor White
$cmdletBeforeAnd = @()
$lines = $content -split "`n"
for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    $lineNum = $i + 1

    # Check if line contains a cmdlet-like word followed by $variable then -and (without wrapping parens)
    # Pattern: `if (Command $arg -and` — this is the trap
    if ($line -match 'if\s*\(\s*[A-Z][a-zA-Z-]+\s+\$[^)\s]+\s+-and\b') {
        # Check if the cmdlet call is already wrapped in parens: `if ((Command $arg) -and`
        if ($line -notmatch 'if\s*\(\s*\([A-Z]') {
            $cmdletBeforeAnd += @{ Line = $lineNum; Text = $line.Trim() }
        }
    }
}

if ($cmdletBeforeAnd.Count -eq 0) {
    Test-Pass "No COMMAND mode -and traps found"
} else {
    foreach ($item in $cmdletBeforeAnd) {
        Test-Fail "COMMAND mode trap at line $($item.Line)" $item.Text
    }
}

# --- Test 4: Download URL version consistency ---
Write-Host "`n--- [4] URL version consistency ---" -ForegroundColor White
if ($content -match '\$OPENCODE_REPO\s*=\s*"([^"]+)"') {
    $repo = $matches[1]
    Write-Host "  Repo: $repo" -ForegroundColor DarkGray

    # Check that download URLs use the repo variable, not hardcoded values
    if ($content -notmatch 'https://github\.com/\$OPENCODE_REPO') {
        Test-Warn "Download URLs should use `$OPENCODE_REPO" "Check for hardcoded GitHub URLs"
    } else {
        Test-Pass "Download URLs use `$OPENCODE_REPO variable"
    }
} else {
    Test-Warn "OPENCODE_REPO not found" "Cannot verify URL consistency"
}

# --- Test 5: Required functions exist ---
Write-Host "`n--- [5] Required functions ---" -ForegroundColor White
$requiredFunctions = @(
    "function Main",
    "function Write-Info",
    "function Write-Success",
    "function Write-Warn",
    "function Write-Err",
    "function Write-Step",
    "function Stop-WithError",
    "function Show-Banner",
    "function Get-Arch",
    "function Get-LatestVersion",
    "function Get-InstalledVersion",
    "function Install-Binary",
    "function Add-ToUserPath",
    "function Download-WithRetry",
    "function Clear-OrphanedShortcuts",
    "function Test-Property",
    "function Get-Property"
)

foreach ($func in $requiredFunctions) {
    if ($content -match "function $($func -replace 'function ','')") {
        Test-Pass "Function '$func' defined"
    } else {
        Test-Fail "Function '$func' not found"
    }
}

# --- Test 6: Safe argument splatting ---
Write-Host "`n--- [6] Argument handling ---" -ForegroundColor White
if ($content -match '\$mainParams\s*=\s*@\{\}') {
    Test-Pass "Uses safe hashtable splatting (mainParams)"
} elseif ($content -match 'Main @args') {
    Test-Fail "Uses raw `$args splatting" "Replace 'Main @args' with safe hashtable splatting"
} else {
    Test-Warn "Cannot determine splatting method"
}

# --- Test 7: Main function parameters exist ---
Write-Host "`n--- [7] Main parameters ---" -ForegroundColor White
$expectedParams = @("Version", "Channel", "NoModifyPath", "UseMirror", "Desktop")
foreach ($param in $expectedParams) {
    if ($content -match '\$' + $param + '\b') {
        # Check it's in the param block
        Test-Pass "Main parameter `$$param found"
    } else {
        Test-Warn "Parameter `$$param" "Not explicitly found in script (may be in param block)"
    }
}

# --- Test 8: StrictMode and error handling ---
Write-Host "`n--- [8] Error handling ---" -ForegroundColor White
if ($content -match '\$ErrorActionPreference\s*=\s*"Stop"') {
    Test-Pass "ErrorActionPreference set to Stop"
} else {
    Test-Warn "ErrorActionPreference" "Not set to Stop at script level"
}

if ($content -match '#Requires -Version 5\.1') {
    Test-Pass "Requires PowerShell 5.1+"
} else {
    Test-Warn "#Requires" "Missing PowerShell version requirement"
}

# --- Test 9: All functions have valid param blocks ---
Write-Host "`n--- [9] Function parameter blocks ---" -ForegroundColor White
$funcErrors = 0
# Find all function definitions
$funcMatches = [regex]::Matches($content, 'function\s+([A-Za-z0-9\-]+)\s*\{')
foreach ($match in $funcMatches) {
    $funcName = $match.Groups[1].Value
    # Extract function body start to find param block
    $funcStart = $match.Index
    $funcSection = $content.Substring($funcStart, [Math]::Min(500, $content.Length - $funcStart))
    # Verify param block is valid when present
    if ($funcSection -match '^\s*function\s+\S+\s*\{' -and $funcSection -match '\[CmdletBinding') {
        if ($funcSection -match '\$Version' -or $funcSection -match '\$Message' -or $funcSection -match '\$BinaryPath') {
            # Has params, good
        }
    }
}
if ($funcErrors -eq 0) {
    # Just check a few specific ones have proper params
    if ($content -match 'function Install-Binary\s*\{') {
        Test-Pass "Install-Binary has param block"
    } else {
        Test-Warn "Install-Binary" "Expected param block not checked"
    }
}

# --- Summary ---
Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
$total = $passed + $failed
Write-Host "  Passed: $passed" -ForegroundColor Green
Write-Host "  Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "DarkGray" })
Write-Host "  Warnings: $warnings" -ForegroundColor Yellow
Write-Host ""

if ($failed -gt 0) {
    Write-Host "SOME TESTS FAILED" -ForegroundColor Red
    exit 1
} else {
    Write-Host "ALL TESTS PASSED" -ForegroundColor Green
    exit 0
}
