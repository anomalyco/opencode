import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface MousePosition {
  x: number
  y: number
}

export interface ClickOptions {
  x: number
  y: number
  button?: "left" | "right" | "middle"
  clickCount?: number
}

export interface DragOptions {
  fromX: number
  fromY: number
  toX: number
  toY: number
}

/**
 * Get current mouse position
 */
export async function getMousePosition(): Promise<MousePosition> {
  if (process.platform === "darwin") {
    const script = `
      tell application "System Events"
        return {mouse x, mouse y}
      end tell
    `
    const { stdout } = await execFileAsync("osascript", ["-e", script])
    const [x, y] = stdout.trim().split(",").map(Number)
    return { x, y }
  }

  throw new Error("getMousePosition not implemented for platform: " + process.platform)
}

/**
 * Move mouse to position
 */
export async function moveMouse(x: number, y: number): Promise<void> {
  if (process.platform === "darwin") {
    const script = `
      tell application "System Events"
        key code 126 using {command down, shift down}
      end tell
    `
    // Use cliclick for more reliable mouse control on macOS
    try {
      await execFileAsync("cliclick", ["m:" + x + "," + y])
    } catch {
      // Fallback to AppleScript if cliclick not installed
      const appleScript = `
        tell application "System Events"
          tell application process "Cedric Dev"
            set position of window 1 to {${x}, ${y}}
          end tell
        end tell
      `
      await execFileAsync("osascript", ["-e", appleScript])
    }
    return
  }

  throw new Error("moveMouse not implemented for platform: " + process.platform)
}

/**
 * Click at position
 */
export async function click(options: ClickOptions): Promise<void> {
  const { x, y, button = "left", clickCount = 1 } = options

  if (process.platform === "darwin") {
    try {
      // Try cliclick first (more reliable)
      const buttonFlag = button === "right" ? "r" : button === "middle" ? "m" : "l"
      await execFileAsync("cliclick", [`${buttonFlag}:${x},${y}`])
    } catch {
      // Fallback to AppleScript
      const script = `
        tell application "System Events"
          click at {${x}, ${y}}
        end tell
      `
      await execFileAsync("osascript", ["-e", script])
    }
    return
  }

  throw new Error("click not implemented for platform: " + process.platform)
}

/**
 * Drag from one position to another
 */
export async function drag(options: DragOptions): Promise<void> {
  const { fromX, fromY, toX, toY } = options

  if (process.platform === "darwin") {
    try {
      await execFileAsync("cliclick", [`dd:${fromX},${fromY}`, `du:${toX},${toY}`])
    } catch {
      // Manual drag with AppleScript
      const script = `
        tell application "System Events"
          tell application process "Cedric Dev"
            set startPos to {${fromX}, ${fromY}}
            set endPos to {${toX}, ${toY}}

            -- Move to start and press down
            key code 126 using {command down}
            delay 0.1

            -- Move to end and release
            key code 126 using {command down}
          end tell
        end tell
      `
      await execFileAsync("osascript", ["-e", script])
    }
    return
  }

  throw new Error("drag not implemented for platform: " + process.platform)
}

/**
 * Scroll at position
 */
export async function scroll(x: number, y: number, deltaY: number): Promise<void> {
  if (process.platform === "darwin") {
    try {
      await execFileAsync("cliclick", [`m:${x},${y}`, `w:${deltaY > 0 ? "-" : ""}${Math.abs(deltaY)}`])
    } catch {
      // Fallback: just move mouse there
      await moveMouse(x, y)
    }
    return
  }

  throw new Error("scroll not implemented for platform: " + process.platform)
}
