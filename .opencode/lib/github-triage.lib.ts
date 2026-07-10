// Pure, dependency-free helpers for the github-triage tool, split out so they
// can be unit-tested without importing the plugin runtime (`@opencode-ai/plugin`).

export const TEAM = {
  tui: ["kommander", "simonklee"],
  desktop_web: ["Hona", "Brendonovich"],
  core: ["jlongster", "rekram1-node", "nexxeln", "kitlangton", "starptech"],
  inference: ["fwang", "MrMushrooooom", "starptech"],
  windows: ["Hona"],
} as const

export type Team = keyof typeof TEAM

/** Pick a random element; throws a clear error instead of returning undefined for an empty list. */
export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("Cannot pick from an empty list")
  return items[Math.floor(Math.random() * items.length)]!
}

/** Parse and validate an issue number from an env-like string. Must be a positive integer. */
export function parseIssueNumber(raw: string | undefined): number {
  const issue = Number.parseInt((raw ?? "").trim(), 10)
  if (!Number.isInteger(issue) || issue <= 0) {
    throw new Error(`Invalid ISSUE_NUMBER: ${JSON.stringify(raw)}`)
  }
  return issue
}
