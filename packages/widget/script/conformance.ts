// Writes test/fixtures/wire/*.json: for every built-in widget template and a set of edge cases, what a native host
// (specs/v2/widgets.md, Native hosts) must make of the program's step: the view the program emits (`built`, with
// `FUNCTION` for each function and `$NaN`, `$Infinity`, `$-Infinity` for numbers JSON can't hold), the tree clients get
// (`view`), the ids with handlers and their events, the canvas ids by key, and the run's result (`result`: `state`,
// `submit`, `dismiss`, `send`), or how the step fails (`error`). They come from the last prelude that could build the
// tree itself (protocol 1's `__widget_step`, kept in `test/fixtures/scripted-prelude.js`), and the TypeScript host must
// agree with it; a step that fails comes from the TypeScript host. Hosts check themselves
// against these files. Run `bun run script/conformance.ts` only to regenerate them from a prelude known to be right.
import { readFileSync } from "node:fs"
import path from "node:path"
import { Host, Runtime } from "psychoscript"
import { builtins, program, type StepInput } from "../src/index.js"
import { run } from "../src/session.js"
import { MAX_VALUE_DEPTH } from "../src/host.js"
import { tree } from "../src/tree.js"
import { examples } from "../test/fixtures/diagrams.js"
import { cases } from "../test/fixtures/wire-cases.js"

const dir = path.resolve(import.meta.dir, "../test/fixtures/wire")

/**
 * A widget template's program on the last prelude that builds the tree itself (`__widget_step`, `__widget_tree`, a
 * handler table, live posts by canvas id), at 523750c6a: an implementation of the tree independent of the hosts'.
 */
const scriptedPrelude = readFileSync(path.resolve(import.meta.dir, "../test/fixtures/scripted-prelude.js"), "utf8")
export const scriptedProgram = (source: string) => scriptedPrelude + "\n" + source

/** What stands for a function marker in a fixture's `built`. */
export const FUNCTION = "$function"

type Input = Exclude<StepInput, { phase: "draw" }>

/** What a step gives a host: the tree and the rest of the output, or why it fails. */
export interface Outcome {
  readonly built?: unknown
  readonly view?: unknown
  readonly handlers?: Record<string, string>
  readonly canvases?: Record<string, string>
  readonly result?: unknown
  /** `view`: a program error in phase `view` with exactly `message`; otherwise the run fails with `message`. */
  readonly error?: { readonly view: boolean; readonly message: string }
}

const data: Record<string, unknown> = {
  ...examples,
  suggestions: {
    title: "Pick",
    options: [
      { label: "A", note: "n", images: ["a.png", "b.png"], recommended: true },
      { label: "B", images: ["b.png"] },
    ],
  },
  form: {
    title: "Form",
    fields: [
      { key: "name", type: "text", label: "Name" },
      { key: "size", type: "number", label: "Size", min: 1, max: 9 },
      { key: "on", type: "boolean", label: "On" },
      { key: "pick", type: "select", label: "Pick", options: [{ value: "a", label: "A" }], multiple: true },
    ],
  },
  confirm: { title: "Sure?", message: "Really.", danger: true },
  chart: { title: "Chart", kind: "bar", labels: ["a", "b"], series: [{ label: "s", values: [1, 2] }], choose: true },
  backdrop: { title: "Hi", preset: "plasma", text: "x" },
}

// The step with the prelude building the tree, as hosts of protocol 1 ran it (on `scriptedProgram`): the view, its handlers' events and its
// canvas ids by key (from the next state's view), and the rest of the step output, all through the run's result.
export const scripted = async (source: string, input: Input): Promise<Outcome> => {
  const result = await Runtime.make({
    typedArrays: true,
    limits: { timeoutMs: 10_000, maxValueDepth: MAX_VALUE_DEPTH },
  }).execute(
    scriptedProgram(source) +
      `
      const __input_ = ${JSON.stringify(input)}
      const { view: __view, ...__result } = __widget_step(__input_)
      const __tree = __widget_tree(view(__result.state, __input_.data))
      return {
        view: __view,
        handlers: Object.fromEntries(Object.entries(__tree.handlers).map(([id, entry]) => [id, entry.event])),
        canvases: Object.fromEntries(Object.entries(__tree.canvases).map(([key, canvas]) => [key, canvas.id])),
        result: __result,
      }`,
  )
  if (!result.ok) return { error: { view: false, message: result.error.message } }
  return JSON.parse(JSON.stringify(result.value)) as Outcome
}

