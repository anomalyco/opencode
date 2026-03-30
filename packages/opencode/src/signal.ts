import { Instance } from "./project/instance"
import { Log } from "./util/log"

const timeout = 5000
const code = {
  SIGHUP: 129,
  SIGPIPE: 141,
  SIGTERM: 143,
} as const

let exiting = false

async function shutdown(sig: keyof typeof code) {
  if (exiting) return
  exiting = true
  const log = Log.create({ service: "signal" })
  log.info("shutdown", { sig })
  const timer = setTimeout(() => {
    log.warn("shutdown timeout", { sig, timeout })
    process.exit(code[sig])
  }, timeout)
  timer.unref()

  try {
    await Instance.disposeAll()
  } catch (err) {
    log.error("shutdown failed", { err })
  } finally {
    clearTimeout(timer)
    process.exit(code[sig])
  }
}

export function registerSignals() {
  for (const sig of Object.keys(code) as (keyof typeof code)[]) {
    process.on(sig, () => {
      void shutdown(sig)
    })
  }
}
