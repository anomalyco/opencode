# Windows desktop and execution plugin

Run in PowerShell with Bun 1.4.2 installed. From your checkout:

```powershell
git switch v2
git pull --ff-only origin v2
bun install
```

## Desktop (Windows x64, local production build)

Build the bundled CLI from this checkout, then the desktop and installer:

```powershell
$env:OPENCODE_CHANNEL = "prod"
$env:OPENCODE_VERSION = (Get-Content packages/cli/package.json | ConvertFrom-Json).version
bun run --cwd packages/cli script/build.ts --target=opencode-windows-x64-baseline
$env:OPENCODE_CLI_DIST = (Resolve-Path packages/cli/dist).Path
$env:OPENCODE_CLI_TARGET = "x86_64-pc-windows-msvc"
Push-Location packages/desktop
bun run build
bun run package:win --x64 --publish never
Pop-Location
```

`bun run build` runs the desktop prebuild automatically. Installer artifacts are in
`packages/desktop/dist/`. Local builds do not use the CI Windows signing step.

## Execution plugin

From the checkout root, build a new standalone package (the output must not exist):

```powershell
Push-Location packages/superpowers-execution
bun run package:stage C:/opencode/superpowers-execution-next
Pop-Location
```

This includes the compiled plugin, skills, and runtime dependencies. When ready to
restart your server, replace the installed package, keeping a timestamped backup:

```powershell
opencode service stop
Rename-Item C:/opencode/superpowers-execution "superpowers-execution-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
Rename-Item C:/opencode/superpowers-execution-next superpowers-execution
opencode service start
opencode service status
```

Keep the existing plugin config entry `"C:/opencode/superpowers-execution"`.
No `AGENTS.md` entry is needed.
