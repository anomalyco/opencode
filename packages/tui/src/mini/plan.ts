/**
 * `bolt run --plan-only`: a CI gate on top of dry-run mode. The session runs
 * with the dry-run marker, so file writes and shell commands are reported by
 * the tools instead of executed; this module collects those reports, renders
 * the full intended plan (diff plus commands), and classifies anything that
 * looks destructive so the gate can exit nonzero.
 */

export interface Entry {
  kind: "command" | "write"
  /** The shell command, or the file path for writes. */
  detail: string
  /** The unified diff reported for a write. */
  diff?: string
}

export interface Finding {
  entry: Entry
  reason: string
}

interface Part {
  tool: string
  state: {
    status: string
    input?: unknown
    output?: string
  }
}

/** Extract a plan entry from a completed tool part, or undefined for tools that change nothing. */
export function collect(part: Part): Entry | undefined {
  if (part.state.status !== "completed") return undefined
  const raw = part.state.input
  const input = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  if (part.tool === "bash" && typeof input["command"] === "string") {
    return { kind: "command", detail: input["command"] }
  }
  if ((part.tool === "write" || part.tool === "edit") && typeof input["filePath"] === "string") {
    return { kind: "write", detail: input["filePath"], diff: diff(part.state.output ?? "") }
  }
  return undefined
}

/** Strip the dry-run preamble from a reported write, keeping the diff body. */
function diff(output: string) {
  const marker = output.indexOf("Would modify ")
  if (marker === -1) return output.trim()
  const body = output.slice(marker).split("\n").slice(2).join("\n")
  return body.trim()
}

const COMMANDS: [RegExp, string][] = [
  [/\brm\s+(-[a-z-]*\s+)*-[a-z]*[rf][a-z]*\b/i, "recursive or forced delete"],
  [/\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/i, "force push"],
  [/\bgit\s+reset\s+--hard\b/i, "hard reset"],
  [/\bgit\s+clean\b.*(-[a-z]*f)/i, "git clean removes untracked files"],
  [/\bgit\s+branch\b.*\s-D\b/, "force branch delete"],
  [/\bdrop\s+(table|database|schema)\b/i, "drops a database object"],
  [/\btruncate\s+(table\b|-s\s*0)/i, "truncates data"],
  [/\bdelete\s+from\b(?![\s\S]*\bwhere\b)/i, "unfiltered SQL delete"],
  [/\bmkfs\b|\bdd\s+[^|]*of=\/dev\//i, "writes to a raw device"],
  [/\bchmod\s+(-[a-z]*R[a-z]*\s+)?777\b/, "world-writable permissions"],
  [/\bshutdown\b|\breboot\b/i, "restarts the machine"],
  [/\bkill\s+(-9\s+)?-?1\b/, "kills init or every process"],
  [/>\s*\/dev\/sd[a-z]\b/i, "writes to a raw device"],
]

const PATHS: [RegExp, string][] = [
  [/(^|\/)\.env(\.|$)/, "modifies environment secrets"],
  [/(^|\/)\.ssh\//, "modifies SSH configuration"],
  [/(^|\/)id_(rsa|ed25519)(\.pub)?$/, "modifies SSH keys"],
]

/** Explain why an entry looks destructive, or undefined when it looks safe. */
export function destructive(entry: Entry): string | undefined {
  if (entry.kind === "command") {
    const hit = COMMANDS.find(([pattern]) => pattern.test(entry.detail))
    if (hit) return hit[1]
    return undefined
  }
  const hit = PATHS.find(([pattern]) => pattern.test(entry.detail))
  if (hit) return hit[1]
  if (entry.diff) {
    const removed = entry.diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length
    const added = entry.diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length
    if (removed >= 10 && added === 0) return `removes ${removed} lines without adding any`
  }
  return undefined
}

/** Every destructive finding in the plan. */
export function verdict(entries: Entry[]): Finding[] {
  return entries.flatMap((entry) => {
    const reason = destructive(entry)
    return reason ? [{ entry, reason }] : []
  })
}

/** Render the full intended plan: commands to run and the complete diff. */
export function render(entries: Entry[]): string {
  if (entries.length === 0) return "Plan: no file writes or shell commands."
  const commands = entries.filter((entry) => entry.kind === "command")
  const writes = entries.filter((entry) => entry.kind === "write")
  const lines: string[] = []
  if (commands.length > 0) {
    lines.push(`Commands (${commands.length}):`)
    for (const entry of commands) lines.push(`  $ ${entry.detail}`)
  }
  if (writes.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push(`File changes (${writes.length}):`)
    for (const entry of writes) {
      lines.push(`  ~ ${entry.detail}`)
      if (entry.diff) lines.push(...entry.diff.split("\n").map((line) => `    ${line}`))
    }
  }
  return lines.join("\n")
}

export * as Plan from "./plan"
