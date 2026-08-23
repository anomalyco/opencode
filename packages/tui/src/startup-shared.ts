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
