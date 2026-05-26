/**
 * Tool-input repair layer for open-weight models.
 *
 * Background: open-weight models (deepseek, qwen, glm, ...) fail tool calls in
 * a small, repeatable set of shape-level ways. Strict schema rejection sends
 * them into recovery loops, because the raw "Expected X, got Y" error is
 * rarely enough for the model to find the fix on its own.
 *
 * Approach: validate first, repair on failure. We let the schema decode run
 * unchanged; only when it fails do we walk the parse error's issue tree to
 * locate the failing paths, apply targeted shape repairs at those paths, and
 * re-decode. Successful inputs are never touched — there is no preprocessing
 * that could corrupt a valid call.
 *
 * The four shape repairs were chosen by surveying the failure modes most
 * commonly reported against opencode (see issue #26498). Ordering matters:
 * the JSON-array-string repair must fire before the bare-string wrap, or a
 * stringified array like `'["a","b"]'` would be wrapped into
 * `['["a","b"]']`. The `repairAt` switch encodes that ordering at each path.
 */
import { Effect } from "effect"

type Path = ReadonlyArray<string | number>

/**
 * Effect Schema parse issues form a tree:
 *   Composite { issues: Issue[] }
 *   Pointer   { path: (string|number)[]; issue: Issue }
 *   <leaf>    { _tag: "MissingKey" | "InvalidType" | "AnyOf" | ... }
 *
 * We collect (path, leafTag) for each leaf so we can repair at the exact
 * location where the schema disagreed.
 */
const ISSUE_MARKER = "~effect/SchemaIssue/Issue"

export function collectFailures(issue: unknown): Array<{ path: Path; tag: string }> {
  const out: Array<{ path: Path; tag: string }> = []
  const walk = (i: any, path: Path) => {
    if (!i || typeof i !== "object" || !(ISSUE_MARKER in i)) return
    if (i._tag === "Pointer") return walk(i.issue, [...path, ...(i.path ?? [])])
    if (i._tag === "Composite") {
      for (const child of i.issues ?? []) walk(child, path)
      return
    }
    out.push({ path, tag: i._tag ?? "Unknown" })
  }
  walk(issue, [])
  return out
}

function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(cloneDeep) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as object)) out[key] = cloneDeep((value as any)[key])
  return out as unknown as T
}

const JSON_ARRAY_RE = /^\s*\[[\s\S]*\]\s*$/

/**
 * Apply the highest-priority repair that fits the current value at
 * `parent[key]`. Returns true if a repair was applied.
 *
 * The order is fixed and load-bearing:
 *   1. null at an optional position → drop the key
 *   2. JSON-array-shaped string     → parse to a real array
 *   3. empty-object placeholder {}  → drop the key
 *   4. bare scalar where an array was expected → wrap as [scalar]
 *
 * Repair (2) must precede (4). Repair (4) is intentionally last because it
 * applies broadly; if a more specific repair fits, we want it to win.
 */
function repairAt(parent: any, key: string | number, leafTag: string): boolean {
  const value = parent[key]

  if (value === null) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1)
    else delete parent[key]
    return true
  }

  if (typeof value === "string" && JSON_ARRAY_RE.test(value)) {
    const parsed = parseJsonSafe(value)
    if (Array.isArray(parsed)) {
      parent[key] = parsed
      return true
    }
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1)
    else delete parent[key]
    return true
  }

  // Bare-scalar-to-array wrap. Only fires when the leaf says a non-array was
  // seen in a position that requires an array — relying on `InvalidType` and
  // its AnyOf variant keeps us from wrapping in unrelated positions (e.g. a
  // string in a position that wanted a number).
  if ((leafTag === "InvalidType" || leafTag === "AnyOf") && !Array.isArray(value) && value !== undefined) {
    parent[key] = [value]
    return true
  }

  return false
}

function parseJsonSafe(input: string): unknown {
  // We narrow callers to strings already; this only suppresses a syntactic
  // parse failure.
  // eslint-disable-next-line no-restricted-syntax
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

function navigate(root: any, path: Path): { parent: any; key: string | number } | undefined {
  if (path.length === 0) return undefined
  let parent: any = root
  for (let i = 0; i < path.length - 1; i++) {
    if (parent == null || typeof parent !== "object") return undefined
    parent = parent[path[i]]
  }
  if (parent == null || typeof parent !== "object") return undefined
  return { parent, key: path[path.length - 1] }
}

/**
 * Apply targeted repairs to a copy of `input` based on the validator's own
 * issue list. The schema is the prior; we only spend repair budget at paths
 * the schema explicitly disagreed at. Returns `undefined` if no repair was
 * applicable (caller should surface the original validation error).
 */
export function repair(input: unknown, issue: unknown): { value: unknown; repairs: string[] } | undefined {
  const failures = collectFailures(issue)
  if (failures.length === 0) return undefined
  const out = cloneDeep(input)
  const applied: string[] = []
  for (const { path, tag } of failures) {
    const target = navigate(out, path)
    if (!target) continue
    if (repairAt(target.parent, target.key, tag)) {
      applied.push(`${path.join(".")}:${tag}`)
    }
  }
  if (applied.length === 0) return undefined
  return { value: out, repairs: applied }
}

// Effect Schema short-circuits at the first failing element of an array or
// struct, so a single decode-then-repair pass can only fix one path at a
// time. We loop until either the input parses cleanly or no further repair
// applies. The bound is generous relative to the four-shape catalogue but
// guarantees termination if a repair somehow re-introduces a failure.
const MAX_REPAIR_ROUNDS = 6

/**
 * Attempt to recover from a tool-input validation failure. On success,
 * annotates the current span with the repairs applied so per-tool repair
 * rates can be watched in telemetry. On terminal failure, surfaces the
 * original error so the model still sees the schema-level explanation it
 * can act on (not a repair-induced cascade).
 */
export function recover<A, E, R>(
  decode: (input: unknown) => Effect.Effect<A, E, R>,
  rawInput: unknown,
  error: unknown,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    let current: unknown = rawInput
    let currentError: unknown = error
    const repairs: string[] = []
    for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
      const attempt = repair(current, (currentError as any)?.issue)
      if (!attempt) return yield* Effect.fail(error as E)
      repairs.push(...attempt.repairs)
      current = attempt.value
      const exit = yield* Effect.exit(decode(current))
      if (exit._tag === "Success") {
        yield* Effect.annotateCurrentSpan("tool.input_repaired", repairs.join(","))
        return exit.value
      }
      const failure = exit.cause.reasons.find((r: any) => r._tag === "Fail" || r._tag === "FailReason")
      currentError = (failure as any)?.error ?? error
    }
    return yield* Effect.fail(error as E)
  })
}
