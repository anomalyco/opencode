# Mammouth Code Installer for Windows
# Usage: irm https://code.mammouth.ai/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "mammouth-ai/code"
$BinaryName = "mammouth"
$InstallDir = "$env:USERPROFILE\.mammouth\bin"

function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Green }
function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red; exit 1 }

# Detect architecture
function Get-Platform {
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        switch ($env:PROCESSOR_ARCHITECTURE) {
            "ARM64" { "arm64" }
            "AMD64" { "x64" }
            default { "x64" }
        }
    } else {
        Write-Err "32-bit systems are not supported."
    }

    return "mammouth-windows-$arch"
}

# Get latest version from GitHub API
function Get-LatestVersion {
    if ($env:VERSION) {
        return $env:VERSION
    }

    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "MammouthInstaller" }
        $version = $release.tag_name -replace "^v", ""
        if (-not $version) {
            Write-Err "Failed to determine latest version."
        }
        return $version
    } catch {
        Write-Err "Failed to fetch latest release: $_"
    }
}

function Install-Mammouth {
    $platform = Get-Platform
    $version = Get-LatestVersion

    Write-Info "Installing Mammouth Code v$version for $platform..."

    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $downloadUrl = "https://github.com/$Repo/releases/download/v$version/$platform.zip"
    $tempDir = Join-Path $env:TEMP "mammouth-install-$(Get-Random)"
    $archivePath = Join-Path $tempDir "$platform.zip"

    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    Write-Info "Downloading from $downloadUrl..."
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
    } catch {
        Write-Err "Failed to download. Check if the release exists for your platform: $_"
    }

    Write-Info "Extracting..."
    Expand-Archive -Path $archivePath -DestinationPath $tempDir -Force

    # Find the binary
    $binaryPath = Get-ChildItem -Path $tempDir -Recurse -Filter "$BinaryName.exe" | Select-Object -First 1
    if (-not $binaryPath) {
        # Bun may produce the binary without .exe extension
        $binaryPath = Get-ChildItem -Path $tempDir -Recurse -Filter $BinaryName | Where-Object { -not $_.PSIsContainer } | Select-Object -First 1
    }

    if (-not $binaryPath) {
        Write-Err "Binary not found in archive."
    }

    $destPath = Join-Path $InstallDir "$BinaryName.exe"
    Copy-Item -Path $binaryPath.FullName -Destination $destPath -Force

    # Cleanup
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Info "Installed to $destPath"

    # Add to PATH
    Add-ToPath
}

function Add-ToPath {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

    if ($currentPath -like "*\.mammouth\bin*") {
        Write-Info "Mammouth Code is ready! Run 'mammouth' to get started."
        return
    }

    $newPath = "$InstallDir;$currentPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")

    # Also update current session
    $env:Path = "$InstallDir;$env:Path"

    Write-Info "Added to user PATH."
    Write-Host ""
    Write-Info "Installation complete!"
    Write-Host ""
    Write-Host "To start using Mammouth Code, either:"
    Write-Host "  1. Open a new terminal, or"
    Write-Host "  2. Run: `$env:Path = '$InstallDir;' + `$env:Path"
    Write-Host ""
    Write-Host "Then run: mammouth"
}

Install-Mammouth
