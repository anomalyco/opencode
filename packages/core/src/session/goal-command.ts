// Parsing for `/goal` slash-command arguments, shared by the interactive TUI and
// `opencode run`. Pure string handling only — no service, effect, or database deps —
// so it can be imported into any frontend without pulling in the Goal service layer.

export type GoalCommand =
  | { readonly action: "show" }
  | { readonly action: "set"; readonly text: string }
  | { readonly action: "update"; readonly text: string }
  | { readonly action: "complete"; readonly verification?: string }
  | { readonly action: "pause" }
  | { readonly action: "resume" }
  | { readonly action: "clear" }

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
  }
  return value
}

/**
 * Interpret the arguments passed after `/goal`.
 *
 *   /goal                      -> show
 *   /goal set "text"           -> set
 *   /goal "text"               -> set (bare text is shorthand for set)
 *   /goal update "text"        -> update
 *   /goal pause | resume       -> pause | resume
 *   /goal complete ["note"]    -> complete (optional verification note)
 *   /goal clear | reset        -> clear
 */
export function parseGoalCommand(args: string | undefined): GoalCommand {
  const raw = (args ?? "").trim()
  const lower = raw.toLowerCase()
  if (raw === "" || lower === "show" || lower === "status") return { action: "show" }
  if (lower === "clear" || lower === "reset") return { action: "clear" }
  if (lower === "pause") return { action: "pause" }
  if (lower === "resume") return { action: "resume" }
  if (lower === "complete" || lower.startsWith("complete ")) {
    const note = stripQuotes(raw.slice("complete".length).trim())
    return { action: "complete", verification: note || undefined }
  }
  if (lower.startsWith("update ")) return { action: "update", text: stripQuotes(raw.slice("update ".length).trim()) }
  const text = lower.startsWith("set ") ? raw.slice("set ".length).trim() : raw
  return { action: "set", text: stripQuotes(text) }
}
