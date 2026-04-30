/**
 * Desktop telemetry & update integration (Phase C3).
 *
 * Wires `@opencode-ai/telemetry` into the Electron main process:
 *   - Init on `app.whenReady`
 *   - First-run native dialog ("Allow" / "Disable telemetry" / "Privacy policy")
 *   - Heartbeat after notice
 *   - Five L4-lite events (desktop.app_open, desktop.project_open,
 *     desktop.ai_request, desktop.update_downloaded, desktop.update_applied)
 *   - Platform-branched update strategy:
 *       linux                   -> electron-updater auto (generic feed)
 *       darwin / non-store win  -> manual checkUpdate() + native dialog
 *       windowsStore (MSIX)     -> skip entirely (store handles updates)
 *   - Flush buffer on app quit (capped at 2s so we never hang the quit)
 *
 * Privacy: events carry NO file paths, project names, prompt content, or model
 * names. The SDK already attaches version / install_id / os / arch.
 *
 * Telemetry init failure must NEVER crash the host. All async work is wrapped
 * in try/catch and the public surface degrades to no-ops.
 */
import { promises as fsp } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { app, dialog, shell } from "electron"
import { init as initTelemetrySdk } from "@opencode-ai/telemetry"
import type { TelemetryClient, UpdateInfo } from "@opencode-ai/telemetry"

import { isAllowedEvent, pickUpdateStrategy } from "./telemetry-strategy"

// Re-export pure helpers so callers (and tests) can find them here too.
export { isAllowedEvent, pickUpdateStrategy }
export type { UpdateStrategy } from "./telemetry-strategy"

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------

const PRIVACY_POLICY_URL = "https://deskfox.ai/privacy"
const DOWNLOAD_FALLBACK_URL = "https://deskfox.ai/download"
const LINUX_UPDATE_FEED_URL = "https://updates.deskfox.ai/v1/latest/desktop"
const FLUSH_TIMEOUT_MS = 2_000
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h

// -------------------------------------------------------------------------
// Singleton
// -------------------------------------------------------------------------

let client: TelemetryClient | null = null
let initialized = false

interface Logger {
  log: (msg: string, meta?: unknown) => void
  error: (msg: string, err?: unknown) => void
}

const noopLogger: Logger = {
  log: () => undefined,
  error: () => undefined,
}

let logger: Logger = noopLogger

/** Get the current singleton telemetry client, or null if init never succeeded. */
export function getTelemetry(): TelemetryClient | null {
  return client
}

/**
 * Track a whitelisted event. Safe to call before init (no-op) and after
 * init failure (no-op). Drops anything not in {@link ALLOWED_EVENTS}.
 */
export function trackEvent(name: string): void {
  if (!isAllowedEvent(name)) {
    logger.log("telemetry: dropped non-allowlisted event", { name })
    return
  }
  try {
    client?.track(name)
  } catch (err) {
    logger.error("telemetry: track threw", err)
  }
}

// -------------------------------------------------------------------------
// First-run notice (native dialog)
// -------------------------------------------------------------------------

const NOTICE_BODY = [
  "OpenCode collects anonymous usage stats (version, OS, country, command",
  "counts) to improve the project. No code, prompts, or identity is sent.",
  "",
  "You can change this any time via OPENCODE_TELEMETRY=0 or by editing",
  "~/.config/opencode/config.json.",
].join("\n")

/**
 * Shows the first-run dialog if the SDK says we still owe a notice.
 * Loops on "Privacy policy" so the user can return.
 *
 * Returns the user's final choice ("allow" | "disable") or "none" if no
 * notice was needed at all.
 */
