# Windows Installer — `install.ps1`

The PowerShell installer at the repository root provisions **opencode-fork** and
**gentle-ai** on Windows in a single invocation. It is designed for fresh
machines (auto-installs missing prerequisites via winget) and for re-installs
(preserves Engram memory across upgrades).

---

## 1. Installation Flow

The `Main` function executes seven phases:

| # | Phase | What happens |
|---|-------|-------------|
| **1** | **Version detection** | Resolves the latest opencode-fork version from GitHub (HTTP redirect first, API fallback, then Nextcloud mirror, then hardcoded fallback `v1.0.9`). |
| **2** | **Prerequisites check** | Verifies `git`, `node`, `npm` are on PATH. If missing and winget is available, auto-installs them. If winget is unavailable, prints manual download links and exits. |
| **3** | **Install opencode-fork** | Downloads the `opencode_X.Y.Z_windows_amd64.zip` archive, extracts it, copies `opencode.exe` to `%LOCALAPPDATA%\opencode\bin\`. |
| **4** | **Install gentle-ai** | Same download/extract/copy sequence for `gentle-ai.exe` into `%LOCALAPPDATA%\gentle-ai\bin\`. |
| **5** | **PATH setup** | Appends both `bin` directories to the User PATH environment variable and the current session's PATH. |
| **6** | **Engram DB backup** | If `%USERPROFILE%\.engram\engram.db` exists, creates a timestamped copy before proceeding. |
| **7** | **Agent config + linking** | Runs `gentle-ai install --agent opencode` to download skills, prompts, and plugins. Copies global config to the desktop app's data directory. Verifies both binaries respond. |

---

## 2. Error Resilience Strategy

### Retry with exponential backoff

`Download-WithRetry` attempts downloads up to **3 times**. Wait time between
retries follows exponential backoff: 2, 4, and 8 seconds (`[math]::Pow(2, $i)`).
Each attempt uses a 300-second timeout.

### Mirror fallback chain

When the primary GitHub download fails, the installer falls through:

```
GitHub HTTPS (302 redirect) ──> GitHub API ──> Nextcloud WebDAV mirror ──> hardcoded fallback
```

- If **GitHub is unreachable** at the version-detection stage, the installer
  automatically queries the Nextcloud mirror for the latest version and switches
  to mirror mode.
- If **a specific download fails** from GitHub, the installer retries the same
  file from Nextcloud before giving up.
- If **both GitHub and Nextcloud** are unreachable, a hardcoded fallback version
  (`v1.0.9`) is used as a last resort.

### Graceful degradation

- **gentle-ai agent setup** runs with `ErrorActionPreference = "Continue"`. If
  the sub-process exits non-zero or throws, the installer warns the user and
  continues. The user can re-run `gentle-ai install --agent opencode` manually.
- **Desktop config linking** is best-effort — if no global config exists, the
  installer warns but does not fail.
- **Version verification** at the end catches errors silently; failures here do
  not roll back the installation.

### Safety checks

- **Small-file guard**: If the downloaded archive is under 1000 bytes, the
  installer aborts with an error (prevents corrupt/empty downloads).
- **Binary presence check**: After extraction, the installer confirms
  `opencode.exe` or `gentle-ai.exe` exists before copying.
- **Temporary directory cleanup**: A `finally` block always removes the temp
  extraction folder.

---

## 3. Prerequisites Auto-Install via winget

At startup the installer checks for three tools:

| Tool | Detection | winget command |
|------|-----------|----------------|
| **Git** | `Get-Command git` | `winget install --id Git.Git --source winget` |
| **Node.js** | `Get-Command node` | `winget install --id OpenJS.NodeJS.LTS --source winget` |
| **npm** | `Get-Command npm` (only if node is present) | Bundled with Node.js — no separate install |

If any are missing **and** winget is available:

```powershell
winget install --id Git.Git --source winget --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements
```

After installing, the installer **exits** with instructions to open a **new
terminal** and re-run. This is required because winget installs do not update
the PATH of the current process.

If winget is **not** available, the installer prints download URLs for Git and
Node.js and exits with code 1.

---

## 4. Engram DB Safety

Engram persistent memory lives in a **separate data directory** from the
opencode configuration:

| Data | Path | Managed by |
|------|------|-----------|
| Engram database | `%USERPROFILE%\.engram\engram.db` | Engram MCP server |
| opencode config | `%USERPROFILE%\.config\opencode\` | gentle-ai install |
| Desktop app config | `%APPDATA%\ai.opencode.desktop.dev\config\opencode\` | installer (copied from global) |

### Automatic backup before upgrade

Before any new installation overwrites files, the installer checks for an
existing Engram database and creates a timestamped backup:

```
%USERPROFILE%\.engram\engram.db.backup-20260714-091500
```

The backup size is reported in the log. This ensures that even if the new
version changes the database schema, the previous session's memory is
recoverable.

The `gentle-ai install --agent opencode` command **never touches** the Engram
data directory — it only writes to `~/.config/opencode/`.

---

## 5. PowerShell 5.1 Compatibility Notes

The installer is explicitly constrained to run correctly on **PowerShell 5.1**,
which ships with Windows 10/11 and is the minimum supported version (`#Requires
-Version 5.1`).

| PS 5.1 quirk | Mitigation in the installer |
|--------------|---------------------------|
| No `Invoke-WebRequest` without IE engine | `-UseBasicParsing` on every `Invoke-WebRequest` and `Invoke-RestMethod` call |
| `Invoke-WebRequest` does not support `-Body` with `-Method` in all scenarios | Splatting (`@iwrParams`) used to build parameters cleanly without switch-parsing ambiguity |
| No `ConvertFrom-Json -AsHashtable` | Version extraction from Nextcloud uses `[regex]::Matches()` and manual parsing instead |
| Console encoding is not UTF-8 by default | `chcp 65001` sets the console code page; `[Console]::OutputEncoding` is set to UTF-8 in a try/catch (fails gracefully on some systems) |
| No `-SkipCertificateCheck` | Not used; relies on default Windows certificate validation |
| No `??` (null-coalescing) or `??=` operators | Uses `if`/`else` for null checks, e.g., `if ($Channel -eq "") { $Channel = "stable" }` |
| Limited `Invoke-WebRequest` timeout support | `TimeoutSec` parameter used inside splatted calls, compatible with PS 5.1 |
| `$env:LOCALAPPDATA` not always set | Not an issue — it is always set on modern Windows; alternative paths are not needed |

All string-keyed hash tables use plain string literals. The installer avoids
syntax that would require PowerShell 6+ (`ForEach-Object -Parallel`, ternary
operators, `||`/`&&` pipeline chain operators).
