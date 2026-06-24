import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { findSidecarRoot } from "./paths"

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const

export function voicePort() {
  const raw = process.env.VOXCODE_VOICE_PORT ?? process.env.VOICE_SIDECAR_PORT ?? "8765"
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid voice port: ${raw}`)
  }
  return port
}

function sidecarLogPath() {
  const dir = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode")
  mkdirSync(dir, { recursive: true })
  return join(dir, "voice-sidecar.log")
}

function quietSidecarLogs() {
  return process.env.VOXCODE_SIDECAR_LOGS !== "1"
}

async function sidecarHealthy(port: number) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return false
    const body = (await res.json()) as { stt?: { configured?: boolean } }
    return body.stt?.configured === true
  } catch {
    return false
  }
}

function pythonCommand() {
  return process.env.VOXCODE_PYTHON ?? "python3"
}

async function ensureSidecarInstalled(sidecarRoot: string) {
  const check = Bun.spawnSync({
    cmd: [pythonCommand(), "-c", "import voice_sidecar"],
    cwd: sidecarRoot,
    env: {
      ...process.env,
      PYTHONPATH: join(sidecarRoot, "src"),
    },
    stderr: "pipe",
  })
  if (check.exitCode === 0) return

  const install = Bun.spawnSync({
    cmd: [pythonCommand(), "-m", "pip", "install", "-e", ".", "-q"],
    cwd: sidecarRoot,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (install.exitCode !== 0) {
    throw new Error(
      `failed to install voice sidecar.\nRun manually: cd ${sidecarRoot} && python3 -m pip install -e .`,
    )
  }
}

export async function startSidecar(exeDir: string) {
  const port = voicePort()
  if (await sidecarHealthy(port)) {
    process.stderr.write(
      `voxcode: voice sidecar already running on http://127.0.0.1:${port} (kill it to pick up sidecar updates)\n`,
    )
    return { child: undefined as Subprocess | undefined, port }
  }

  const sidecarRoot = findSidecarRoot(exeDir)
  await ensureSidecarInstalled(sidecarRoot)

  const logPath = sidecarLogPath()
  appendFileSync(logPath, `\n--- voxcode sidecar ${new Date().toISOString()} ---\n`)

  const child = Bun.spawn({
    cmd: [pythonCommand(), "-m", "voice_sidecar", "serve", "--host", "127.0.0.1", "--port", String(port)],
    cwd: sidecarRoot,
    env: {
      ...process.env,
      PYTHONPATH: join(sidecarRoot, "src"),
      PYTHONUNBUFFERED: "1",
      VOICE_SIDECAR_LOG_LEVEL: quietSidecarLogs() ? "warning" : "info",
    },
    stdout: "ignore",
    stderr: quietSidecarLogs() ? "pipe" : "inherit",
  })

  if (quietSidecarLogs() && child.stderr && typeof child.stderr !== "number") {
    const reader = child.stderr.getReader()
    void (async () => {
      const decoder = new TextDecoder()
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        appendFileSync(logPath, decoder.decode(chunk.value))
      }
    })()
  }

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("voice sidecar exited early")
    }
    if (await sidecarHealthy(port)) {
      process.stderr.write(`voxcode: voice sidecar ready on http://127.0.0.1:${port}\n`)
      if (quietSidecarLogs()) {
        process.stderr.write(`voxcode: sidecar logs → ${logPath}\n`)
      }
      return { child, port }
    }
    await Bun.sleep(200)
  }

  child.kill()
  throw new Error("voice sidecar did not become healthy within 30s")
}

export function watchSidecar(child: Subprocess | undefined, onExit: () => void) {
  if (!child) return

  const forwarders = new Map<string, () => void>()
  for (const signal of forwardedSignals) {
    const handler = () => {
      try {
        child.kill()
      } catch {
        // child may already be gone
      }
    }
    forwarders.set(signal, handler)
    process.on(signal, handler)
  }

  void child.exited.then(() => {
    for (const [signal, handler] of forwarders) {
      process.removeListener(signal, handler)
    }
    onExit()
  })
}