// The step on the TypeScript host, with the view as the program emitted it.
export const native = async (source: string, input: Input): Promise<Outcome> => {
  const seen: { view?: unknown } = {}
  try {
    const { view, ...result } = (await run(
      program(source),
      input,
      10_000,
      (emitted) => (seen.view = emitted),
    )) as Record<string, unknown>
    const built = tree(seen.view, "Argument 1 to __widget_emit")
    return JSON.parse(
      JSON.stringify({
        built: written(seen.view),
        view,
        handlers: Object.fromEntries([...built.handlers].map((id) => [id, "?"])),
        canvases: Object.fromEntries([...built.canvases].map(([key, canvas]) => [key, canvas.id])),
        result,
      }),
    ) as Outcome
  } catch (error) {
    const failed = error as { phase?: string; message: string }
    return {
      ...("view" in seen ? { built: written(seen.view) } : {}),
      error: { view: failed.phase === "view", message: failed.message },
    }
  }
}

// A view as emitted, as JSON (holes and undefined items are null), with what JSON can't hold written out.
export const written = (view: unknown): unknown =>
  JSON.parse(
    JSON.stringify(view, (_, value) =>
      value === Host.functionMarker
        ? FUNCTION
        : typeof value === "number" && !Number.isFinite(value)
          ? "$" + String(value)
          : value,
    ),
  )

/**
 * Why `native` (the TypeScript host) and `scripted` (the prelude building the tree) disagree about a step, or
 * undefined. Where the prelude leaves out a function the host may not take (`drops`), only the host fails.
 */
export const disagreement = (scripted: Outcome, native: Outcome, drops: boolean): string | undefined => {
  if (native.error) {
    if (drops) return scripted.error ? "the prelude fails too" : undefined
    if (!scripted.error) return `the host fails (${native.error.message}), the prelude doesn't`
    // The prelude throws the same failures, from its own lines.
    return scripted.error.message.includes(native.error.message)
      ? undefined
      : `${scripted.error.message} ≠ ${native.error.message}`
  }
  if (scripted.error) return `the prelude fails (${scripted.error.message}), the host doesn't`
  for (const field of ["view", "result", "canvases"] as const)
    if (JSON.stringify(scripted[field]) !== JSON.stringify(native[field])) return `different ${field}`
  if (
    JSON.stringify(Object.keys(scripted.handlers!).toSorted()) !==
    JSON.stringify(Object.keys(native.handlers!).toSorted())
  )
    return "different handlers"
  return undefined
}

/**
 * What a fixture holds, from both runs; throws where they disagree. `newer`: an event the prelude building the tree
 * doesn't know, so the host's outcome, with the handlers' events from that prelude's init.
 */
export const expected = async (source: string, input: Input, drops = false, newer = false): Promise<Outcome> => {
  if (newer) {
    const [init, host] = [await scripted(source, { phase: "init", data: input.data }), await native(source, input)]
    const ids = (outcome: Outcome) => JSON.stringify(Object.keys(outcome.handlers ?? {}).toSorted())
    if (init.error || host.error || ids(init) !== ids(host)) throw new Error("the handlers differ from init's")
    return { ...host, handlers: init.handlers }
  }
  const [left, right] = [await scripted(source, input), await native(source, input)]
  const problem = disagreement(left, right, drops)
  if (problem) throw new Error(problem)
  return right.error ? right : { ...right, handlers: left.handlers }
}

export const fixtures = () => [
  ...builtins
    .filter((template) => template.mode === "step")
    .map((template) => ({
      name: `builtin-${template.name}`,
      builtin: template.name,
      source: template.source,
      input: { phase: "init" as const, data: data[template.name] } as Input,
      drops: false,
      newer: false,
    })),
  ...cases.map((item) => ({
    name: item.name,
    builtin: undefined,
    source: item.source,
    input: (item.input ?? { phase: "init", data: item.data ?? null }) as Input,
    drops: item.drops === true,
    newer: item.newer === true,
  })),
]

if (import.meta.main) {
  for (const fixture of fixtures()) {
    const outcome = await expected(fixture.source, fixture.input, fixture.drops, fixture.newer).catch(
      (error: Error) => {
        throw new Error(`${fixture.name}: ${error.message}`)
      },
    )
    const file = {
      name: fixture.name,
      ...(fixture.builtin ? { builtin: fixture.builtin } : {}),
      source: fixture.source,
      input: fixture.input,
      ...outcome,
    }
    await Bun.write(path.join(dir, `${fixture.name}.json`), JSON.stringify(file, null, 2) + "\n")
  }
  console.log(`wrote ${fixtures().length} fixtures to ${dir}`)
}
