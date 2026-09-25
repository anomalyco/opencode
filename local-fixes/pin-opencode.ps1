# pin-opencode.ps1 — point OpenChamber at the patched opencode binary.
#
# MECHANISM (verified 2026-09-25): OpenChamber resolves its binary at startup as
#     process.env.OPENCODE_BINARY || searchPathFor('opencode')
# — the ENVIRONMENT VARIABLE is what counts. settings.json's `opencodeBinary` is
# UI-managed state: the config page reads and writes it, and OpenChamber DROPS the
# key every time it rewrites settings.json. Editing that file is ineffective on a
# cold start and unstable besides.
#
# So: the env var is the pin. The settings key is written only as a cosmetic
# best-effort (so the UI field is not blank) and only when OpenChamber is closed.
#
# Safe by construction: verifies the target is a real 1.x build before pinning,
# backs settings.json up before touching it, and refuses to write invalid JSON.
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$settings = 'C:\Users\Zephyrus\.config\openchamber\settings.json'
$target   = 'C:\Users\Zephyrus\.local\bin\opencode-patched.exe'

Write-Host "=== pin-opencode ==="

if (-not (Test-Path $target)) {
  Write-Host "MISSING: $target"
  Write-Host "Run 'bun run fixes:apply' first to build and stage the patched binary."
  exit 1
}

# verify the target really is a patched 1.x build before anything points at it
$ver = (& $target --version 2>&1 | Out-String).Trim()
Write-Host "  ok   target reports version $ver"
if ($ver -notmatch '^1\.') {
  Write-Host "REFUSING: $target reports '$ver', which is not an OpenCode 1.x build."
  Write-Host "OpenChamber 1.24.2 requires OpenCode 1.x; v2 has no packages/opencode/ and this patch has no target there."
  exit 1
}

# ---- primary: the environment variable OpenChamber actually reads -------------
$prev = [Environment]::GetEnvironmentVariable('OPENCODE_BINARY', 'User')
[Environment]::SetEnvironmentVariable('OPENCODE_BINARY', $target, 'User')

# tell Explorer and friends to refresh, so newly launched apps inherit it
try {
  $sig = '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
  $w32 = Add-Type -MemberDefinition $sig -Name W32Pin -Namespace EnvPin -PassThru
  $res = [UIntPtr]::Zero
  [void]$w32::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$res)
} catch {
  Write-Host "  warn could not broadcast the environment change: $($_.Exception.Message)"
}

$now = [Environment]::GetEnvironmentVariable('OPENCODE_BINARY', 'User')
Write-Host ""
Write-Host "  OPENCODE_BINARY (User scope)"
Write-Host "    before: '$prev'"
Write-Host "    now   : '$now'"
if ($now -ne $target) { Write-Host "REFUSING: the environment variable did not stick."; exit 1 }
Write-Host "  ok   environment variable pinned  <- this is the one that matters"

# ---- secondary: the settings key, cosmetic, only while OpenChamber is closed --
Write-Host ""
$running = Get-Process -Name OpenChamber -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "  skip settings.json: OpenChamber is running (PID $($running.Id -join ', '))."
  Write-Host "       The env var alone is sufficient; that key is UI state and is dropped on rewrite anyway."
} elseif (-not (Test-Path $settings)) {
  Write-Host "  skip settings.json: not found at $settings"
} else {
  $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$settings.bak-$stamp"
  Copy-Item $settings $backup
  try {
    $json = Get-Content $settings -Raw | ConvertFrom-Json
    $before = $json.opencodeBinary
    $json.opencodeBinary = $target
    $out = $json | ConvertTo-Json -Depth 100
    $null = $out | ConvertFrom-Json          # validate before writing
    Set-Content -Path $settings -Value $out -Encoding utf8
    $check = (Get-Content $settings -Raw | ConvertFrom-Json).opencodeBinary
    if ($check -eq $target) {
      Write-Host "  ok   settings.json opencodeBinary: '$before' -> '$check'  (cosmetic; backup: $backup)"
    } else {
      Write-Host "  warn settings.json value did not stick; restore $backup if the UI field matters."
    }
  } catch {
    Write-Host "  warn could not update settings.json: $($_.Exception.Message)"
    Write-Host "       Not fatal - the environment variable is the real pin."
  }
}

Write-Host ""
Write-Host "Pinned. RESTART OpenChamber for it to take effect (the env var is read at startup)."
Write-Host "Verify after restart:  managed-opencode\<pid>.json  must record"
Write-Host "  binary = $target"
Write-Host "If it records ...\resources\opencode-cli\opencode.exe, the pin did not take."
