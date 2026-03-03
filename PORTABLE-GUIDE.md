# OpenCode Portable Guide

Run OpenCode from a self-contained directory — no global install, no PATH changes, no files written to your home folder. Everything lives inside `.opencode_portable/` next to the wrapper script.

## Directory Layout

```
.opencode_portable/
├── bin/           # OpenCode binary
├── config/        # XDG_CONFIG_HOME (settings, skills)
├── data/          # XDG_DATA_HOME
├── cache/         # XDG_CACHE_HOME
├── state/         # XDG_STATE_HOME
└── .version       # Currently cached version
```

## Prerequisites

| Platform | Required |
|----------|----------|
| macOS | `curl`, `unzip` (both ship with macOS) |
| Linux (glibc) | `curl`, `tar` |
| Linux (Alpine/musl) | `curl`, `tar` — install via `apk add curl tar` |
| Windows | PowerShell 5.1+ (built into Windows 10/11) |

All platforms need **`git`** if you plan to install external skill plugins.

## Download the Wrapper Script

**macOS / Linux** — requires `curl` (listed in Prerequisites above):

```bash
curl -fLO https://raw.githubusercontent.com/anomalyco/opencode/dev/opencode-portable.sh
chmod +x opencode-portable.sh
```

**Windows (PowerShell)** — requires PowerShell 5.1+ (built into Windows 10/11):

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/anomalyco/opencode/dev/opencode-portable.ps1" -OutFile "opencode-portable.ps1"
```

## Quick Start

### macOS (Apple Silicon & Intel)

The script auto-detects your architecture, including Rosetta translation.

```bash
chmod +x opencode-portable.sh
./opencode-portable.sh
```

### Linux (Ubuntu/Debian, Fedora/RHEL, Arch)

```bash
chmod +x opencode-portable.sh
./opencode-portable.sh
```

The script automatically detects musl-based distros (Alpine) and selects the correct binary. On x64, it also detects AVX2 support and falls back to a baseline build if needed.

**Alpine/musl note** — ensure `curl` and `tar` are installed:

```bash
apk add curl tar
```

### Windows (PowerShell)

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\opencode-portable.ps1
```

The `Scope Process` setting only applies to the current terminal session.

## Version Pinning & Updating

### Pin a specific version

**Option A** — environment variable (highest priority):

```bash
# macOS/Linux
OPENCODE_PORTABLE_VERSION=1.0.180 ./opencode-portable.sh

# Windows
$env:OPENCODE_PORTABLE_VERSION = "1.0.180"
.\opencode-portable.ps1
```

**Option B** — create a `.opencode-version` file next to the script:

```
1.0.180
```

The leading `v` is stripped automatically, so both `1.0.180` and `v1.0.180` work.

### Force update to the latest (or pinned) version

```bash
# macOS/Linux
./opencode-portable.sh --portable-update

# Windows
.\opencode-portable.ps1 -PortableUpdate
```

### Check the cached version

```bash
# macOS/Linux
./opencode-portable.sh --portable-version

# Windows
.\opencode-portable.ps1 -PortableVersion
```

## Troubleshooting

**"Permission denied" when running the shell script**
```bash
chmod +x opencode-portable.sh
```

**PowerShell blocks script execution**
```powershell
Set-ExecutionPolicy -Scope Process Bypass
```
This only affects the current session. For a persistent change, use `-Scope CurrentUser`.

**"curl: command not found" (Linux)**
```bash
# Debian/Ubuntu
sudo apt install curl

# Fedora/RHEL
sudo dnf install curl

# Alpine
apk add curl
```

**"tar: command not found" (Alpine)**
```bash
apk add tar
```

**Binary downloads but OpenCode won't start**
Check that the download completed successfully. A partial or corrupted download can be fixed with:
```bash
./opencode-portable.sh --portable-update     # macOS/Linux
.\opencode-portable.ps1 -PortableUpdate      # Windows
```