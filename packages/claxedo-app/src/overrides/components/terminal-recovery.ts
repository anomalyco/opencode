const executed = new Set<string>()

export const initialCommandKey = (ptyId: string) => `opencode.pty.${ptyId}.initial-command-ran`

const debugLevel = () => {
  if (typeof localStorage === "undefined") return 0
  const raw = localStorage.getItem("opencode.debug.terminal")
  if (!raw) return 0
  if (raw === "true") return 1
  if (raw === "false") return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  return n
}

const tlog = (...args: unknown[]) => {
  if (debugLevel() < 1) return
  // eslint-disable-next-line no-console
  console.log("[terminal:recovery]", ...args)
}

export function shouldRunInitialCommand(pty: { id: string; initialCommand?: string }) {
  if (!pty.initialCommand) {
    tlog("shouldRunInitialCommand", { ptyId: pty.id, result: false, reason: "missing-command" })
    return false
  }
  const inMemory = executed.has(pty.id)
  const persisted = typeof localStorage !== "undefined" && !!localStorage.getItem(initialCommandKey(pty.id))
  const result = !inMemory && !persisted
  tlog("shouldRunInitialCommand", {
    ptyId: pty.id,
    result,
    inMemory,
    persisted,
    len: pty.initialCommand.length,
  })
  return result
}

export function markInitialCommandRan(ptyId: string) {
  executed.add(ptyId)
  if (typeof localStorage !== "undefined") localStorage.setItem(initialCommandKey(ptyId), "1")
  tlog("markInitialCommandRan", { ptyId })
}

export function clearInitialCommandMarker(ptyId: string) {
  executed.delete(ptyId)
  if (typeof localStorage !== "undefined") localStorage.removeItem(initialCommandKey(ptyId))
  tlog("clearInitialCommandMarker", { ptyId })
}
