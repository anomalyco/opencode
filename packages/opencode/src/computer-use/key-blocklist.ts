/**
 * Key combination blocklist for Computer Use.
 *
 * Prevents the AI from pressing dangerous system shortcuts
 * that could close apps, switch contexts, or cause data loss.
 *
 * Adapted from cc-haha's keyBlocklist.ts.
 */

/** Normalize a key sequence string for lookup. */
function normalizeKeySequence(seq: string): string {
  return seq
    .toLowerCase()
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      const aliases: Record<string, string> = {
        cmd: "command", meta: "command", super: "command",
        ctrl: "control", opt: "option", alt: "option",
        return: "enter", esc: "escape",
        del: "delete", forwarddelete: "delete",
      }
      return aliases[k] || k
    })
    .sort()
    .join("+")
}

/** Raw blocked key combos (normalized at init time). */
const BLOCKED_RAW = [
  // Quit applications
  "command+q",
  // Hide/switch — loss of visual context
  "command+h",
  "command+m",
  "command+tab",
  "command+`",
  // Force quit
  "command+option+escape",
  "command+option+esc",
  // System-level — too risky
  "command+option+power",
  "command+control+power",
  "command+control+q", // lock screen
  // Mission Control / Spaces
  "control+up",
  "control+down",
  "control+left",
  "control+right",
  "command+f3",
  "f3",
  // Spotlight / Siri / Notification Center
  "command+space", // could interfere but not always dangerous — allow with warning
  // Screenshot (creates files)
  "command+shift+3",
  "command+shift+4",
  "command+shift+5",
  // Login window
  "command+shift+q",
]

/** Normalized key name → safe or blocked. Built by normalizing raw entries. */
const BLOCKED_KEYS = new Set(BLOCKED_RAW.map(normalizeKeySequence))

export interface KeyCheckResult {
  blocked: boolean
  reason?: string
}

/** Check if a key sequence is blocked. */
export function checkKeyBlocked(sequence: string): KeyCheckResult {
  const normalized = normalizeKeySequence(sequence)

  if (BLOCKED_KEYS.has(normalized)) {
    return {
      blocked: true,
      reason: `Key combination "${sequence}" is blocked for safety. ` +
        `This shortcut could close an application, switch contexts, or cause unintended system behavior.`,
    }
  }

  return { blocked: false }
}