async function showFirstRunNoticeDialog(): Promise<"allow" | "disable" | "none"> {
  if (!client) return "none"
  // The SDK returns the canned text once-per-install (or null). We don't
  // actually use the returned text — we drive our own dialog — but we DO
  // need this call to flip the "shown" marker on disk.
  const noticeText = await client.firstRunNoticeIfNeeded().catch(() => null)
  if (!noticeText) return "none"

  // Prefer the SDK-provided text body when available; fall back to our own.
  const body = typeof noticeText === "string" && noticeText.trim().length > 0 ? noticeText : NOTICE_BODY

  for (;;) {
    const response = await dialog
      .showMessageBox({
        type: "info",
        title: "Anonymous usage stats",
        message: "Help improve OpenCode?",
        detail: body,
        buttons: ["Allow", "Disable telemetry", "Privacy policy"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .catch((err) => {
        logger.error("telemetry: notice dialog failed", err)
        return null
      })

    if (!response) return "allow" // dialog couldn't open — fail-open to allow

    if (response.response === 0) return "allow"
    if (response.response === 1) {
      await writeTelemetryDisabledToConfig().catch((err) => {
        logger.error("telemetry: failed to write disable to config", err)
      })
      await dialog
        .showMessageBox({
          type: "info",
          title: "Telemetry disabled",
          message: "Telemetry is disabled.",
          detail: "You can re-enable it by setting `telemetry` to true in ~/.config/opencode/config.json.",
          buttons: ["OK"],
        })
        .catch(() => undefined)
      return "disable"
    }
    // 2 = "Privacy policy" — open browser, then re-show the dialog.
    await shell.openExternal(PRIVACY_POLICY_URL).catch(() => undefined)
    // loop
  }
}

/**
 * Persist `{ "telemetry": false }` into the user's opencode config.json.
 * Merges with existing JSON if present.
 */
async function writeTelemetryDisabledToConfig(): Promise<void> {
  const configPath = join(homedir(), ".config", "opencode", "config.json")
  await fsp.mkdir(dirname(configPath), { recursive: true })
  let existing: Record<string, unknown> = {}
  try {
    const raw = await fsp.readFile(configPath, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>
    }
  } catch {
    // Missing or unreadable file — start fresh.
  }
  existing.telemetry = false
  await fsp.writeFile(configPath, JSON.stringify(existing, null, 2) + "\n", "utf8")
}

// -------------------------------------------------------------------------
// Manual update check (macOS / non-store Windows / fallback)
// -------------------------------------------------------------------------

let lastManualCheckShown: string | null = null

async function runManualUpdateCheck(): Promise<void> {
  if (!client) return
  let info: UpdateInfo | null = null
  try {
    info = await client.checkUpdate()
  } catch (err) {
    logger.error("telemetry: manual update check threw", err)
    return
  }
  if (!info || !info.hasUpdate) return
  if (lastManualCheckShown === info.latest) return // don't repeatedly nag for the same version
  lastManualCheckShown = info.latest

  trackEvent("desktop.update_seen")

  const response = await dialog
    .showMessageBox({
      type: "info",
      title: "Update available",
      message: `A new version of OpenCode (${info.latest}) is available.`,
      detail: info.releaseNotesUrl
        ? `Click "Download" to open the release page.\n\n${info.releaseNotesUrl}`
        : `Click "Download" to open the download page.`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .catch((err) => {
      logger.error("telemetry: manual update dialog failed", err)
      return null
    })

  if (response?.response === 0) {
    const url = info.releaseNotesUrl ?? DOWNLOAD_FALLBACK_URL
    await shell.openExternal(url).catch(() => undefined)
  }
}

// -------------------------------------------------------------------------
// electron-updater wiring (Linux only)
// -------------------------------------------------------------------------

/**
 * Minimal duck-typed shape of `electron-updater`'s autoUpdater that we
 * actually use. Loosely-typed `on` signature so the caller can pass the real
 * `AppUpdater` (whose `on` is more strictly typed) without contortions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ElectronUpdaterLike = {
  setFeedURL: (opts: { provider: "generic"; url: string }) => void
  checkForUpdatesAndNotify: () => Promise<unknown>
  // We only listen to "update-downloaded"; widen the type so AppUpdater.on
  // satisfies it structurally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (event: any, handler: any) => any
  quitAndInstall: () => void
}

let linuxIntervalHandle: NodeJS.Timeout | null = null
let manualIntervalHandle: NodeJS.Timeout | null = null

function setupLinuxAutoUpdate(autoUpdater: ElectronUpdaterLike): void {
  try {
    autoUpdater.setFeedURL({ provider: "generic", url: LINUX_UPDATE_FEED_URL })
  } catch (err) {
    logger.error("telemetry: setFeedURL failed", err)
    return
  }

  autoUpdater.on("update-downloaded", () => {
    trackEvent("desktop.update_downloaded")
    void promptRestart(autoUpdater)
  })

  // Fire-and-forget initial check
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    logger.error("telemetry: checkForUpdatesAndNotify failed", err)
  })

  // Re-check every 24h
  linuxIntervalHandle = setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      logger.error("telemetry: scheduled checkForUpdatesAndNotify failed", err)
    })
  }, UPDATE_CHECK_INTERVAL_MS)
  // Don't keep the event loop alive just for this timer.
  linuxIntervalHandle.unref?.()
}

async function promptRestart(autoUpdater: ElectronUpdaterLike): Promise<void> {
  const response = await dialog
    .showMessageBox({
      type: "info",
      title: "Update ready",
      message: "An update has been downloaded.",
      detail: "Restart now to apply, or wait until the next launch.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    .catch((err) => {
      logger.error("telemetry: restart prompt failed", err)
      return null
    })

  if (response?.response === 0) {
    trackEvent("desktop.update_applied")
    try {
      autoUpdater.quitAndInstall()
    } catch (err) {
      logger.error("telemetry: quitAndInstall failed", err)
    }
  }
}

// -------------------------------------------------------------------------
// Public setup
// -------------------------------------------------------------------------

export interface SetupOptions {
  /** Optional logger; defaults to silent. */
  logger?: Logger
  /**
   * Optional electron-updater autoUpdater instance. If supplied AND we pick
   * the "linux-auto" strategy, we wire it. Otherwise unused.
   * Passed in (rather than imported here) so this module never imports
   * electron-updater on Windows-Store builds where the dep might be absent
   * or stripped.
   */
  autoUpdater?: ElectronUpdaterLike
  /** Override platform / store detection (mostly for tests). */
  platform?: NodeJS.Platform
  isStore?: boolean
}

/**
 * Setup telemetry + update strategy. Call exactly once on `app.whenReady()`.
 *
 * Never throws. On failure, telemetry stays a no-op and the app continues.
 */
export async function setupTelemetry(options: SetupOptions = {}): Promise<void> {
  if (initialized) return
  initialized = true
  logger = options.logger ?? noopLogger

  const platform = options.platform ?? process.platform
  // Electron sets `process.windowsStore` to `true` for MSIX/AppX builds.
  // It's not on the standard Node `process` typing — pull it dynamically.
  const isStore = options.isStore ?? Boolean((process as unknown as { windowsStore?: boolean }).windowsStore)
  const strategy = pickUpdateStrategy(platform, isStore)
  logger.log("telemetry: setup", { platform, isStore, strategy })

  // ---------- 1) SDK init (never crash) ----------
  try {
    client = await initTelemetrySdk({
      clientType: "desktop",
      appVersion: app.getVersion(),
      // disableFlag undefined => let env/config/default decide
    })
  } catch (err) {
    logger.error("telemetry: SDK init failed; running without telemetry", err)
    client = null
  }

  // ---------- 2) First-run notice ----------
  // Only attempt if SDK is alive AND telemetry isn't already off.
  if (client && client.isEnabled()) {
    try {
      await showFirstRunNoticeDialog()
    } catch (err) {
      logger.error("telemetry: first-run notice failed", err)
    }
  }

  // ---------- 3) app_open + heartbeat ----------
  trackEvent("desktop.app_open")
  try {
    client?.heartbeat()
  } catch (err) {
    logger.error("telemetry: heartbeat threw", err)
  }

  // ---------- 4) Update strategy ----------
  switch (strategy) {
    case "store-skip":
      // Microsoft Store handles updates for MSIX/AppX builds. Do nothing —
      // no checkForUpdatesAndNotify, no manual checkUpdate(). The store is
      // contractually responsible for keeping the user current.
      logger.log("telemetry: store-skip — no in-app update check")
      break
    case "linux-auto":
      if (options.autoUpdater) {
        setupLinuxAutoUpdate(options.autoUpdater)
      } else {
        logger.log("telemetry: linux-auto requested but no autoUpdater supplied")
      }
      break
    case "manual":
      // Initial check + every 24h.
      void runManualUpdateCheck()
      manualIntervalHandle = setInterval(() => {
        void runManualUpdateCheck()
      }, UPDATE_CHECK_INTERVAL_MS)
      manualIntervalHandle.unref?.()
      break
  }
}

/**
 * Flush any buffered events with a timeout cap.
 * Never blocks longer than {@link FLUSH_TIMEOUT_MS}.
 */
export async function flushTelemetry(): Promise<void> {
  if (!client) return
  await Promise.race([
    client.flush().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
  ])
}

/**
 * Tear down intervals (mostly for tests). Idempotent.
 */
export function teardownTelemetry(): void {
  if (linuxIntervalHandle) {
    clearInterval(linuxIntervalHandle)
    linuxIntervalHandle = null
  }
  if (manualIntervalHandle) {
    clearInterval(manualIntervalHandle)
    manualIntervalHandle = null
  }
  client = null
  initialized = false
  logger = noopLogger
  lastManualCheckShown = null
}
