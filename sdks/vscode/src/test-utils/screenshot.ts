import * as path from "path"
import * as fs from "fs"
import { execFile, spawn } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

/**
 * Timeout constants for screenshot operations.
 */
export const PANEL_OPEN_DELAY = 1000
export const TYPING_DELAY = 500
export const UI_STABILIZE_DELAY = 800
export const SCREENSHOT_CAPTURE_DELAY = 500
export const XVFB_START_TIMEOUT = 5000
export const SCREENSHOT_TOOL_TIMEOUT = 10000

/**
 * ScreenshotHelper provides utilities for capturing screenshots
 * during VS Code: extension integration tests.
 *
 * Uses system screenshot tools for reliability in CI environments.
 * Supports: scrot, import (ImageMagick), gnome-screenshot
 *
 * Xvfb handling: Starts Xvfb manually on a free display if DISPLAY is not set,
 * avoiding dependency on xauth.
 */
export class ScreenshotHelper {
  private sequence: Map<string, number>
  private baseDir: string
  private availableTool: string | null = null
  private xvfbProcess: ReturnType<typeof spawn> | null = null
  private xvfbDisplay: string | null = null

  constructor() {
    this.sequence = new Map()
    this.baseDir = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "..", "screenshots")
    this.ensureDirectories()
    this.registerExitHandlers()
  }

  /**
   * Register process exit handlers to ensure Xvfb cleanup on crash.
   */
  private registerExitHandlers(): void {
    const cleanup = () => this.cleanup()
    process.on("exit", cleanup)
    process.on("SIGINT", () => {
      cleanup()
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      cleanup()
      process.exit(0)
    })
    process.on("uncaughtException", (err) => {
      console.error("Uncaught exception:", err)
      cleanup()
      process.exit(1)
    })
  }

  /**
   * Cleanup Xvfb process. Can be called at test suite end.
   */
  cleanup(): void {
    this.stopXvfb()
  }

  /**
   * Find a free display number for Xvfb.
   * Checks displays from :99 upwards to find one that's not in use.
   */
  private async findFreeDisplay(): Promise<number> {
    for (let display = 99; display < 200; display++) {
      try {
        await execFileAsync("xdpyinfo", ["-display", `:${display}`], { timeout: 1000 })
      } catch {
        return display
      }
    }
    throw new Error("No free display found for Xvfb")
  }

  /**
   * Wait for Xvfb to be ready by polling xdpyinfo.
   * Returns the display number once Xvfb is accepting connections.
   */
  private async waitForXvfb(display: number, timeout: number = XVFB_START_TIMEOUT): Promise<void> {
    const start = Date.now()
    const displayStr = `:${display}`

    while (Date.now() - start < timeout) {
      try {
        await execFileAsync("xdpyinfo", ["-display", displayStr], { timeout: 500 })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    throw new Error(`Xvfb failed to start on display ${displayStr} within ${timeout}ms`)
  }

  /**
   * Start Xvfb on a free display if not already running.
   * Returns the DISPLAY value to use.
   */
  private async ensureXvfb(): Promise<string> {
    if (process.env.DISPLAY) return process.env.DISPLAY
    if (this.xvfbProcess && this.xvfbDisplay) return this.xvfbDisplay

    const display = await this.findFreeDisplay()
    const displayStr = `:${display}`

    this.xvfbProcess = spawn("Xvfb", [displayStr, "-screen", "0", "1280x720x24", "-ac"], {
      detached: false,
      stdio: "ignore",
    })

    this.xvfbProcess.on("error", (err) => {
      console.error("Xvfb process error:", err)
    })

    await this.waitForXvfb(display)
    this.xvfbDisplay = displayStr

    return displayStr
  }

  /**
   * Stop the Xvfb process if we started it.
   */
  private stopXvfb(): void {
    if (!this.xvfbProcess) return

    this.xvfbProcess.kill("SIGTERM")
    this.xvfbProcess = null
    this.xvfbDisplay = null
  }

  /**
   * Ensure screenshot directories exist.
   */
  private ensureDirectories(): void {
    const dirs = [
      path.join(this.baseDir, "01-extension"),
      path.join(this.baseDir, "02-chat"),
      path.join(this.baseDir, "03-failures"),
    ]
    for (const dir of dirs.filter((d) => !fs.existsSync(d))) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Get the next sequence number for a given feature.
   */
  private nextSequence(feature: string): string {
    const current = this.sequence.get(feature) || 0
    const next = current + 1
    this.sequence.set(feature, next)
    return next.toString().padStart(2, "0")
  }

  /**
   * Detect available screenshot tool on the system.
   * Prefers tools that work well with Xvfb in CI.
   */
  private async detectTool(): Promise<string | null> {
    if (this.availableTool) return this.availableTool

    const tools = ["scrot", "import", "gnome-screenshot"]

    for (const tool of tools) {
      try {
        await execFileAsync("which", [tool])
        this.availableTool = tool
        return tool
      } catch {
        continue
      }
    }

    return null
  }

  /**
   * Verify that a screenshot file was created successfully.
   * Throws an error if the file doesn't exist or is empty.
   */
  private async verifyScreenshot(filepath: string): Promise<void> {
    const stats = await fs.promises.stat(filepath)
    if (stats.size === 0) {
      throw new Error(`Screenshot file is empty: ${filepath}`)
    }
  }

  /**
   * Capture screenshot using system tool.
   * Automatically starts Xvfb if DISPLAY is not set.
   * Includes delay before capture and verifies the file was created.
   */
  private async captureWithTool(filepath: string, delay: number = SCREENSHOT_CAPTURE_DELAY): Promise<void> {
    const tool = await this.detectTool()

    if (!tool) {
      throw new Error("No screenshot tool available. Install one of: scrot, ImageMagick (import), or gnome-screenshot")
    }

    const args = tool === "scrot" ? [filepath] : tool === "import" ? ["-window", "root", filepath] : ["-f", filepath]

    const display = await this.ensureXvfb()

    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

    try {
      await execFileAsync(tool, args, {
        timeout: SCREENSHOT_TOOL_TIMEOUT,
        env: { ...process.env, DISPLAY: display },
      })

      await this.verifyScreenshot(filepath)
    } finally {
      this.stopXvfb()
    }
  }

  /**
   * Capture a screenshot of the VS Code: window.
   *
   * @param feature - The feature category ("extension", "chat", "failures")
   * @param scenario - A descriptive name for the scenario
   * @param delay - Milliseconds to wait before capturing (default 500ms for UI to render)
   * @returns The path to the saved screenshot
   */
  async capture(
    feature: "extension" | "chat" | "failures",
    scenario: string,
    delay: number = SCREENSHOT_CAPTURE_DELAY,
  ): Promise<string> {
    const sequence = this.nextSequence(feature)
    const sanitized = scenario.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    const filename = `${sequence}-${sanitized}.png`
    const dirNum = feature === "extension" ? "1" : feature === "chat" ? "2" : "3"
    const featureDir = `0${dirNum}-${feature}`
    const filepath = path.join(this.baseDir, featureDir, filename)

    await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
    await this.captureWithTool(filepath, delay)

    return filepath
  }

  /**
   * Capture screenshot on test failure.
   *
   * @param testName - The name of the test that failed
   * @param error - The error that occurred
   * @returns The path to the saved screenshot
   */
  async captureOnFailure(testName: string, error: Error): Promise<string> {
    const sanitized = testName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    const filename = `failure-${sanitized}.png`
    const filepath = path.join(this.baseDir, "03-failures", filename)

    await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
    await this.captureWithTool(filepath)

    return filepath
  }
}

/**
 * Wait for VS Code: UI to stabilize before taking screenshots.
 * Uses multiple strategies: command execution, progress notification, and timeout.
 *
 * @param vscode - The VS Code: API module
 * @param timeout - Maximum time to wait in milliseconds (default 2000ms)
 * @returns Promise that resolves when UI should be stable
 */
export async function waitForStableUI(vscode: typeof import("vscode"), timeout: number = 2000): Promise<void> {
  const startTime = Date.now()

  // Execute a no-op command to flush VS Code:'s command queue
  try {
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
  } catch {
    // Ignore errors from the no-op command
  }

  // Wait for remaining time
  const elapsed = Date.now() - startTime
  const remaining = timeout - elapsed

  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
}

/**
 * Singleton screenshot helper instance.
 */
export const screenshot = new ScreenshotHelper()
