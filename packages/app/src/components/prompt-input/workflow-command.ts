import type { WorkflowInfo } from "@opencode-ai/sdk/v2"

// Pure `/workflow` command + argument parsing, ported verbatim from the TUI
// (`packages/tui/src/component/dialog-workflow-helpers.ts` and
// `packages/tui/src/component/prompt/workflow-autocomplete.ts`), minus the
// `TextareaRenderable`-bound insert helpers — the web app inserts text its own
// way. Kept pure + dependency-free so it is unit-testable.

export type WorkflowCommand = { type: "dashboard" } | { type: "start"; name: string; args: string }

// Fund 59: dispatch `/workflows ...` to the dashboard and `/workflow <name> ...`
// to a start. Splitting only on whitespace is not enough because `/workflows`
// has `/workflow` as a prefix, so `/workflows foo` used to be parsed as starting
// a workflow literally named `workflows`. Anchor on the exact first token.
// Fund 60: the start remainder is the RAW substring after the name (multiple
// spaces preserved) so `msg="hello   world"` survives intact to parseWorkflowArgs.
export function parseWorkflowCommand(input: string): WorkflowCommand | undefined {
  const firstLine = input.split("\n")[0]
  const command = firstLine.trimStart().split(/\s/)[0]
  if (command === "/workflows") return { type: "dashboard" }
  if (command !== "/workflow") return
  const remainder = firstLine.trimStart().slice(command.length).trimStart()
  if (!remainder) return { type: "dashboard" }
  const nameEnd = remainder.search(/\s/)
  if (nameEnd === -1) return { type: "start", name: remainder, args: "" }
  return { type: "start", name: remainder.slice(0, nameEnd), args: remainder.slice(nameEnd + 1) }
}

// Quote-aware, single-pass tokenizer. Splits on unquoted whitespace but keeps a
// quoted segment (`"a b"` / `'a b'`) attached to its token, so `msg="a b"` is one
// token rather than two. Linear in the input length — no backtracking — so it is
// immune to the catastrophic backtracking that a monolithic regex was prone to on
// pathological input (N14). `incomplete` flags a token whose closing quote the
// user has not typed yet; an unbalanced-quote token like `b="x y` is kept whole.
function tokenizeWorkflowArgs(input: string) {
  const tokens: { text: string; incomplete: boolean }[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  let escaped = false
  let incomplete = false
  const flush = () => {
    if (current === "" && !incomplete) return
    tokens.push({ text: current, incomplete })
    current = ""
    incomplete = false
  }
  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\" && quote) {
      current += char
      escaped = true
      continue
    }
    if (quote) {
      current += char
      if (char === quote) quote = undefined
      else incomplete = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      incomplete = true
      current += char
      continue
    }
    if (/\s/.test(char)) {
      flush()
      continue
    }
    current += char
  }
  flush()
  return tokens
}

// The argument declaration as it appears on a workflow's meta (WorkflowInfo /
// WorkflowMeta["arguments"]): a map of arg name -> { type?, default?, description? }.
// Only the declared `type` drives coercion here.
export type WorkflowArgDeclaration = Record<string, { type?: string }>

