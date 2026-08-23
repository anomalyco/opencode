export const STARTUP_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export type StartupStage = "boot" | "syncing" | "completing" | "finishing"

export const STARTUP_STAGE_MESSAGES: Record<StartupStage, string> = {
  boot: "Booting OpenCode...",
  syncing: "Loading workspace and sessions...",
  completing: "Loading plugins...",
  finishing: "Finishing startup...",
}

export const STARTUP_MESSAGES = [
  "Booting OpenCode...",
  "Initializing terminal...",
  "Spawning TUI worker...",
  "Loading configuration...",
  "Resolving theme...",
  "Preparing workspace...",
  "Loading plugins...",
  "Almost ready...",
]

export const STARTUP_FRAME_INTERVAL_MS = 80
export const STARTUP_MESSAGE_INTERVAL_MS = 1000

export const STARTUP_PROGRESS_BAR_WIDTH = 30
export const STARTUP_EXPECTED_DURATION_MS = 8000

export function buildProgressBar(elapsedMs: number, phase: number = 0): { bar: string; pct: string } {
  const progress = Math.min(1, elapsedMs / STARTUP_EXPECTED_DURATION_MS)
  const filled = Math.round(progress * STARTUP_PROGRESS_BAR_WIDTH)

  if (progress >= 1) {
    const segWidth = 6
    const span = STARTUP_PROGRESS_BAR_WIDTH + segWidth
    const pos = phase % span
    const segStart = Math.max(0, pos - segWidth)
    const segEnd = Math.min(STARTUP_PROGRESS_BAR_WIDTH, pos)
    const before = "█".repeat(segStart)
    const seg = "▓".repeat(segEnd - segStart)
    const after = "█".repeat(STARTUP_PROGRESS_BAR_WIDTH - segEnd)
    return { bar: before + seg + after, pct: "..." }
  }

  const bar = "█".repeat(filled) + "░".repeat(STARTUP_PROGRESS_BAR_WIDTH - filled)
  const pct = `${Math.round(progress * 100)}%`
  return { bar, pct }
}

declare global {
  var __opencodeStartupStartTime: number | undefined
}
