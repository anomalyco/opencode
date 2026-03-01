import * as vscode from "vscode"
import { chromium } from "playwright"
import * as path from "path"
import * as fs from "fs"

/**
 * ScreenshotHelper provides utilities for capturing screenshots
 * during VS Code extension integration tests.
 */
export class ScreenshotHelper {
  private sequence: Map<string, number>
  private baseDir: string

  constructor() {
    this.sequence = new Map()
    this.baseDir = path.join(__dirname, "..", "..", "..", "screenshots")
    this.ensureDirectories()
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
   * Capture a screenshot of the VS Code window.
   *
   * @param feature - The feature category ("extension", "chat", "failures")
   * @param scenario - A descriptive name for the scenario
   * @param fullPage - Whether to capture the full page or just viewport (default: true)
   * @returns The path to the saved screenshot
   */
  async capture(feature: "extension" | "chat" | "failures", scenario: string, fullPage = true): Promise<string> {
    const sequence = this.nextSequence(feature)
    const sanitized = scenario.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    const filename = `${sequence}-${sanitized}.png`
    const dirNum = feature === "extension" ? "1" : feature === "chat" ? "2" : "3"
    const featureDir = `0${dirNum}-${feature}`
    const filepath = path.join(this.baseDir, featureDir, filename)

    const browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage()

    await page.screenshot({ path: filepath, fullPage })

    await context.close()
    await browser.close()

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

    const browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage()

    await page.screenshot({ path: filepath, fullPage: true })

    await context.close()
    await browser.close()

    return filepath
  }
}

/**
 * Singleton screenshot helper instance.
 */
export const screenshot = new ScreenshotHelper()
