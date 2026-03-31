#!/usr/bin/env pwsh
# Athena Desktop — Windows Code Signing Script
#
# Called by Tauri during build and by CI when copying sidecar binaries.
# Usage: sign-windows.ps1 <file-to-sign>
#
# For local development, this is a no-op (unsigned builds work fine).
# In CI, set these environment variables to enable signing:
#   WINDOWS_SIGNING_CERT_BASE64  — Base64-encoded PFX certificate
#   WINDOWS_SIGNING_CERT_PASSWORD — Certificate password
#
# For EV code signing (hardware token), use:
#   WINDOWS_SIGNING_PROVIDER — CSP provider name
#   WINDOWS_SIGNING_THUMBPRINT — Certificate thumbprint

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $FilePath)) {
    Write-Host "File not found: $FilePath"
    exit 1
}

# Check if we have signing credentials
$hasCert = $env:WINDOWS_SIGNING_CERT_BASE64 -and $env:WINDOWS_SIGNING_CERT_PASSWORD
$hasEV = $env:WINDOWS_SIGNING_PROVIDER -and $env:WINDOWS_SIGNING_THUMBPRINT

if (-not $hasCert -and -not $hasEV) {
    Write-Host "No signing credentials found — skipping code signing for: $FilePath"
    Write-Host "  Set WINDOWS_SIGNING_CERT_BASE64 + WINDOWS_SIGNING_CERT_PASSWORD for PFX signing"
    Write-Host "  Set WINDOWS_SIGNING_PROVIDER + WINDOWS_SIGNING_THUMBPRINT for EV signing"
    exit 0
}

# Find signtool
$signtool = Get-Command signtool -ErrorAction SilentlyContinue
if (-not $signtool) {
    # Try common Windows SDK locations
    $sdkPaths = @(
        "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe",
        "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe"
    )
    foreach ($path in $sdkPaths) {
        $found = Get-ChildItem $path -ErrorAction SilentlyContinue | Sort-Object -Descending | Select-Object -First 1
        if ($found) {
            $signtool = $found.FullName
            break
        }
    }
    if (-not $signtool) {
        Write-Host "signtool.exe not found — install Windows SDK"
        exit 1
    }
}

if ($hasEV) {
    # EV code signing via hardware token / cloud HSM
    Write-Host "Signing with EV certificate: $FilePath"
    & $signtool sign /v `
        /fd SHA256 `
        /tr "http://timestamp.digicert.com" `
        /td SHA256 `
        /csp $env:WINDOWS_SIGNING_PROVIDER `
        /sha1 $env:WINDOWS_SIGNING_THUMBPRINT `
        $FilePath
} else {
    # PFX certificate signing
    $certPath = [System.IO.Path]::GetTempFileName() + ".pfx"
    try {
        [System.IO.File]::WriteAllBytes($certPath, [System.Convert]::FromBase64String($env:WINDOWS_SIGNING_CERT_BASE64))

        Write-Host "Signing with PFX certificate: $FilePath"
        & $signtool sign /v `
            /f $certPath `
            /p $env:WINDOWS_SIGNING_CERT_PASSWORD `
            /fd SHA256 `
            /tr "http://timestamp.digicert.com" `
            /td SHA256 `
            $FilePath
    } finally {
        if (Test-Path $certPath) {
            Remove-Item $certPath -Force
        }
    }
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Code signing failed for: $FilePath"
    exit $LASTEXITCODE
}

Write-Host "Successfully signed: $FilePath"
