import { Result, Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import { type Node, StepOutput, type StepInput, type WidgetEvent, types } from "./node.js"

/** The most a step may run; clients may pass a smaller `timeoutMs`. */
export const TIMEOUT_MS = 250

export type StepOptions = { readonly timeoutMs?: number }

/**
 * A step that failed: the program threw or failed to parse (`error`), ran out of time (`timeout`), or returned
 * something that is not a step output with a valid view (`invalid`). Callers keep the previous state and view.
 */
export class StepError extends Schema.TaggedError<StepError>()("Widget.StepError", {
  kind: Schema.Literals(["error", "timeout", "invalid"]),
  message: Schema.String,
}) {}

/**
 * Runs one step of `program` (see `program()`) on the stock interpreter with `__input` as the only host global.
 * Nodes of unknown types are dropped from the view and reported in `warnings`. Rejects with a `StepError`.
 */
export async function step(program: string, input: StepInput, options?: StepOptions): Promise<StepOutput> {
  const result = await Runtime.make({
    limits: { timeoutMs: options?.timeoutMs ?? TIMEOUT_MS },
    globals: () => ({ __input: Host.fn(() => input) }),
  }).execute(program + "\nreturn __widget_step(__input())")
  if (!result.ok)
    throw new StepError({
      kind: result.error.kind === "TimeoutExceeded" ? "timeout" : "error",
      message: result.error.message,
    })
  const warnings: string[] = []
  const value = result.value
  const decoded = decodeOutput(isRecord(value) ? { ...value, view: prune(value.view, warnings) } : value)
  if (Result.isFailure(decoded)) throw new StepError({ kind: "invalid", message: decoded.failure.message })
  if (warnings.length === 0) return decoded.success
  return { ...decoded.success, warnings }
}

export interface WidgetSession {
  readonly program: string
  readonly data: unknown
  readonly state: unknown
  readonly view: Node
  /**
   * Runs `update` for one event. Events run one at a time in dispatch order. On failure it rejects with a `StepError`
   * and the session keeps its previous state and view.
   */
  readonly dispatch: (event: WidgetEvent) => Promise<StepOutput>
}

export const WidgetSession = {
  /** Runs `init`; rejects with a `StepError` when it fails (show an error card). */
  start: async (program: string, data: unknown, options?: StepOptions): Promise<WidgetSession> => {
    const first = await step(program, { phase: "init", data }, options)
    const current = { state: first.state, view: first.view, queue: Promise.resolve() }
    return {
      program,
      data,
      get state() {
        return current.state
      },
      get view() {
        return current.view
      },
      dispatch: (event) => {
        const next = current.queue
          .then(() => step(program, { phase: "event", data, state: current.state, event }, options))
          .then((output) => {
            current.state = output.state
            current.view = output.view
            return output
          })
        current.queue = next.then(
          () => undefined,
          () => undefined,
        )
        return next
      },
    }
  },
}

const decodeOutput = Schema.decodeUnknownResult(StepOutput)
const known = new Set<string>(types)

// Drops nodes of unknown types from `children` so older clients render what they know (spec: "unknown node types
// render as nothing plus a dev warning"). Anything else, including an unknown root, is left for the schema to reject.
function prune(node: unknown, warnings: string[]): unknown {
  if (!isRecord(node) || !Array.isArray(node.children)) return node
  return {
    ...node,
    children: node.children.filter((child) => keep(child, warnings)).map((child) => prune(child, warnings)),
  }
}

function keep(child: unknown, warnings: string[]) {
  if (!isRecord(child) || typeof child.type !== "string" || known.has(child.type)) return true
  warnings.push(`Unknown node type "${child.type}" was not rendered`)
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
