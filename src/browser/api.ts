/**
 * Athena Browser Agent — Public API
 *
 * This is the main entry point for integrating the browser agent
 * into a Tauri app or any other host application.
 *
 * Usage from Tauri:
 *
 * ```typescript
 * import { AthenaBrowser } from "./browser/api"
 *
 * // Start a browser session
 * await AthenaBrowser.start("session-1", { headed: true })
 *
 * // Execute agent-browser commands (primary)
 * const result = await AthenaBrowser.exec("session-1", ["open", "https://google.com"])
 *
 * // Execute with auto-fallback to Patchright on failure
 * const result2 = await AthenaBrowser.execSafe("session-1", ["click", "@e1"])
 *
 * // Direct Patchright access (stealth fallback)
 * await AthenaBrowser.patchright.click("button.submit")
 *
 * // Stop session
 * await AthenaBrowser.stop("session-1")
 *
 * // Stop everything (process exit)
 * await AthenaBrowser.shutdown()
 * ```
 */

import { BrowserDaemon, type BrowserDaemonOptions } from "./daemon"
import { BrowserClient, type BrowserExecResult } from "./client"
import { BrowserState, type BrowserSessionState } from "./state"
import { PatchrightLauncher } from "./patchright"

export namespace AthenaBrowser {
  // --- Lifecycle ---

  /** Start a browser session. Launches Chrome via Patchright + connects agent-browser. */
  export async function start(sessionId: string, options?: BrowserDaemonOptions): Promise<void> {
    await BrowserDaemon.start(sessionId, options)
    BrowserState.create(sessionId, options?.headed ?? true)
  }

  /** Stop a browser session. */
  export async function stop(sessionId: string): Promise<void> {
    await BrowserDaemon.stop(sessionId)
    BrowserState.remove(sessionId)
  }

  /** Shutdown everything — stop all sessions, close Chrome, kill orphans. */
  export async function shutdown(): Promise<void> {
    await BrowserDaemon.stopAll()
    BrowserDaemon.killAllOrphans()
  }

  /** Check if a session is running. */
  export function isRunning(sessionId: string): boolean {
    return BrowserDaemon.isRunning(sessionId)
  }

  /** Get session state. */
  export function getState(sessionId: string): BrowserSessionState | undefined {
    return BrowserState.get(sessionId)
  }

  // --- Agent-Browser Commands (primary) ---

  /** Execute an agent-browser command. */
  export async function exec(
    sessionId: string,
    command: string[],
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return BrowserClient.exec(sessionId, command, options)
  }

  /** Execute with auto-fallback to Patchright if agent-browser fails. */
  export async function execSafe(
    sessionId: string,
    command: string[],
    options?: { timeout?: number; abort?: AbortSignal },
  ): Promise<BrowserExecResult> {
    return BrowserClient.execWithFallback(sessionId, command, options)
  }

  // --- Convenience Methods ---

  export async function open(sessionId: string, url: string) {
    return BrowserClient.open(sessionId, url)
  }
  export async function click(sessionId: string, ref: string) {
    return BrowserClient.click(sessionId, ref)
  }
  export async function type(sessionId: string, ref: string, text: string) {
    return BrowserClient.type(sessionId, ref, text)
  }
  export async function snapshot(sessionId: string) {
    return BrowserClient.snapshot(sessionId, { interactive: true })
  }
  export async function screenshot(sessionId: string, filepath: string) {
    return BrowserClient.screenshot(sessionId, filepath)
  }

  // --- Patchright Direct Access (stealth fallback) ---

  export const patchright = {
    isRunning: PatchrightLauncher.isRunning,
    getPage: PatchrightLauncher.getPage,
    goto: PatchrightLauncher.goto,
    click: PatchrightLauncher.click,
    fill: PatchrightLauncher.fill,
    screenshot: PatchrightLauncher.screenshot,
    evaluate: PatchrightLauncher.evaluate,
    frame: PatchrightLauncher.frame,
    content: PatchrightLauncher.content,
    url: PatchrightLauncher.url,
    title: PatchrightLauncher.title,
    waitForSelector: PatchrightLauncher.waitForSelector,
    waitForNavigation: PatchrightLauncher.waitForNavigation,
  }
}

// Re-export types for Tauri integration
export type { BrowserDaemonOptions } from "./daemon"
export type { BrowserExecResult } from "./client"
export type { BrowserSessionState } from "./state"
