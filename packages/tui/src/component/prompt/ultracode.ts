// Ultracode + budget directive: a standalone `ultracode` keyword (or the
// /ultracode session toggle) tells the agent to orchestrate the task via the
// workflow tool instead of working turn by turn, and a standalone `+$<n>` token
// sets a USD cost cap for the workflow starts of this turn. This module is pure
// so it can be unit tested without the TUI runtime; the prompt component wires
// detection, highlighting, stripping, and directive injection on top of it.

// Word-boundary match via Unicode lookarounds: the keyword only matches when it is
// not flanked by a letter, digit, or underscore (\p{L}\p{N}_). Unlike the ASCII-only
// `\b`, this treats non-ASCII letters as word characters too, so "ultracodeö",
// "öultracode", "ultracodex", "ultracode2", and "ultracode_mode" never match while
// "ultracode:", "(ultracode)", and "foo-ultracode" do. The `i` flag makes detection
// case-insensitive, `u` enables Unicode property escapes.
const KEYWORD = "ultracode"
const BOUNDARY = `(?<![\\p{L}\\p{N}_])${KEYWORD}(?![\\p{L}\\p{N}_])`
const KEYWORD_RE = new RegExp(BOUNDARY, "iu")

export const ULTRACODE_PROMPT_DIRECTIVE =
  "The user opted into workflow orchestration for this task (ultracode). " +
  "Author a workflow for it with the workflow tool (action: create, then start) " +
  "instead of working turn by turn. Use parallel/pipeline fan-out and adversarial " +
  "verification where they fit. Discover the work list inline first, then fan the " +
  "workflow out over it as args. Only skip the workflow if the task is trivial or " +
  "purely conversational."

// Item 13: there is deliberately NO session directive here anymore. The
// /ultracode session toggle persists session.metadata.ultracode via PATCH
// /session/:id; the SERVER then renders the standing opt-in into the system
// prompt (ULTRACODE_SYSTEM_SECTION) and swaps the workflow tool description —
// no per-message injection needed. Only the per-turn keyword directive above
// remains client-side.

// Wraps an injected directive in the <system-reminder> convention the TUI already
// uses for state/context confirmations — same wrapper as formatEditorContext
// (prompt/index.tsx) and dialog-workspace-create.tsx — so the model reads it as
// harness state rather than user prose. The directive CONSTANTS above stay exported
// unwrapped because the app copy (packages/app/src/components/prompt-input/ultracode.ts)
// and the headless copy (packages/opencode/src/cli/cmd/run/workflow.shared.ts) are
// kept word-identical and existing tests assert the bare wording.
export function ultracodeReminder(directive: string): string {
  return `<system-reminder>${directive}</system-reminder>`
}

// Returns the first standalone-keyword hit (index + length) for live highlighting,
// or undefined when the keyword is absent. Length tracks the matched text so the
// caller can style exactly the keyword span.
export function detectUltracodeKeyword(input: string): { index: number; length: number } | undefined {
  const match = KEYWORD_RE.exec(input)
  if (!match) return undefined
  return { index: match.index, length: match[0].length }
}

// Shared whitespace cleanup after a token strip: doubled spaces collapse to one,
// punctuation left dangling behind the removed token is reattached, a leading
// colon/whitespace run (e.g. "ultracode: audit") is dropped, and the result is
// trimmed. Note the `\s+` collapse also flattens newlines into single spaces — a
// long-standing quirk of the ultracode strip that the budget strip keeps for
// behavioural parity.
function collapseAfterStrip(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([:;,.!?])/g, "$1")
    .replace(/^[:\s]+/, "")
    .trim()
}

// Removes every standalone occurrence of the keyword and collapses the whitespace
// it leaves behind.
export function stripUltracodeKeyword(input: string): string {
  return collapseAfterStrip(input.replace(new RegExp(BOUNDARY, "giu"), ""))
}

// Budget directive: a standalone `+$<n>` token (USD form, e.g. "+$5" / "+$0.50")
// caps the cost of the workflow runs the agent starts this turn. Standalone-token
// semantics analogous to BOUNDARY: no letter, digit, `_`, `$`, `+`, or `.` may
// flank the token, so "x+$5", "+$5x", "+$5.5.5" (the trailing-dot lookahead
// rejects every partial match), and "+5" never match while "+$5", "(+$5)", and
// "+$0.50" do. Only the USD form exists today; the token form ("+500k") is a
// follow-up once the engine's token budget (item 17) lands — `unit` is already a
// discriminator so the extension is additive.
const BUDGET_RE = /(?<![\p{L}\p{N}_$+.])\+\$(\d+(?:\.\d+)?)(?![\p{L}\p{N}_$.])/u

export type BudgetDirective = { index: number; length: number; value: number; unit: "usd" }

// Returns the first standalone budget-directive hit for live highlighting and
// directive injection, or undefined when no directive is present.
export function detectBudgetDirective(input: string): BudgetDirective | undefined {
  const match = BUDGET_RE.exec(input)
  if (!match) return undefined
  return { index: match.index, length: match[0].length, value: Number(match[1]), unit: "usd" }
}

// Removes every standalone budget directive (the first one counts, but all are
// stripped from the visible text) using the same cleanup as the keyword strip.
export function stripBudgetDirective(input: string): string {
  return collapseAfterStrip(input.replace(new RegExp(BUDGET_RE.source, "gu"), ""))
}

// Synthetic confirmation injected (inside the <system-reminder> wrapper, see
// ultracodeReminder) when a budget directive was stripped from the prompt.
export function budgetDirectiveText(usd: number): string {
  return (
    `The user set a cost budget of $${usd} for this task (+$${usd} directive). ` +
    `When you start workflows this turn, pass budget: ${usd} (USD) on the workflow tool's start action; ` +
    "if you start several runs, split this budget across them. " +
    "Author workflows to check ctx.budget.remaining() before optional extra passes."
  )
}
