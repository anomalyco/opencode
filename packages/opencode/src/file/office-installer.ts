import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log, Process } from "../util"

const log = Log.create({ service: "office-installer" })

const STATE_FILE = path.join(Global.Path.state, "office-tooling.json")
const DOWNLOAD_DIR = path.join(Global.Path.cache, "office-installer")

const LIBREOFFICE_VERSION = process.env.OPENCODE_LIBREOFFICE_VERSION ?? "26.2.2"

type Mirror = { name: string; baseUrl: string }

// Ordered list of mirrors. China-friendly mirrors are listed early so the race
// usually picks one of them for users in mainland China; the official source is
// the global fallback.
const MIRRORS: Mirror[] = [
  {
    name: "清华大学",
    baseUrl: "https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable",
  },
  {
    name: "中国科学技术大学",
    baseUrl: "https://mirrors.ustc.edu.cn/tdf/libreoffice/stable",
  },
  {
    name: "北京外国语大学",
    baseUrl: "https://mirrors.bfsu.edu.cn/libreoffice/libreoffice/stable",
  },
  {
    name: "南京大学",
    baseUrl: "https://mirrors.nju.edu.cn/tdf/libreoffice/stable",
  },
  {
    name: "TDF 官方",
    baseUrl: "https://download.documentfoundation.org/libreoffice/stable",
  },
]

function buildPathSuffix(): string | undefined {
  if (process.platform === "win32" && process.arch === "x64") {
    return `${LIBREOFFICE_VERSION}/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`
  }
  // FORK: macOS LibreOffice DMG download 2026-04-29
  if (process.platform === "darwin" && (process.arch === "arm64" || process.arch === "x64")) {
    const dir = process.arch === "arm64" ? "aarch64" : "x86_64"
    const suffix = process.arch === "arm64" ? "aarch64" : "x86-64"
    return `${LIBREOFFICE_VERSION}/mac/${dir}/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_${suffix}.dmg`
  }
  return undefined
}

function urlForMirror(m: Mirror): string | undefined {
  const suffix = buildPathSuffix()
  if (!suffix) return undefined
  return `${m.baseUrl}/${suffix}`
}

export type InstallPhase = "idle" | "probing" | "downloading" | "installing" | "done" | "error"

export type InstallProgress = {
  phase: InstallPhase
  bytesDownloaded?: number
  bytesTotal?: number
  percent?: number
  speedBps?: number
  message?: string
  mirrorName?: string
}

export type ToolingStatus = {
  installed: boolean
  sofficePath?: string
  platformSupported: boolean
  downloadSizeMB?: number
  selectedMirror?: { name: string; url: string }
  progress: InstallProgress
}

let progress: InstallProgress = { phase: "idle" }
let detectCache: { path: string; checked: number } | undefined

function isPlatformSupported(): boolean {
  return buildPathSuffix() !== undefined
}

async function readState(): Promise<{ sofficePath?: string }> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8"))
  } catch {
    return {}
  }
}

async function writeState(s: { sofficePath?: string }) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2))
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function whichSoffice(): Promise<string | undefined> {
  const cmd = process.platform === "win32" ? "where" : "which"
  const arg = process.platform === "win32" ? "soffice.exe" : "soffice"
  try {
    const r = await Process.run([cmd, arg], { nothrow: true, timeout: 5_000 })
    if (r.code !== 0) return undefined
    const first = r.stdout.toString().trim().split(/\r?\n/)[0]?.trim()
    return first || undefined
  } catch {
    return undefined
  }
}

function commonInstallPaths(): string[] {
  if (process.platform === "win32") {
    return [
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "LibreOffice", "program", "soffice.exe"),
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ].filter(Boolean)
  }
  // FORK: macOS soffice detection paths 2026-04-29
  if (process.platform === "darwin") {
    const home = process.env.HOME ?? ""
    return [
      path.join(home, "Applications/LibreOffice.app/Contents/MacOS/soffice"),
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
  }
  return []
}

