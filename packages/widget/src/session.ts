import { Result, Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import {
  type DrawInput,
  type DrawOutput,
  type Frame,
  type Node,
  StepOutput,
  type StepInput,
  type WidgetEvent,
  types,
} from "./node.js"
import { json, tree, unmark, ViewError } from "./tree.js"
import { compiled } from "./compiled.js"
import { checkDraw } from "./draw.js"
import { located, MAX_VALUE_DEPTH, NEWER, OLDER, protocol, PROTOCOL, TYPED_ARRAYS } from "./host.js"

/** The most a step may run; clients may pass a smaller `timeoutMs`. */
export const TIMEOUT_MS = 250

export type StepOptions = { readonly timeoutMs?: number }

/**
 * A step that failed: the program threw or failed to parse (`error`), ran out of time (`timeout`), or returned
 * something that is not a step output with a valid view (`invalid`). Callers keep the previous state and view. `phase`
 * is `view` for a view that breaks the rules of views (a key's type, its depth), which clients report as that phase.
 */
export class StepError extends Schema.TaggedError<StepError>()("Widget.StepError", {
  kind: Schema.Literals(["error", "timeout", "invalid"]),
  message: Schema.String,
  phase: Schema.optionalKey(Schema.Literal("view")),
}) {}

/**
 * Runs one step of `program` (see `program()`) on the stock interpreter as a native host (specs/v2/widgets.md, Native
 * hosts): the view comes through `__widget_emit` and the host builds its tree, the rest is the run's result. Nodes of
 * unknown types are dropped from the view and reported in `warnings`. Rejects with a `StepError`, or an `Error` for a
 * program that needs a newer host.
 */
export async function step(
  program: string,
  input: Exclude<StepInput, DrawInput>,
  options?: StepOptions,
): Promise<StepOutput> {
  const value = await run(program, input, options?.timeoutMs ?? TIMEOUT_MS)
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
  const output = (await run(program, { phase: "draw", ...input }, options?.timeoutMs ?? TIMEOUT_MS)) as {
    readonly commands: unknown
  }
  const checked = checkDraw(output.commands)
  if ("error" in checked) throw new StepError({ kind: "invalid", message: checked.error })
  return checked
}

const EMITTED = "Argument 1 to __widget_emit"

/**
 * Runs `<program>\nreturn __widget_native_step(__input())`: the step output, with the view's tree built, or a draw's
 * `{ commands }`. `observe` sees the view as the program emitted it.
 * @internal
 */
export async function run(program: string, input: StepInput, timeoutMs: number, observe?: (view: unknown) => void) {
  const version = protocol(program)
  if (version > PROTOCOL) throw new Error(NEWER)
  if (version < PROTOCOL) throw new StepError({ kind: "invalid", message: OLDER })
  const emitted: { view?: unknown; failure?: string; commands?: unknown } = {}
  const emit = ([view, failure]: ReadonlyArray<unknown>) => {
    // A draw's commands, as the run's result would have carried them; the draw output's checks follow.
    if (input.phase === "draw") return void (emitted.commands = json(view))
    if (typeof failure === "string") return void (emitted.failure = failure)
    observe?.(view)
    try {
      emitted.view = tree(view, EMITTED).view
    } catch (error) {
      if (!(error instanceof ViewError)) throw error
      emitted.failure = error.message
    }
  }
  const result = await Runtime.make({
    limits: { timeoutMs, maxValueDepth: MAX_VALUE_DEPTH },
    typedArrays: TYPED_ARRAYS,
    translate: { functions: "mark" },
    globals: () => ({ __input: Host.fn(() => input), __widget_emit: located(emit) }),
  }).execute(compiled(program + "\nreturn __widget_native_step(__input())"))
  if (emitted.failure !== undefined) throw new StepError({ kind: "invalid", message: emitted.failure, phase: "view" })
  if (!result.ok)
    throw new StepError({
      kind: result.error.kind === "TimeoutExceeded" ? "timeout" : "error",
      message: result.error.message,
    })
  // The result is JSON, with markers where functions were, which JSON leaves out.
  const value = unmark(result.value)
  if (input.phase === "draw") return { commands: emitted.commands }
  if (!("view" in emitted)) throw new StepError({ kind: "invalid", message: "The step gave no view" })
  return isRecord(value) ? { ...value, view: emitted.view } : value
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
