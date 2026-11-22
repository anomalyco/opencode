// Writes test/fixtures/wire/*.json: for every built-in widget template and a set of edge cases, the wire view, the
// handler ids and the canvas keys that the prelude at the time of writing produced, and the view as built that a native
// host gets (`built`, each function as the string `FUNCTION`). Hosts that build view trees natively check themselves
// against these files. Run `bun run script/conformance.ts` only to regenerate them from a
// prelude known to be right.
import path from "node:path"
import { Host, Runtime } from "psychoscript"
import { builtins, program } from "../src/index.js"
import { examples } from "../test/fixtures/diagrams.js"
import { cases } from "../test/fixtures/wire-cases.js"

const dir = path.resolve(import.meta.dir, "../test/fixtures/wire")

/** What stands for a function marker in a fixture's `built`. */
export const FUNCTION = "$function"

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

// One fixture: the step's output view as JSON, the ids that have handlers (with the event they take), and the canvas
// ids by key, from the prelude in `src/prelude.js`.
export const record = async (source: string, input: { phase: "init"; data: unknown }) => {
  const result = await Runtime.make({ limits: { timeoutMs: 10_000 } }).execute(
    program(source) +
      `
      const __input_ = ${JSON.stringify(input)}
      const __output = __widget_step(__input_)
      const __state = (typeof init === "function" ? init(__input_.data) : undefined) ?? {}
      const __tree = __widget_tree(view(__state, __input_.data))
      return JSON.stringify({
        view: __output.view,
        handlers: Object.fromEntries(Object.entries(__tree.handlers).map(([id, entry]) => [id, entry.event])),
        canvases: Object.fromEntries(Object.entries(__tree.canvases).map(([key, canvas]) => [key, canvas.id])),
      })`,
  )
  if (!result.ok) throw new Error(result.error.message)
  return JSON.parse(result.value as string) as {
    view: unknown
    handlers: Record<string, string>
    canvases: Record<string, string>
  }
}

// The step's output view in native mode, as it crosses under `translate: { functions: "mark" }`.
export const native = async (source: string, input: unknown) => {
  const result = await Runtime.make({ limits: { timeoutMs: 10_000 }, translate: { functions: "mark" } }).execute(
    program(source) + `\nreturn __widget_step(${JSON.stringify(input)}, true)`,
  )
  if (!result.ok) throw new Error(result.error.message)
  return (result.value as { view: unknown }).view
}

// A view as built with each marker as `FUNCTION`, as JSON (holes and undefined items are null).
export const written = (view: unknown): unknown =>
  JSON.parse(JSON.stringify(view, (_, value) => (value === Host.functionMarker ? FUNCTION : value)))

export const built = async (source: string, input: { phase: "init"; data: unknown }) =>
  written(await native(source, input))

export const fixtures = () => [
  ...builtins
    .filter((template) => template.mode === "step")
    .map((template) => ({
      name: `builtin-${template.name}`,
      builtin: template.name,
      source: template.source,
      input: { phase: "init" as const, data: data[template.name] },
    })),
  ...cases.map((item) => ({
    name: item.name,
    builtin: undefined,
    source: item.source,
    input: { phase: "init" as const, data: item.data ?? null },
  })),
]

if (import.meta.main) {
  for (const fixture of fixtures()) {
    const expected = await record(fixture.source, fixture.input)
    const file = {
      name: fixture.name,
      ...(fixture.builtin ? { builtin: fixture.builtin } : {}),
      source: fixture.source,
      input: fixture.input,
      built: await built(fixture.source, fixture.input),
      ...expected,
    }
    await Bun.write(path.join(dir, `${fixture.name}.json`), JSON.stringify(file, null, 2) + "\n")
  }
  console.log(`wrote ${fixtures().length} fixtures to ${dir}`)
}