export async function detectSofficePath(force = false): Promise<string | undefined> {
  if (!force && detectCache && Date.now() - detectCache.checked < 5_000) {
    if (await exists(detectCache.path)) return detectCache.path
  }

  const env = process.env.OPENCODE_SOFFICE
  if (env && (await exists(env))) {
    detectCache = { path: env, checked: Date.now() }
    return env
  }

  const st = await readState()
  if (st.sofficePath && (await exists(st.sofficePath))) {
    detectCache = { path: st.sofficePath, checked: Date.now() }
    return st.sofficePath
  }

  const onPath = await whichSoffice()
  if (onPath && (await exists(onPath))) {
    detectCache = { path: onPath, checked: Date.now() }
    await writeState({ sofficePath: onPath })
    return onPath
  }

  for (const c of commonInstallPaths()) {
    if (await exists(c)) {
      detectCache = { path: c, checked: Date.now() }
      await writeState({ sofficePath: c })
      return c
    }
  }

  return undefined
}

export async function status(): Promise<ToolingStatus> {
  const sofficePath = await detectSofficePath()
  return {
    installed: !!sofficePath,
    sofficePath,
    platformSupported: isPlatformSupported(),
    downloadSizeMB: process.platform === "darwin" ? 281 : 355, // FORK: macOS DMG smaller 2026-04-29
    progress,
  }
}

export function getProgress(): InstallProgress {
  return progress
}

// Race all mirrors with HEAD; return the first one that responds OK with a
// reasonable response time. Falls back to the first mirror if all probes fail.
async function pickFastestMirror(): Promise<{ mirror: Mirror; url: string }> {
  const candidates: { mirror: Mirror; url: string }[] = []
  for (const m of MIRRORS) {
    const url = urlForMirror(m)
    if (url) candidates.push({ mirror: m, url })
  }
  if (candidates.length === 0) throw new Error("no mirror available for current platform")

  const PROBE_TIMEOUT_MS = 6_000

  const probe = async ({ mirror, url }: { mirror: Mirror; url: string }) => {
    const start = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": "OpenCode-Installer/1.0" },
      })
      if (!res.ok) throw new Error(`HEAD ${res.status}`)
      const elapsed = Date.now() - start
      return { mirror, url, elapsed }
    } finally {
      clearTimeout(timer)
    }
  }

  // Use Promise.any to race; first OK wins. If all reject, fall back to first
  // candidate (TDF official) and let the actual download attempt surface a
  // useful error.
  try {
    const winner = await Promise.any(candidates.map((c) => probe(c)))
    log.info("mirror selected", { mirror: winner.mirror.name, elapsed: winner.elapsed })
    return { mirror: winner.mirror, url: winner.url }
  } catch {
    log.warn("all mirror probes failed, falling back to first candidate", {
      first: candidates[0].mirror.name,
    })
    return candidates[0]
  }
}

