/**
 * Pure helpers for the desktop telemetry/update integration.
 *
 * Kept in a separate file (no electron / no node fs imports) so they can be
 * imported directly by `bun test` without spinning up the Electron runtime.
 *
 * The strategy decision is the load-bearing one: it answers "how should
 * this build of the desktop app keep itself up to date?".
 */

export type UpdateStrategy = "linux-auto" | "manual" | "store-skip"

/**
 * Pick the update strategy for the running build.
 *
 * - Windows MSIX/AppX (MS Store) -> "store-skip" (store handles updates)
 * - Linux                         -> "linux-auto" (electron-updater + generic feed)
 * - macOS, non-store Windows, etc -> "manual"     (poll latest.json + native prompt)
 *
 * `isStore` should reflect Electron's `process.windowsStore` flag, which is
 * `true` only when running from an MSIX/AppX package on Windows.
 */
export function pickUpdateStrategy(platform: NodeJS.Platform, isStore: boolean): UpdateStrategy {
  if (platform === "win32" && isStore) return "store-skip"
  if (platform === "linux") return "linux-auto"
  return "manual"
}

/**
 * The whitelist of event names this client is allowed to forward to the
 * telemetry backend. Defense-in-depth privacy guard: anything not in here
 * is silently dropped, even if the renderer is compromised or future code
 * accidentally tries to send PII-laden events.
 */
export const ALLOWED_EVENTS: ReadonlySet<string> = new Set<string>([
  "desktop.app_open",
  "desktop.project_open",
  "desktop.ai_request",
  "desktop.update_downloaded",
  "desktop.update_applied",
  // Optional 6th event per workflow doc §C3.6 — not required, but allowed.
  "desktop.update_seen",
])

export function isAllowedEvent(name: string): boolean {
  return ALLOWED_EVENTS.has(name)
}
