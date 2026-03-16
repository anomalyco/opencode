import path from "path"
import os from "os"
import { chmod, mkdir, rm } from "fs/promises"
import { existsSync } from "fs"
import { Log } from "@/util/log"

const log = Log.create({ service: "daemon.service" })

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode")
const CONFIG_FILE = path.join(CONFIG_DIR, "daemon.json")

interface DaemonConfig {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}

export namespace DaemonService {
  export async function saveConfig(config: DaemonConfig) {
    await mkdir(CONFIG_DIR, { recursive: true })
    await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2))
    await chmod(CONFIG_FILE, 0o600)
  }

  export async function loadConfig(): Promise<DaemonConfig | undefined> {
    if (!existsSync(CONFIG_FILE)) return undefined
    const file = Bun.file(CONFIG_FILE)
    return (await file.json()) as DaemonConfig
  }

  export async function install(opts: DaemonConfig) {
    await saveConfig(opts)
    const platform = process.platform
    if (platform === "darwin") return installMacOS(opts)
    if (platform === "linux") return installLinux(opts)
    if (platform === "win32") return installWindows(opts)
    throw new Error(`Unsupported platform: ${platform}`)
  }

  export async function uninstall() {
    const platform = process.platform
    if (platform === "darwin") return uninstallMacOS()
    if (platform === "linux") return uninstallLinux()
    if (platform === "win32") return uninstallWindows()
    throw new Error(`Unsupported platform: ${platform}`)
  }

  export async function status(): Promise<boolean> {
    const platform = process.platform
    if (platform === "darwin") return statusMacOS()
    if (platform === "linux") return statusLinux()
    if (platform === "win32") return statusWindows()
    throw new Error(`Unsupported platform: ${platform}`)
  }
}

// --- macOS (launchd) ---

const LAUNCHD_LABEL = "ai.opencode.daemon"
const LAUNCHD_PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)

function buildPlistArgs(opts: DaemonConfig): string[] {
  const args = ["daemon", "start", "--port", String(opts.port), "--hostname", opts.hostname]
  if (opts.mdns) args.push("--mdns")
  if (opts.mdnsDomain) args.push("--mdns-domain", opts.mdnsDomain)
  for (const c of opts.cors ?? []) args.push("--cors", c)
  return args
}