export async function startInstall(): Promise<InstallProgress> {
  if (progress.phase === "downloading" || progress.phase === "installing" || progress.phase === "probing") {
    return progress
  }

  if (!isPlatformSupported()) {
    progress = {
      phase: "error",
      message: `当前平台 ${process.platform}-${process.arch} 暂不支持自动安装`,
    }
    return progress
  }

  const existing = await detectSofficePath(true)
  if (existing) {
    progress = { phase: "done", message: "已检测到 LibreOffice 安装" }
    return progress
  }

  progress = { phase: "probing", message: "正在选择最快下载源…" }

  void (async () => {
    try {
      const { mirror, url } = await pickFastestMirror()

      progress = {
        phase: "downloading",
        bytesDownloaded: 0,
        percent: 0,
        mirrorName: mirror.name,
      }

      await fs.mkdir(DOWNLOAD_DIR, { recursive: true })
      const msiPath = path.join(DOWNLOAD_DIR, path.basename(new URL(url).pathname))

      const existingSize = await fs
        .stat(msiPath)
        .then((s) => s.size)
        .catch(() => 0)

      // Reuse a previously downloaded MSI if it looks complete (size > 100MB
      // since the real installer is ~355MB; partial downloads are smaller).
      const reuse = existingSize > 100 * 1024 * 1024
      if (reuse) {
        log.info("reusing previously downloaded MSI", { msiPath, size: existingSize })
        progress = {
          phase: "downloading",
          bytesDownloaded: existingSize,
          bytesTotal: existingSize,
          percent: 100,
          mirrorName: mirror.name,
          message: "已使用本地缓存的安装包",
        }
      } else {
        log.info("downloading LibreOffice", { url, msiPath, mirror: mirror.name })
        await downloadWithProgress(url, msiPath, mirror.name, (p) => {
          progress = p
        })
      }

      // FORK-BEGIN: platform-specific install (Windows msiexec / macOS DMG) 2026-04-29
      if (process.platform === "win32") {
        const logPath = path.join(DOWNLOAD_DIR, "msiexec.log")
        await fs.unlink(logPath).catch(() => undefined)

        progress = {
          phase: "installing",
          message: "正在静默安装到本用户目录…",
        }

        log.info("running msiexec install (per-user, silent)", { msiPath })
        const result = await Process.run(
          [
            "msiexec",
            "/i",
            msiPath,
            "/qn",
            "ALLUSERS=2",
            "MSIINSTALLPERUSER=1",
            "REGISTER_ALL_MSO_TYPES=0",
            "REBOOT=ReallySuppress",
            "/norestart",
            "/l*v",
            logPath,
          ],
          { nothrow: true, timeout: 600_000 },
        )

        if (result.code !== 0) {
          const tail = await readLogTail(logPath, 100).catch(() => "")
          const isPendingReboot = /MsiSystemRebootPending\D+'1'|RebootPending|Note: 1: 1708/.test(tail)
          const summary = isPendingReboot
            ? "Windows 检测到挂起的重启操作（MsiSystemRebootPending=1）。请先重启 Windows，然后重新点击下载预览插件即可（已下载的 MSI 会被复用）"
            : extractMsiError(tail) ?? `msiexec 退出码 ${result.code}`
          progress = {
            phase: "error",
            message: summary + ` （日志: ${logPath}）`,
          }
          log.error("msiexec failed", {
            code: result.code,
            isPendingReboot,
            tail: tail.slice(0, 2000),
          })
          return
        }
      } else if (process.platform === "darwin") {
        progress = { phase: "installing", message: "正在安装到 ~/Applications …" }
        log.info("mounting DMG", { msiPath })

        const mountResult = await Process.run(
          ["hdiutil", "attach", msiPath, "-nobrowse", "-noautoopen"],
          { nothrow: true, timeout: 60_000 },
        )
        if (mountResult.code !== 0) {
          progress = {
            phase: "error",
            message: `挂载 DMG 失败: ${mountResult.stderr.toString().trim().slice(0, 200)}`,
          }
          return
        }

        const mountOutput = mountResult.stdout.toString().trim()
        const mountPoint = mountOutput.split(/\r?\n/).pop()?.split(/\t/).pop()?.trim()
        if (!mountPoint) {
          progress = { phase: "error", message: "无法解析 DMG 挂载点" }
          return
        }

        try {
          const entries = await fs.readdir(mountPoint)
          const appName = entries.find((e) => e.endsWith(".app") && /libre/i.test(e))
          if (!appName) {
            throw new Error(`DMG 中未找到 LibreOffice.app: ${entries.join(", ")}`)
          }

          const srcApp = path.join(mountPoint, appName)
          const destDir = path.join(process.env.HOME ?? "", "Applications")
          const destApp = path.join(destDir, appName)

          await fs.mkdir(destDir, { recursive: true })
          await fs.rm(destApp, { recursive: true, force: true }).catch(() => {})

          log.info("copying LibreOffice.app", { src: srcApp, dest: destApp })
          const cpResult = await Process.run(["cp", "-R", srcApp, destApp], {
            nothrow: true,
            timeout: 120_000,
          })
          if (cpResult.code !== 0) {
            throw new Error(`复制失败: ${cpResult.stderr.toString().trim().slice(0, 200)}`)
          }
        } finally {
          await Process.run(["hdiutil", "detach", mountPoint, "-force"], {
            nothrow: true,
            timeout: 30_000,
          })
        }
      }
      // FORK-END

      const sofficePath = await detectSofficePath(true)
      if (!sofficePath) {
        progress = { phase: "error", message: "安装完成但找不到 soffice" }
        return
      }

      await writeState({ sofficePath })
      await fs.unlink(msiPath).catch(() => undefined)

      progress = { phase: "done", message: "LibreOffice 安装完成" }
      log.info("install succeeded", { sofficePath })
    } catch (e: any) {
      progress = { phase: "error", message: String(e?.message ?? e) }
      log.error("install error", { err: String(e) })
    }
  })()

  return progress
}