// Parses `name=value` tokens into a payload, coercing values by DECLARED type
// rather than by appearance. Coercion rules:
//   - An arg declared `type: "number"` whose value parses as a finite number is
//     coerced to that number. A declared-number arg whose value does NOT parse
//     (e.g. `count=abc`) is passed through as the raw string — the engine stores
//     args untyped and runs no coercion/validation of its own, so silently
//     turning a non-number into NaN would corrupt data; surfacing the raw string
//     is least surprising.
//   - Every other arg — declared string, declared anything-else, or UNDECLARED —
//     keeps its exact text (so `version=1.0` and `zip=01234` survive intact).
//   - Bare flags (`--verbose`) keep the existing behavior of becoming the string
//     "true"; the parser has never produced real booleans.
export function parseWorkflowArgs(input: string, declaration: WorkflowArgDeclaration = {}) {
  return Object.fromEntries(
    tokenizeWorkflowArgs(input).flatMap((token) => {
      const eq = token.text.indexOf("=")
      const name = (eq === -1 ? token.text : token.text.slice(0, eq)).replace(/^--?/, "")
      if (!name) return []
      const raw = eq === -1 ? "true" : token.text.slice(eq + 1)
      const value =
        (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
        (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
          ? raw.slice(1, -1).replace(/\\(["'\\])/g, "$1")
          : raw
      if (declaration[name]?.type !== "number") return [[name, value]]
      const numeric = Number(value)
      return [[name, Number.isFinite(numeric) && value.trim() !== "" ? numeric : value]]
    }),
  )
}

// `budget=<n>` is a RESERVED `/workflow` argument: it never reaches the
// workflow's args but becomes the start payload's cost cap
// (WorkflowStartPayload.budget, USD). Semantics are identical to the TUI's
// extractReservedBudget (prompt/workflow-autocomplete.ts):
//   - A workflow that DECLARES its own `budget` argument owns the name — no
//     reservation, args pass through untouched (backwards compatibility).
//   - Otherwise the `budget` key is pulled out; the raw value (number or
//     numeric string, a leading `$` is tolerated so `budget=$5` works) must be
//     finite and >= 0 — the engine explicitly allows a 0 cap (HTTP schema:
//     Finite >= 0), so 0 is valid here too (deliberate deviation from the
//     original app spec's `> 0` to keep both UIs character-identical).
//   - An invalid value (`abc`, `-1`, empty) reports `invalid` with the raw
//     value so the caller can toast and ABORT the start instead of silently
//     dropping the cap.
export function extractReservedBudget(
  args: Record<string, unknown>,
  declaration: WorkflowArgDeclaration,
): { args: Record<string, unknown>; budget?: number; invalid?: string } {
  if (declaration["budget"] !== undefined) return { args }
  if (!("budget" in args)) return { args }
  const raw = String(args["budget"])
  const bare = raw.replace(/^\$/, "")
  const numeric = Number(bare)
  if (bare.trim() === "" || !Number.isFinite(numeric) || numeric < 0) return { args, invalid: raw }
  const { budget: _, ...rest } = args
  return { args: rest, budget: numeric }
}

// Bonus A: resolves a direct `/<name>` input to a workflow start when — and
// only when — the server registered <name> as a workflow-sourced command
// (source:'workflow', the discovery-only rows with an empty template). The
// caller checks parseWorkflowCommand FIRST, so `/workflow`/`/workflows` keep
// their dispatch and commands keep precedence over workflows; this function
// itself only matches the name. Like parseWorkflowCommand, only the first line
// determines the command, and the args are the RAW remainder of that line
// (multiple spaces preserved — Fund 60).
export function resolveDirectWorkflowCommand(
  input: string,
  commands: ReadonlyArray<{ name: string; source?: string }>,
): Extract<WorkflowCommand, { type: "start" }> | undefined {
  const firstLine = input.split("\n")[0].trimStart()
  if (!firstLine.startsWith("/")) return undefined
  const head = firstLine.split(/\s/)[0]
  const name = head.slice(1)
  if (!name) return undefined
  const command = commands.find((candidate) => candidate.name === name)
  if (command?.source !== "workflow") return undefined
  const rest = firstLine.slice(head.length)
  return { type: "start", name, args: rest === "" ? "" : rest.slice(1) }
}

export type WorkflowCommandOption = { name: string; description?: string }

// Direct `/<name>` slash commands for every DISCOVERED workflow (Claude-Code
// parity): a workflow named `review` surfaces in the `/` menu as `/review`,
// routed exactly like `/workflow review` via the existing dispatch. Pure +
// filtering-only so it is unit-testable. Filters:
//   - invalid workflows (broken files) — they cannot be started;
//   - a name that collides with an existing command (built-in slash, server, or
//     MCP command) so a workflow never silently shadows / duplicates a real
//     command.
export function workflowCommandOptions(
  workflows: WorkflowInfo[],
  existingCommandNames: Set<string>,
): WorkflowCommandOption[] {
  return workflows
    .filter((workflow) => workflow.valid !== false && !existingCommandNames.has(workflow.name))
    .map((workflow) => ({
      name: workflow.name,
      description: workflow.meta.description ?? workflow.meta.name,
    }))
}

// Save-as-command: a run's persisted `definition.source` can be written to disk
// as a real workflow file. The file base is the workflow name, but a name is
// untrusted, so it MUST be sanitized before it becomes a path: a name with a
// slash or `..` could escape the workflows dir. Returns the trimmed name when it
// is a single safe path segment, or `undefined` when it must be rejected (empty,
// contains a path separator, or is a `.`/`..` traversal segment).
export function sanitizeWorkflowFilename(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  if (trimmed === "." || trimmed === "..") return undefined
  if (/[\\/]/.test(trimmed)) return undefined
  return trimmed
}
