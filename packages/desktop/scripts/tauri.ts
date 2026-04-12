import { existsSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const args = process.argv.slice(2)

function cfg() {
  if (process.platform !== "win32" || args[0] !== "dev") return
  return {
    CARGO_BUILD_JOBS: "1",
    CARGO_TARGET_DIR: path.join(process.cwd(), "src-tauri", "target", `dev-${Date.now()}`),
  }
}

async function port() {
  if (process.platform !== "win32" || args[0] !== "dev") return
  const root = process.cwd().replaceAll("'", "''")
  const proc = Bun.spawn(
    [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      [
        "$portpid = (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)",
        "if (-not $portpid) { exit 0 }",
        '$p = Get-CimInstance Win32_Process -Filter "ProcessId = $portpid"',
        "if (-not $p) { exit 0 }",
        `$root = [IO.Path]::GetFullPath('${root}')`,
        "$cmd = $p.CommandLine",
        "$ok = ($p.Name -in @('bun.exe','node.exe')) -and $cmd -and ($cmd -like '*vite*') -and (($cmd -like '*packages\\desktop*') -or ($cmd -like '*packages/desktop*') -or ($cmd -like ('*' + $root + '*')))",
        "if ($ok) { taskkill /pid $portpid /T /F | Out-Null }",
      ].join("; "),
    ],
    {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  await proc.exited
}

function run(env?: Record<string, string>) {
  return Bun.spawn([process.execPath, "x", "tauri", ...args], {
    cwd: process.cwd(),
    env: env ? { ...process.env, ...env } : process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
}

function vswhere() {
  const dir = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"
  const file = path.join(dir, "Microsoft Visual Studio", "Installer", "vswhere.exe")
  if (!existsSync(file)) return
  return file
}

async function install() {
  const file = vswhere()
  if (!file) return
  const proc = Bun.spawn(
    [
      file,
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "inherit",
    },
  )
  const out = await new Response(proc.stdout).text()
  const root = out.trim()
  if (!root) return
  const bat = path.join(root, "VC", "Auxiliary", "Build", "vcvars64.bat")
  if (!existsSync(bat)) return
  return bat
}

function runWin(file: string, env?: Record<string, string>) {
  const cmd = path.join(os.tmpdir(), `opencode-tauri-${process.pid}.cmd`)
  writeFileSync(
    cmd,
    [
      "@echo off",
      `call \"${file}\" >nul`,
      "if errorlevel 1 exit /b %errorlevel%",
      `\"${process.execPath}\" x tauri %*`,
    ].join("\r\n") + "\r\n",
  )
  return Bun.spawn(["cmd.exe", "/d", "/c", cmd, ...args], {
    cwd: process.cwd(),
    env: env ? { ...process.env, ...env } : process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
}

if (process.platform !== "win32") {
  process.exit(await run().exited)
}

const env = cfg()
await port()

const file = await install()
if (!file) {
  console.warn("MSVC environment not found, starting tauri without vcvars64")
  process.exit(await run(env).exited)
}

process.exit(await runWin(file, env).exited)