// MSI logs are written as UTF-16 LE on Windows. Read as buffer then decode.
async function readLogTail(logPath: string, lines: number): Promise<string> {
  try {
    const buf = await fs.readFile(logPath)
    let text: string
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      // UTF-16 LE BOM
      text = new TextDecoder("utf-16le").decode(buf.subarray(2))
    } else {
      text = buf.toString("utf8")
    }
    const all = text.split(/\r?\n/)
    return all.slice(-lines).join("\n")
  } catch {
    return ""
  }
}

// Pull the most informative error line from a verbose MSI log.
function extractMsiError(logTail: string): string | undefined {
  const errorLines = logTail
    .split(/\r?\n/)
    .filter((l) => /Error|error \d|Return value 3|fatal|Failed|Cannot/i.test(l))
    .slice(-5)
  if (errorLines.length === 0) return
  return errorLines.join(" | ").slice(0, 300)
}

async function downloadWithProgress(
  url: string,
  destPath: string,
  mirrorName: string,
  onProgress: (p: InstallProgress) => void,
  redirectsLeft = 5,
): Promise<void> {
  if (redirectsLeft <= 0) throw new Error("too many redirects")

  const res = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "OpenCode-Installer/1.0" },
  })

  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get("location")
    if (!next) throw new Error(`redirect without Location (status ${res.status})`)
    const absolute = next.startsWith("http") ? next : new URL(next, url).toString()
    return downloadWithProgress(absolute, destPath, mirrorName, onProgress, redirectsLeft - 1)
  }

  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  if (!res.body) throw new Error("response body is null")

  const total = parseInt(res.headers.get("content-length") ?? "0", 10)
  const tmpPath = destPath + ".part"
  const file = Bun.file(tmpPath).writer()

  let done = 0
  const start = Date.now()
  let lastSpeedSample = start
  let lastSpeedBytes = 0
  let speedBps: number | undefined

  const reader = res.body.getReader()
  while (true) {
    const { value, done: streamDone } = await reader.read()
    if (streamDone) break
    if (value) {
      file.write(value)
      done += value.byteLength
      const now = Date.now()
      if (now - lastSpeedSample >= 600) {
        const dt = (now - lastSpeedSample) / 1000
        const dBytes = done - lastSpeedBytes
        speedBps = dt > 0 ? Math.round(dBytes / dt) : undefined
        lastSpeedSample = now
        lastSpeedBytes = done
      }
      onProgress({
        phase: "downloading",
        bytesDownloaded: done,
        bytesTotal: total,
        percent: total > 0 ? Math.round((done / total) * 100) : undefined,
        speedBps,
        mirrorName,
      })
    }
  }
  await file.flush()
  await file.end()
  await fs.rename(tmpPath, destPath)
}
