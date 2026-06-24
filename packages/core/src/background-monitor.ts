export * as BackgroundMonitor from "./background-monitor"

// Process-local liveness tracking for the Monitor tool. The monitored process
// itself runs as a BackgroundJob entry; this module only tracks "is a monitor
// still running for this session" + its child PID, as PLAIN functions (no Effect
// service) so the non-Effect CLI loop in cli/cmd/run.ts can read the count / kill
// the PIDs SYNCHRONOUSLY — to defer process exit while a monitor is live and to
// clean up on SIGINT.

const _sessionCounts = new Map<string, number>()
const _sessionPids = new Map<string, Array<number>>()

/** Number of live monitor jobs for a session. */
export function getMonitorCount(sessionID: string): number {
  return _sessionCounts.get(sessionID) ?? 0
}

/** Bump the live count for a session (call when a job is armed). */
export function monitorStarted(sessionID: string): void {
  _sessionCounts.set(sessionID, (_sessionCounts.get(sessionID) ?? 0) + 1)
}

/** Drop the live count (and forget the PID) when a job ends. */
export function monitorStopped(sessionID: string, pid?: number): void {
  const next = (_sessionCounts.get(sessionID) ?? 0) - 1
  if (next <= 0) _sessionCounts.delete(sessionID)
  else _sessionCounts.set(sessionID, next)
  if (pid !== undefined) removePid(sessionID, pid)
}

/** Track a child PID so SIGINT can kill it synchronously. */
export function monitorPid(sessionID: string, pid: number): void {
  const list = _sessionPids.get(sessionID) ?? []
  list.push(pid)
  _sessionPids.set(sessionID, list)
}

function removePid(sessionID: string, pid: number): void {
  const list = _sessionPids.get(sessionID)
  if (!list) return
  const filtered = list.filter((p) => p !== pid)
  if (filtered.length === 0) _sessionPids.delete(sessionID)
  else _sessionPids.set(sessionID, filtered)
}

/** SIGTERM every tracked PID for a session (CLI SIGINT / shutdown path). */
export function stopAllForSessionSync(sessionID: string): void {
  const pids = _sessionPids.get(sessionID)
  if (!pids) return
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // already-exited or permission errors are fine
    }
  }
  _sessionPids.delete(sessionID)
}
