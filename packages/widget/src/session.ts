import { Result, Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import {
  type DrawInput,
  DrawOutput,
  type Frame,
  type Node,
  StepOutput,
  type StepInput,
  type WidgetEvent,
  types,
} from "./node.js"
import { tree, unmark } from "./tree.js"
import { compiled } from "./compiled.js"

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
 * Runs one step of `program` (see `program()`) on the stock interpreter with `__input` as the only host global, as a
 * native host (specs/v2/widgets.md, Native hosts): it builds the view's tree itself. Nodes of unknown types are dropped
 * from the view and reported in `warnings`. Rejects with a `StepError`.
 */
export async function step(
  program: string,
  input: Exclude<StepInput, DrawInput>,
  options?: StepOptions,
): Promise<StepOutput> {
  const value = native(await run(program, input, options?.timeoutMs ?? TIMEOUT_MS, true))
  const warnings: string[] = []
  const decoded = decodeOutput(isRecord(value) ? { ...value, view: prune(value.view, warnings) } : value)
  if (Result.isFailure(decoded)) throw new StepError({ kind: "invalid", message: decoded.failure.message })
  if (warnings.length === 0) return decoded.success
  return { ...decoded.success, warnings }
}

/**
 * Runs the `draw` phase for a canvas: the widget template's `draw(state, data, frame)`, or nothing without one. Rejects with a
 * `StepError` when it throws, times out or returns invalid commands. The timeout defaults to `TIMEOUT_MS`, not the
 * spec's 8 ms frame budget.
 */
export async function draw(
  program: string,
  input: Omit<DrawInput, "phase">,
  options?: StepOptions,
): Promise<DrawOutput> {
  const decoded = decodeDraw(await run(program, { phase: "draw", ...input }, options?.timeoutMs ?? TIMEOUT_MS))
  if (Result.isFailure(decoded)) throw new StepError({ kind: "invalid", message: decoded.failure.message })
  return decoded.success
}

// The step output with the view's tree built and every other function marker gone, as the prelude's own tree
// building and the interpreter's result would leave it.
function native(value: unknown) {
  if (!isRecord(value)) return unmark(value)
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, item]) => {
      const out = name === "view" ? tree(item).view : unmark(item)
      return out === undefined ? [] : [[name, out]]
    }),
  )
}

// A draw has no handlers, so it runs without markers.
async function run(program: string, input: StepInput, timeoutMs: number, marked = false) {
  const result = await Runtime.make({
    limits: { timeoutMs },
    translate: marked ? { functions: "mark" } : undefined,
    globals: () => ({ __input: Host.fn(() => input) }),
  }).execute(
    compiled(program + (marked ? "\nreturn __widget_step(__input(), true)" : "\nreturn __widget_step(__input())")),
  )
  if (!result.ok)
    throw new StepError({
      kind: result.error.kind === "TimeoutExceeded" ? "timeout" : "error",
      message: result.error.message,
    })
  return result.value
}

export interface WidgetSession {
  readonly program: string
  readonly data: unknown
  readonly state: unknown
  readonly view: Node
  /**
   * Runs one event through the prelude (the handler of the node with that id, or a hook). Events run one at a time in dispatch order. On failure it rejects with a `StepError`
   * and the session keeps its previous state and view.
   */
  readonly dispatch: (event: WidgetEvent) => Promise<StepOutput>
  /** Draws a canvas of the current view with the current state; never changes the state. */
  readonly draw: (frame: Frame) => Promise<DrawOutput>
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
      draw: (frame) => draw(program, { data, state: current.state, frame }, options),
    }
  },
}

const decodeOutput = Schema.decodeUnknownResult(StepOutput)
const decodeDraw = Schema.decodeUnknownResult(DrawOutput)
const known = new Set<string>(types)

// Drops nodes of unknown types from `children` so older clients render what they know (spec: "unknown node types
// render as nothing plus a dev warning"). Anything else, including an unknown root, is left for the schema to reject.
export function prune(node: unknown, warnings: string[]): unknown {
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
