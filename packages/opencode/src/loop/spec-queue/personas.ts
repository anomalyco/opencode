// Gate-to-persona bindings for loop-spec-queue.
//
// The gate names are already the role names — `implement` is a coder, `test` is
// a tester, `verify` is a reviewer — so the mapping is not a design decision
// anyone has to make. What it buys is two different things, and conflating them
// is why the old generic "use the task tool" nudge did nothing:
//
//   1. Opportunistic parallelism, which is a judgement call and belongs in the
//      brief. It just has to name the agent instead of gesturing at a tool.
//   2. A second opinion before the work is called done, which is NOT a judgement
//      call. `verify` is the last gate before `commit`; an agent grading its own
//      homework there is the weakest point in an unattended run.
//
// Pure and import-free (same pattern as gates.ts / tasks-md.ts) so the driver
// supplies the registry and the config, and tests drive it hermetically.
import type { Gate } from "./brief"

/** Bindings that apply when the named agent exists and config says nothing. */
export const DefaultPersonas: Readonly<Partial<Record<Gate, string>>> = {
  implement: "coder",
  test: "tester",
  verify: "reviewer",
}

/** Gates whose pass/fail a subagent decides, rather than a shell command. */
export const AgentGates: readonly Gate[] = ["verify"]

export type PersonaConfig = Record<string, string | false | undefined>

export interface PersonaBindings {
  /** gate → agent name, only for gates that resolved to a usable agent */
  bindings: Partial<Record<Gate, string>>
  /** misconfigurations to report at run start — a named agent that is absent */
  errors: string[]
}

/**
 * Resolve gate→persona bindings against the agent registry.
 *
 * Three outcomes, and the difference between the last two is the point:
 *   - `false`, or a default whose agent is absent → no binding, gate unchanged.
 *     A repo without these personas gets no instruction it cannot follow.
 *   - a NAMED agent that is absent → an error, reported before the first
 *     iteration. A review gate that quietly stops reviewing is worse than one
 *     that refuses to start, because the run keeps advancing toward commit.
 */
export function resolvePersonas(configured: PersonaConfig | undefined, agentNames: readonly string[]): PersonaBindings {
  const known = new Set(agentNames)
  const bindings: Partial<Record<Gate, string>> = {}
  const errors: string[] = []

  const gates = new Set<string>([...Object.keys(DefaultPersonas), ...Object.keys(configured ?? {})])
  for (const gate of [...gates].sort()) {
    const explicit = configured?.[gate]
    if (explicit === false) continue
    if (typeof explicit === "string") {
      if (!known.has(explicit)) {
        errors.push(`experimental.queue_personas.${gate} names "${explicit}", which is not a known agent`)
        continue
      }
      bindings[gate as Gate] = explicit
      continue
    }
    const fallback = DefaultPersonas[gate as Gate]
    if (fallback && known.has(fallback)) bindings[gate as Gate] = fallback
  }

  return { bindings, errors }
}

const PASS = /\bLGTM\b/
const FAIL = /\bNEEDS_WORK\b/

export type Verdict = { passed: true } | { passed: false; reason: string }

/**
 * Read a reviewer subagent's verdict out of its final text.
 *
 * Anything that is not an unambiguous pass fails the gate. A subagent that
 * errored, timed out, said nothing, or hedged both ways must never advance an
 * unattended run toward `commit` — the cost of a wrong "yes" here is a bad
 * change shipped with nobody watching, and the cost of a wrong "no" is one more
 * model turn.
 */
export function readVerdict(output: string | undefined): Verdict {
  const text = (output ?? "").trim()
  if (text === "") return { passed: false, reason: "the review returned no output" }
  // Only the tail is authoritative: a review that quotes the tokens while
  // explaining itself, then concludes, must be read by its conclusion.
  const tail = text.slice(-400)
  const failed = FAIL.test(tail)
  const passed = PASS.test(tail)
  if (failed) return { passed: false, reason: text }
  if (passed) return { passed: true }
  return { passed: false, reason: `the review returned no recognisable verdict:\n${text.slice(-2_000)}` }
}

export * as SpecQueuePersonas from "./personas"
