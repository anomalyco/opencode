import { type ChildProcess, spawnSync } from "node:child_process"

// Duplicated from `packages/opencode/src/util/process.ts` because the SDK cannot
// import `opencode` without creating a cycle (`opencode` depends on `@opencode-ai/sdk`).
const STOP_ESCALATE_MS = 2_000
const STOP_FINAL_WAIT_MS = 5_000

// Concurrent stop() calls must share one teardown: without this each caller attaches its
// own exit listener and escalation timer and sends its own SIGTERM (v8 NEW-09).
const stopping = new WeakMap<ChildProcess, Promise<void>>()

export async function stop(proc: ChildProcess) {
  const pending = stopping.get(proc)
  if (pending) return pending
  const task = stopProcess(proc)
  stopping.set(proc, task)
  try {
    await task
  } finally {
    if (stopping.get(proc) === task) stopping.delete(proc)
  }
}

async function stopProcess(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  if (process.platform === "win32" && proc.pid) {
    const out = spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true })
    if (!out.error && out.status === 0) return
    proc.kill()
    return
  }

  let finished = false
  let escalate: ReturnType<typeof setTimeout> | undefined
  let resolveExit: (() => void) | undefined
  const onExit = () => {
    finished = true
    if (escalate) clearTimeout(escalate)
    resolveExit?.()
  }
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
    proc.once("exit", onExit)
  })
  try {
    proc.kill("SIGTERM")
  } catch {}
  escalate = setTimeout(() => {
    if (finished || proc.exitCode !== null || proc.signalCode !== null) return
    try {
      proc.kill("SIGKILL")
    } catch {}
  }, STOP_ESCALATE_MS)
  let finalWait: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      finalWait = setTimeout(resolve, STOP_FINAL_WAIT_MS)
    }),
  ])
  if (escalate) clearTimeout(escalate)
  if (finalWait) clearTimeout(finalWait)
  // The 5s final wait wins over a hung child, whose `exit` never fires; drop the listener
  // so repeated stop() calls cannot accumulate them or re-arm a SIGKILL per call.
  proc.removeListener("exit", onExit)
}

export function bindAbort(proc: ChildProcess, signal?: AbortSignal, onAbort?: () => void) {
  if (!signal) return () => {}
  const abort = () => {
    clear()
    void stop(proc)
    onAbort?.()
  }
  const clear = () => {
    signal.removeEventListener("abort", abort)
    proc.off("exit", clear)
    proc.off("error", clear)
  }
  if (proc.exitCode !== null || proc.signalCode !== null) return clear
  signal.addEventListener("abort", abort, { once: true })
  proc.on("exit", clear)
  proc.on("error", clear)
  if (signal.aborted) abort()
  return clear
}
