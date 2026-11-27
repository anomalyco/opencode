import { expect, test } from "bun:test"
import { LiveWidget, ManualClock, program, step, type StepError } from "../src/index.js"
import { LIVE, STEP } from "./limits.js"

// A table's two events (specs/v2/widgets.md, Events): a row's press with its index to onPress, a header's press as
// `change` with the column's index to onSort; anything outside the rows or columns changes nothing.
const source = `
function init() { return { row: null, column: null } }
function view(state) {
  return ui.column([
    ui.text(state.row + " " + state.column),
    ui.table(["a", { label: "b", align: "end" }], [["x", 1], ["y", 2], ["z", 3]], {
      onPress: (state, row) => ({ ...state, row }),
      onSort: (state, column) => ({ ...state, column }),
    }),
  ])
}`

const text = (output: { readonly view: unknown }) => {
  const view = output.view as { children: { text?: string; id?: string }[] }
  return view.children[0]!.text
}

test("a step routes a row's press to onPress and a header's press to onSort, with checked indices", async () => {
  const init = await step(program(source), { phase: "init", data: null }, STEP)
  const id = (init.view as unknown as { children: { id?: string }[] }).children[1]!.id!
  const event = async (state: unknown, type: "press" | "change", value: unknown) =>
    text(await step(program(source), { phase: "event", data: null, state, event: { id, type, value } }, STEP))
  expect(await event(init.state, "press", 2)).toBe("2 null")
  expect(await event({ row: 2, column: null }, "change", 1)).toBe("2 1")
  for (const value of [3, -1, 1.5, "1", null]) expect(await event(init.state, "press", value)).toBe("null null")
  expect(await event(init.state, "change", 2)).toBe("null null")
})

test("a live table's handlers get only the index", async () => {
  const widget = LiveWidget.start(
    program(
      `async function main() {
        const show = (picked) => widget.render(ui.column([ui.text(picked), ui.table(["a", "b"], [["x", 1], ["y", 2]], {
          onPress: (row) => show("row " + row),
          onSort: (column) => show("column " + column),
        })]))
        show("none")
      }`,
      "live",
    ),
    {},
    { clock: new ManualClock(), ...LIVE },
  )
  const shown = (expected: string) =>
    widget.when((current) => {
      const view = current.view as { children?: { text?: string }[] } | undefined
      return view?.children?.[0]?.text === expected
    })
  await shown("none")
  const id = (widget.view as unknown as { children: { id?: string; selectable?: true; sortable?: true }[] })
    .children[1]!
  expect([id.selectable, id.sortable]).toEqual([true, true])
  widget.event({ id: id.id!, type: "press", value: 1 })
  await shown("row 1")
  widget.event({ id: id.id!, type: "change", value: 0 })
  await shown("column 0")
  await widget.stop()
})

test("a table with a row wider than its columns, or a sort or selection outside them, is an invalid view", async () => {
  const invalid = async (props: string, rows = `[["x"]]`) => {
    const failed = (await step(
      program(`function view() {\n  return ui.table(["a"], ${rows}, ${props})\n}`),
      { phase: "init", data: null },
      STEP,
    ).catch((error: unknown) => error)) as StepError
    return failed.message
  }
  expect(await invalid("{}", `[["x", "y"]]`)).toContain("a row has more cells than there are columns")
  expect(await invalid("{ sort: { column: 1 } }")).toContain("`sort.column` must be one of the columns")
  expect(await invalid("{ selected: 1 }")).toContain("`selected` must be one of the rows")
  expect(await invalid("{}", `[[{ a: 1 }]]`)).toBeDefined()
})
