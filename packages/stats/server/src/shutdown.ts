let shuttingDown = false
let signalHandlersRegistered = false

export function isShuttingDown() {
  return shuttingDown
}

export function registerShutdownSignalHandlers() {
  if (signalHandlersRegistered) return
  signalHandlersRegistered = true
  process.once("SIGTERM", markShuttingDown)
  process.once("SIGINT", markShuttingDown)
}

function markShuttingDown() {
  shuttingDown = true
}
