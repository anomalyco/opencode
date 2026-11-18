// What Settings › Browser shows, decided apart from its markup.
import type { ExtensionCompatibility, InstallResult } from "./profile/ipc"

/** The search entries whose rows are inside Advanced. */
export const ADVANCED_ENTRIES = ["settings-browser-remote", "settings-browser-agent-pages", "settings-browser-sites", "settings-browser-cookies"]

/**
 * Whether the Advanced section shows open: the person opened it on this device (`stored`), or a settings search is
 * revealing a row inside it (`target`), which shows it open for that visit without changing what is stored.
 */
export function advancedOpen(stored: boolean | undefined, target: string | undefined) {
  return stored === true || (target !== undefined && ADVANCED_ENTRIES.includes(target))
}

/** Whether an extension works in this browser, as one plain line: it works, it may not fully, or it probably won't. */
export function verdict(level: ExtensionCompatibility["level"]) {
  if (level === "supported") return "review.works"

  return level === "partial" ? "review.partial" : "extensions.compat.unsupported"
}

/**
 * The sentence for where an extension's package came from when no store published it. The install review shows it in
 * sight, beside the verdict: a person must know it before adding. A store's copy says so behind Details.
 */
export function unvettedSource(source: "chrome" | "edge" | "browser" | "folder") {
  return source === "browser" || source === "folder" ? (`review.source.${source}` as const) : undefined
}

/**
 * One everyday sentence for the widest thing an extension can do, in sight beside the verdict; the whole list is behind
 * Details. The widest of all, every website, is said in those words.
 */
export function accessSummary(access: Extract<InstallResult, { token: string }>["access"]) {
  if (access.includes("allSites")) return "review.summary.allSites"

  if (access.includes("someSites")) return "review.summary.someSites"

  if (access.includes("cookies")) return "review.summary.cookies"

  if (access.includes("activity")) return "review.summary.activity"

  return access.includes("clipboard") ? "review.summary.clipboard" : "review.summary.none"
}
