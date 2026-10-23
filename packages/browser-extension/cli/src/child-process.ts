import type { ChildProcess } from "node:child_process"

export async function terminateChildProcess(options: {
  readonly child: ChildProcess
  readonly exit: Promise<unknown>
  readonly graceMs: number
  readonly isExited?: () => boolean
}): Promise<void> {
  const isExited = options.isExited ?? (() => options.child.exitCode !== null || options.child.signalCode !== null)
  if (isExited()) return
  signalChildProcess(options.child, "SIGTERM")
  let timeout: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    options.exit,
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, options.graceMs)
    }),
  ])
  if (timeout) clearTimeout(timeout)
  if (isExited()) return
  signalChildProcess(options.child, "SIGKILL")
  await options.exit
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // The child may have exited between the state check and the signal.
    }
  }
  child.kill(signal)
}
