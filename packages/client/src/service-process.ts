import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"

// Shared by the Effect and Promise clients. Keep this module free of Effect so the
// Promise client never loads the Effect runtime.

export function parseLinuxProcState(stat: string) {
  const close = stat.lastIndexOf(")")
  if (close < 0) return undefined
  return stat.slice(close + 1).trimStart()[0]
}

export function parsePsState(output: string) {
  return output.trim()[0]
}

export function isZombieState(state: string | undefined) {
  return state === "Z"
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function psState(pid: number) {
  return new Promise<string | undefined>((resolve) => {
    execFile("ps", ["-o", "state=", "-p", String(pid)], (error, stdout) => {
      if (error) {
        resolve(undefined)
        return
      }
      resolve(parsePsState(stdout))
    })
  })
}

/**
 * Whether `pid` has exited, including POSIX `<defunct>` zombies whose parent has not
 * reaped them yet (which still answer `kill(pid, 0)` until waited on).
 */
export async function processStopped(pid: number, platform = process.platform): Promise<boolean> {
  if (!alive(pid)) return true
  if (platform === "win32") return false
  if (platform === "linux") {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch((error: unknown) =>
      error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH")
        ? null
        : undefined,
    )
    if (stat === null) return true
    if (stat !== undefined) return isZombieState(parseLinuxProcState(stat))
  }
  const state = await psState(pid)
  if (state === undefined) return !alive(pid)
  return isZombieState(state)
}
