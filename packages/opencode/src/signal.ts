import { Instance } from "./project/instance"
import { Log } from "./util/log"

const SHUTDOWN_TIMEOUT_MS = 5000

const SIGNAL_EXIT_CODES: Record<string, number> = {
  SIGTERM: 128 + 15,
  SIGINT: 128 + 2,
  SIGHUP: 128 + 1,
}

let shuttingDown = false

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  const log = Log.create({ service: "signal" })
  log.info("received signal, shutting down gracefully", { signal })

  const timeout = setTimeout(() => {
    log.warn("shutdown timeout, forcing exit", {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
      signal,
    })
    process.exit(SIGNAL_EXIT_CODES[signal] ?? 1)
  }, SHUTDOWN_TIMEOUT_MS)

  try {
    await Instance.disposeAll()
  } catch (error) {
    log.error("error during shutdown", { error })
  } finally {
    clearTimeout(timeout)
    process.exit(SIGNAL_EXIT_CODES[signal] ?? 0)
  }
}

export function registerSignalHandlers() {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => {
      void gracefulShutdown(signal)
    })
  }
}
