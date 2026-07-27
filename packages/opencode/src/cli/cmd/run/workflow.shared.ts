// Pure helpers for the headless `opencode run --workflow <name> [key=value...]`
// path (Spec §5.2 (5)) and the ultracode keyword in the run prompt path.

// Parses positional `key=value` tokens into a workflow args payload. yargs has
// already split the positionals, so this only does a per-token first-`=` split +
// quote strip; bare tokens (`--verbose`/`flag`) become the string "true". NO
// number coercion (Delta 9): headless has no meta.arguments declaration to hand
// before the workflow loads, so strings are least-surprising — the workflow's
// own run() validates. `version=1.0`/`zip=01234` survive intact as strings.
export function parseHeadlessWorkflowArgs(tokens: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const token of tokens) {
    const eq = token.indexOf("=")
    const rawName = eq === -1 ? token : token.slice(0, eq)
    const name = rawName.replace(/^--?/, "")
    if (!name) continue
    if (eq === -1) {
      result[name] = "true"
      continue
    }
    const raw = token.slice(eq + 1)
    const value =
      (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
      (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
        ? raw.slice(1, -1)
        : raw
    result[name] = value
  }
  return result
}

// Distinct non-zero exit code for a run that PARKED awaiting a question
// (status `paused` with a pending_question). Headless mode has no interactive
// answerer, so the run cannot proceed — but this is NOT a failure: the run stays
// resumable via the answer route. Code 2 lets a caller/script tell "needs an
// answer" apart from a plain failure (1). See `workflowExitCode` / Finding 6.
export const WORKFLOW_PARKED_EXIT_CODE = 2 as const

// Headless exit code from a run status: a completed run exits 0; a run that
// parked awaiting input exits with the distinct parked code; every other
// terminal status (failed/cancelled/interrupted) exits 1.
export function workflowExitCode(status: string): 0 | 1 | typeof WORKFLOW_PARKED_EXIT_CODE {
  if (status === "completed") return 0
  if (status === "paused") return WORKFLOW_PARKED_EXIT_CODE
  return 1
}

// Operator-facing guidance printed when a headless `--workflow` run parks on a
// `ctx.question`. There is no one to answer it in headless mode, so we surface
// the exact question, the run id (which stays resumable), the accepted options
// when offered, and the precise HTTP route to answer it out-of-band.
export function formatParkedQuestion(input: { id: string; question: string; options?: string[] }): string {
  const lines = [
    `Workflow parked awaiting an answer; cannot answer in headless mode (exit ${WORKFLOW_PARKED_EXIT_CODE}).`,
    `Question: ${input.question}`,
  ]
  if (input.options && input.options.length > 0) lines.push(`Options: ${input.options.join(", ")}`)
  lines.push(
    `Run ${input.id} stays paused and resumable. Answer it via the HTTP answer route:`,
    `  POST /workflow/run/${input.id}/answer   body: { "answer": "<your answer>" }`,
  )
  return lines.join("\n")
}

// --- Ultracode parity (Delta 6a) -------------------------------------------
// Duplicated from packages/tui/src/component/prompt/ultracode.ts because of the
// package boundary (packages/opencode cannot import packages/tui). The boundary
// regex and the ULTRACODE_PROMPT_DIRECTIVE wording are IDENTICAL on purpose; the
// parity test in workflow.shared.test.ts nails the wording + behavior so any
// drift between the two copies fails. Future: lift into @opencode-ai/core.
const KEYWORD = "ultracode"
const BOUNDARY = `(?<![\\p{L}\\p{N}_])${KEYWORD}(?![\\p{L}\\p{N}_])`
const KEYWORD_RE = new RegExp(BOUNDARY, "iu")

export const RUN_ULTRACODE_DIRECTIVE =
  "The user opted into workflow orchestration for this task (ultracode). " +
  "Author a workflow for it with the workflow tool (action: create, then start) " +
  "instead of working turn by turn. Use parallel/pipeline fan-out and adversarial " +
  "verification where they fit. Discover the work list inline first, then fan the " +
  "workflow out over it as args. Only skip the workflow if the task is trivial or " +
  "purely conversational."

export function detectUltracodeKeyword(input: string): { index: number; length: number } | undefined {
  const match = KEYWORD_RE.exec(input)
  if (!match) return undefined
  return { index: match.index, length: match[0].length }
}

export function stripUltracodeKeyword(input: string): string {
  return input
    .replace(new RegExp(BOUNDARY, "giu"), "")
    .replace(/\s+/g, " ")
    .replace(/\s+([:;,.!?])/g, "$1")
    .replace(/^[:\s]+/, "")
    .trim()
}
