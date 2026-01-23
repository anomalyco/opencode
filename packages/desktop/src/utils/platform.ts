import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"

/**
 * Detect if running in Tauri context vs browser.
 * Tauri sets window.__TAURI__ globally before any app code runs.
 */
export const isTauri = "__TAURI__" in window

/**
 * Supported operating system types
 */
export type OSType = "macos" | "windows" | "linux"

/**
 * Get OS type safely.
 * Returns undefined when running in browser or on unsupported OS.
 */
export function getOSType(): OSType | undefined {
  if (!isTauri) return undefined

  const type = ostype()
  if (type === "macos" || type === "windows" || type === "linux") {
    return type
  }
  return undefined
}

/**
 * Safely invoke Tauri commands.
 * Returns null when running in browser context.
 */
export function safeInvoke<T>(command: string, args?: InvokeArgs): Promise<T | null> {
  if (!isTauri) return Promise.resolve(null)
  return tauriInvoke<T>(command, args).catch(() => null)
}
