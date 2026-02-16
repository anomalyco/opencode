import { spawn } from "bun"

export namespace Chime {
  let enabled: boolean | undefined = undefined
  let soundPath = "/System/Library/Sounds/Glass.aiff"

  export function setEnabled(value: boolean) {
    enabled = value
  }

  export async function isEnabled() {
    // If explicitly set, use that value
    if (enabled !== undefined) return enabled

    // Otherwise, try to check config (may fail if no context)
    try {
      const { Config } = await import("@/config/config")
      const config = await Config.get()

      // Default to true if not specified in config
      return config.chime?.enabled ?? true
    } catch {
      // If config can't be loaded (no context), default to enabled
      return true
    }
  }

  export function setSoundPath(path: string) {
    soundPath = path
  }

  export function getSoundPath() {
    return soundPath
  }

  export async function play() {
    if (!(await isEnabled())) return

    // Only play on macOS where afplay is available
    if (process.platform !== "darwin") return

    // Try to load config to get custom sound path if specified
    let sound = soundPath
    try {
      const { Config } = await import("@/config/config")
      const config = await Config.get()
      sound = config.chime?.sound ?? soundPath
    } catch {
      // Use default sound if config can't be loaded
    }

    try {
      // Play asynchronously without blocking
      spawn(["afplay", sound], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      })
    } catch {
      // Silently fail if sound can't be played
    }
  }
}
