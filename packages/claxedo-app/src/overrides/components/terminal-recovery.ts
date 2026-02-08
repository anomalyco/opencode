import type { LocalPTY } from "@/context/terminal"

const executed = new Set<string>()

export const initialCommandKey = (ptyId: string) => `opencode.pty.${ptyId}.initial-command-ran`

export function shouldRunInitialCommand(pty: Pick<LocalPTY, "id" | "initialCommand">) {
  if (!pty.initialCommand) return false
  if (executed.has(pty.id)) return false
  if (typeof localStorage !== "undefined" && localStorage.getItem(initialCommandKey(pty.id))) return false
  return true
}

export function markInitialCommandRan(ptyId: string) {
  executed.add(ptyId)
  if (typeof localStorage !== "undefined") localStorage.setItem(initialCommandKey(ptyId), "1")
}

export function clearInitialCommandMarker(ptyId: string) {
  executed.delete(ptyId)
  if (typeof localStorage !== "undefined") localStorage.removeItem(initialCommandKey(ptyId))
}
