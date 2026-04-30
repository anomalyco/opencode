import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

/**
 * First-run notice.
 *
 * Per design §8.3, on first launch we tell the user what we collect and how
 * to disable. After we've shown the notice once, we drop a marker file in
 * `~/.config/opencode/.telemetry_notice_shown` so the same install never sees
 * it again.
 *
 * This module returns the *text* of the notice but doesn't decide *how* to
 * present it — the CLI prints to stderr, Electron renders a modal, web shows
 * a banner. Each client wraps `firstRunNoticeIfNeeded()` in its own UI shell.
 */

const NOTICE_TEXT = `
opencode collects anonymous usage stats (version, OS, country, command counts)
to improve the project. No code, prompts, or identity is sent.
Disable: export OPENCODE_TELEMETRY=0  ·  Privacy policy: https://deskfox.ai/privacy
(This message will not appear again.)
`.trim()

function defaultNoticeMarkerPath(): string {
  const home = process.env.OPENCODE_TEST_HOME || os.homedir()
  return path.join(home, ".config", "opencode", ".telemetry_notice_shown")
}

export interface NoticeOptions {
  /** Override the marker file path (mostly tests). */
  markerPath?: string
  /** Override the notice text. Useful for client-specific copy. */
  text?: string
}

/**
 * If the notice has not yet been shown, return the text and write the marker.
 * Otherwise return `null`.
 *
 * Note: we write the marker *before* returning, so even if the host crashes
 * between this call and the actual UI presentation, the user only sees the
 * notice once. (We accept the tradeoff: better than spamming on every launch.)
 */
export async function firstRunNoticeIfNeeded(opts: NoticeOptions = {}): Promise<string | null> {
  const marker = opts.markerPath ?? defaultNoticeMarkerPath()

  // Already shown?
  try {
    await fs.access(marker)
    return null
  } catch {
    // Not shown yet.
  }

  // Persist the marker. If we can't write, still return the text — better to
  // show twice than swallow the legal/UX requirement.
  try {
    await fs.mkdir(path.dirname(marker), { recursive: true })
    await fs.writeFile(marker, new Date().toISOString(), "utf8")
  } catch {
    // ignore
  }

  return opts.text ?? NOTICE_TEXT
}

/** For tests / `--reset-notice` debugging: remove the marker file. */
export async function resetNotice(opts: NoticeOptions = {}): Promise<void> {
  const marker = opts.markerPath ?? defaultNoticeMarkerPath()
  try {
    await fs.unlink(marker)
  } catch {
    // ignore
  }
}
