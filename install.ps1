# Mammouth Code Installer for Windows
# Usage: irm https://code.mammouth.ai/install.ps1 | iex

$ErrorActionPreference = "Stop"

# Ensure TLS 1.2 for GitHub API/downloads (PowerShell 5.1 defaults to TLS 1.0/1.1)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

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
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $tempDir = (Resolve-Path $tempDir).Path
    $archivePath = Join-Path $tempDir "$platform.zip"

    try {
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
            # Bun currently doesn't produce a binary with .exe extension, so for now we have this if statement that alwasy pases.
            # I keep it here in case one day I decide to make bun produce a .exe binary for windows, then I can remove the if statement and just look for the .exe binary :)
            $binaryPath = Get-ChildItem -Path $tempDir -Recurse -Filter $BinaryName | Where-Object { -not $_.PSIsContainer } | Select-Object -First 1
        }

        if (-not $binaryPath) {
            Write-Err "Binary not found in archive."
        }

        $destPath = Join-Path $InstallDir "$BinaryName.exe"

        # Handle binary being locked (e.g. mammouth is currently running)
        if (Test-Path $destPath) {
            try {
                # Try renaming the old binary out of the way first
                $backupPath = "$destPath.old"
                if (Test-Path $backupPath) { Remove-Item $backupPath -Force -ErrorAction SilentlyContinue }
                Rename-Item -Path $destPath -NewName "$BinaryName.exe.old" -Force
            } catch {
                Write-Err "Cannot update $destPath. You most likely than not have Mammouth Code running. Please close Mammouth Code and try again."
                Write-Info "If you're looking to update Mammouth Code, you can do so by running 'mammouth upgrade' in your terminal."
                Write-Info "If you continue to have issues, please delete or rename $destPath and try again."
            }
        }

        Copy-Item -Path $binaryPath.FullName -Destination $destPath -Force

        # Clean up old binary
        $backupPath = "$destPath.old"
        if (Test-Path $backupPath) { Remove-Item $backupPath -Force -ErrorAction SilentlyContinue }
    } finally {
        # Cleanup temp directory regardless of success or failure
        try {
          Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        } catch {
          Write-Warn "Failed to clean up temporary files. Please check $tempDir and delete it if it still exists."
        }
    }

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
