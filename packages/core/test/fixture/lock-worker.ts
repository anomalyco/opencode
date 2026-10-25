import { spawn } from "child_process"
import path from "path"

const root = path.join(import.meta.dir, "../..")

export function runLockWorker(entrypoint: string, payload: unknown) {
  return new Promise<{ code: number; stdout: Buffer; stderr: Buffer }>((resolve) => {
    const proc = spawn(process.execPath, [entrypoint, JSON.stringify(payload)], { cwd: root })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    proc.stdout?.on("data", (data) => stdout.push(Buffer.from(data)))
    proc.stderr?.on("data", (data) => stderr.push(Buffer.from(data)))
    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
  })
}

export function spawnLockWorker(entrypoint: string, payload: unknown) {
  return spawn(process.execPath, [entrypoint, JSON.stringify(payload)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

export async function stopLockWorker(proc: ReturnType<typeof spawnLockWorker>) {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  const closed = new Promise<void>((resolve) => proc.once("close", () => resolve()))
  if (process.platform !== "win32" || !proc.pid) {
    proc.kill()
    await closed
    return
  }

  await new Promise<void>((resolve) => {
    const killProc = spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"])
    killProc.on("close", () => {
      proc.kill()
      resolve()
    })
  })
  await closed
}

export async function waitForFile(file: string, timeout = 3_000) {
  const stop = Date.now() + timeout
  while (Date.now() < stop) {
    if (await Bun.file(file).exists()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for file: ${file}`)
}
