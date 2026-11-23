import { expect, test } from "bun:test"
import path from "node:path"
import { checkDraw, draw, LiveWidget, program } from "../src/index.js"
import { LIVE, STEP } from "./limits.js"

// The shared draw command fixtures (`fixtures/draw.json`, specs/v2/widgets.md, Canvas): every host must give each
// case's `valid` commands or fail with exactly its `error`. This holds the TypeScript host to them three ways: the
// checks alone, a draw step and a live `widget.draw`.
interface Repeat {
  readonly repeat: { readonly command: unknown; readonly count: number }
}
interface Case {
  readonly name: string
  readonly commands?: unknown
  readonly repeat?: Repeat["repeat"]
  readonly valid?: unknown
  readonly error?: string
}

const fixture = (await Bun.file(path.resolve(import.meta.dir, "fixtures/draw.json")).json()) as {
  readonly cases: ReadonlyArray<Case>
}

const SPECIAL: Record<string, unknown> = {
  $NaN: NaN,
  $Infinity: Infinity,
  "$-Infinity": -Infinity,
  $undefined: undefined,
}

// The case's commands as the host gets them, and as a JavaScript expression that makes them.
const value = (item: unknown): unknown =>
  typeof item === "string" && Object.hasOwn(SPECIAL, item)
    ? SPECIAL[item]
    : Array.isArray(item)
      ? item.map(value)
      : item && typeof item === "object"
        ? Object.fromEntries(Object.entries(item).map(([key, field]) => [key, value(field)]))
        : item
const commands = (item: Case) =>
  item.repeat ? Array.from({ length: item.repeat.count }, () => item.repeat!.command) : value(item.commands)
const expression = (item: Case) =>
  item.repeat
    ? `Array.from({ length: ${item.repeat.count} }, () => ${JSON.stringify(item.repeat.command)})`
    : JSON.stringify(item.commands).replace(/"\$(NaN|Infinity|-Infinity|undefined)"/g, "$1")
const expected = (item: Case): unknown =>
  item.error !== undefined
    ? { error: item.error }
    : { commands: (item.valid as Partial<Repeat>).repeat ? commands(item.valid as Case) : item.valid }

test("the fixtures cover every command, and failures and normalised forms", () => {
  const names = new Set(
    fixture.cases
      .flatMap((item) => (Array.isArray(item.commands) ? item.commands : []))
      .map((c) => (Array.isArray(c) ? c[0] : undefined)),
  )
  for (const name of [
    "save",
    "restore",
    "translate",
    "rotate",
    "scale",
    "alpha",
    "rect",
    "rrect",
    "circle",
    "line",
    "path",
    "text",
    "image",
  ])
    expect(names.has(name)).toBe(true)
  expect(fixture.cases.filter((item) => item.error !== undefined).length).toBeGreaterThan(50)
})

for (const item of fixture.cases) {
  test(`draw checks: ${item.name}`, async () => {
    const want = expected(item)
    expect(checkDraw(commands(item)) as unknown).toEqual(want)
    // A draw step: the commands cross as JSON reads them (undefined items null, non-finite numbers null).
    const source = `function view() { return ui.canvas({ key: "c", height: 1 }) }\nfunction draw() { return ${expression(item)} }`
    const frame = { id: ":c", t: 0, dt: 0, width: 10, height: 10, scale: 1, pointer: null, dark: false }
    const stepped = await draw(program(source), { data: null, state: {}, frame }, STEP).then(
      (output) => ({ commands: output.commands }),
      (error: { kind: string; message: string }) => ({ error: error.message }),
    )
    expect(stepped as unknown).toEqual(want)
    // A live draw post: the commands cross as they are.
    const widget = LiveWidget.start(
      program(
        `async function main() {\n  widget.render(ui.canvas({ key: "c", height: 1 }))\n  widget.draw("c", ${expression(item)})\n}`,
        "live",
      ),
      null,
      LIVE,
    )
    const end = await widget.done
    const posted: unknown =
      end.type === "error" ? { error: end.error.message } : { commands: widget.drawings.get(":c") ?? [] }
    expect(posted).toEqual(want)
  })
}