function buildPlist(opts: DaemonConfig): string {
  const execPath = process.execPath
  const args = buildPlistArgs(opts)
  const logDir = path.join(os.homedir(), "Library", "Logs", "opencode")
  const argsXml = [execPath, ...args].map((a) => `      <string>${escapeXml(a)}</string>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(logDir)}/daemon.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logDir)}/daemon.stderr.log</string>
</dict>
</plist>`
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

async function installMacOS(opts: DaemonConfig) {
  const logDir = path.join(os.homedir(), "Library", "Logs", "opencode")
  await mkdir(logDir, { recursive: true })
  await mkdir(path.dirname(LAUNCHD_PLIST), { recursive: true })
  await Bun.write(LAUNCHD_PLIST, buildPlist(opts))
  const proc = Bun.spawn(["launchctl", "load", "-w", LAUNCHD_PLIST], { stdout: "inherit", stderr: "inherit" })
  await proc.exited
  if (proc.exitCode !== 0) throw new Error(`launchctl load failed (exit ${proc.exitCode})`)
  log.info("macOS service installed", { plist: LAUNCHD_PLIST })
}

async function uninstallMacOS() {
  const proc = Bun.spawn(["launchctl", "unload", "-w", LAUNCHD_PLIST], { stdout: "inherit", stderr: "inherit" })
  await proc.exited
  if (existsSync(LAUNCHD_PLIST)) {
    await rm(LAUNCHD_PLIST)
  }
  log.info("macOS service uninstalled")
}

async function statusMacOS(): Promise<boolean> {
  const proc = Bun.spawn(["launchctl", "list", LAUNCHD_LABEL], { stdout: "pipe", stderr: "pipe" })
  await proc.exited
  return proc.exitCode === 0
}

// --- Linux (systemd) ---

const SYSTEMD_SERVICE = "opencode-daemon.service"
const SYSTEMD_DIR = path.join(os.homedir(), ".config", "systemd", "user")
const SYSTEMD_FILE = path.join(SYSTEMD_DIR, SYSTEMD_SERVICE)

function buildServiceUnit(opts: DaemonConfig): string {
  const execPath = process.execPath
  const args = buildPlistArgs(opts) // reuse arg builder
  const quoted = [execPath, ...args].map((a) => `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(" ")
  return `[Unit]
Description=OpenCode Daemon
After=network.target

[Service]
Type=simple
ExecStart=${quoted}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

async function installLinux(opts: DaemonConfig) {
  await mkdir(SYSTEMD_DIR, { recursive: true })
  await Bun.write(SYSTEMD_FILE, buildServiceUnit(opts))
  const reload = Bun.spawn(["systemctl", "--user", "daemon-reload"], { stdout: "inherit", stderr: "inherit" })
  await reload.exited
  if (reload.exitCode !== 0) throw new Error(`systemctl daemon-reload failed (exit ${reload.exitCode})`)
  const enable = Bun.spawn(["systemctl", "--user", "enable", "--now", SYSTEMD_SERVICE], {
    stdout: "inherit",
    stderr: "inherit",
  })
  await enable.exited
  if (enable.exitCode !== 0) throw new Error(`systemctl enable --now failed (exit ${enable.exitCode})`)
  log.info("Linux systemd service installed", { unit: SYSTEMD_FILE })
}

async function uninstallLinux() {
  const disable = Bun.spawn(["systemctl", "--user", "disable", "--now", SYSTEMD_SERVICE], {
    stdout: "inherit",
    stderr: "inherit",
  })
  await disable.exited
  if (disable.exitCode !== 0) throw new Error(`systemctl disable --now failed (exit ${disable.exitCode})`)
  if (existsSync(SYSTEMD_FILE)) {
    await rm(SYSTEMD_FILE)
  }
  const reload = Bun.spawn(["systemctl", "--user", "daemon-reload"], { stdout: "inherit", stderr: "inherit" })
  await reload.exited
  if (reload.exitCode !== 0) throw new Error(`systemctl daemon-reload failed (exit ${reload.exitCode})`)
  log.info("Linux systemd service uninstalled")
}

async function statusLinux(): Promise<boolean> {
  const proc = Bun.spawn(["systemctl", "--user", "is-active", "--quiet", SYSTEMD_SERVICE], {
    stdout: "pipe",
    stderr: "pipe",
  })
  await proc.exited
  return proc.exitCode === 0
}

// --- Windows ---

const WIN_TASK_NAME = "OpenCodeDaemon"

async function installWindows(opts: DaemonConfig) {
  const execPath = process.execPath
  const args = buildPlistArgs(opts)
  const command = `"${execPath}" ${args.map((a) => `"${a}"`).join(" ")}`
  // Use scheduled task as a user-level service
  const proc = Bun.spawn(
    ["schtasks", "/Create", "/SC", "ONLOGON", "/TN", WIN_TASK_NAME, "/TR", command, "/F", "/RL", "LIMITED"],
    { stdout: "inherit", stderr: "inherit" },
  )
  await proc.exited
  if (proc.exitCode !== 0) throw new Error(`schtasks /Create failed (exit ${proc.exitCode})`)
  // Start it immediately
  const start = Bun.spawn(["schtasks", "/Run", "/TN", WIN_TASK_NAME], { stdout: "inherit", stderr: "inherit" })
  await start.exited
  if (start.exitCode !== 0) throw new Error(`schtasks /Run failed (exit ${start.exitCode})`)
  log.info("Windows scheduled task installed", { name: WIN_TASK_NAME })
}

async function uninstallWindows() {
  const proc = Bun.spawn(["schtasks", "/Delete", "/TN", WIN_TASK_NAME, "/F"], {
    stdout: "inherit",
    stderr: "inherit",
  })
  await proc.exited
  log.info("Windows scheduled task removed")
}

async function statusWindows(): Promise<boolean> {
  const proc = Bun.spawn(["schtasks", "/Query", "/TN", WIN_TASK_NAME], { stdout: "pipe", stderr: "pipe" })
  await proc.exited
  return proc.exitCode === 0
}
