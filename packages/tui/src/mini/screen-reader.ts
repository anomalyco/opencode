import { writeSync } from "node:fs"
import type { StreamCommit } from "./types"

// Set once when the footer starts. A module value avoids threading the flag through every menu.
export const screenReader = {
  enabled: false,
  // Written to the terminal directly: stdout is captured into scrollback while the footer runs.
  bell: () => writeSync(1, "\x07"),
}

export function ringBell() {
  if (screenReader.enabled) screenReader.bell()
}

const LONG_TOOL_MS = 5_000
const running = new Map<string, ReturnType<typeof setTimeout>>()

// Rings once when a tool is still running after a while, since nothing else announces a silent wait.
export function watchTool(commit: StreamCommit, delay = LONG_TOOL_MS) {
  if (!screenReader.enabled || commit.kind !== "tool") return
  const id = commit.part?.id ?? commit.partID
  if (!id) return
  if (commit.phase === "final" || commit.toolState === "completed" || commit.toolState === "error") {
    clearTimeout(running.get(id))
    running.delete(id)
    return
  }
  if (running.has(id)) return
  running.set(
    id,
    setTimeout(() => {
      running.delete(id)
      ringBell()
    }, delay),
  )
}

export function stopWatchingTools() {
  running.forEach(clearTimeout)
  running.clear()
}
