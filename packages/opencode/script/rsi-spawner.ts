import path from "path"
import fs from "fs"

const RSI_TEMP_DIR = path.join("src", "evolution-rsi", ".rsi-cache")
const DEFAULT_TIMEOUT_MS = 30_000

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  signal: string | null
}

export async function spawnIsolated(code: string, args: string[] = []): Promise<SpawnResult> {
  fs.mkdirSync(RSI_TEMP_DIR, { recursive: true })

  const pid = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8)
  const tempFile = path.join(RSI_TEMP_DIR, `rsi-run-${pid}.ts`)
  fs.writeFileSync(tempFile, code, "utf8")

  const bunPath = process.execPath
  const proc = Bun.spawn([bunPath, "run", tempFile, ...args], {
    cwd: RSI_TEMP_DIR,
    env: { NODE_ENV: "isolated" },
    stdio: ["pipe", "pipe", "pipe"],
  })

  const timeout = Bun.sleep(DEFAULT_TIMEOUT_MS).then(() => {
    proc.kill("SIGKILL")
    return true
  })

  const [exitCode, signal] = await Promise.race([
    proc.exited.then(c => [c, null] as const),
    timeout.then(() => [null, "SIGKILL"] as const),
  ])

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  try {
    fs.rmSync(tempFile, { force: true })
  } catch {}

  return {
    stdout,
    stderr,
    exitCode,
    timedOut: signal === "SIGKILL",
    signal,
  }
}
