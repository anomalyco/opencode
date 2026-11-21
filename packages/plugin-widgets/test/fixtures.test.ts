import { expect, test } from "bun:test"
import { draw, program, step } from "@opencode/widget"
import { WidgetLint } from "../src/lint.js"

// Step examples the skill used to carry, kept as tested fixtures: they lint and run on the reference runtime.
const fixture = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text()
const frame = { id: "0/1", t: 1, dt: 1 / 60, width: 300, height: 120, scale: 2, pointer: null, dark: true }

test("the canvas gauge fixture lints, renders and draws", async () => {
  const source = await fixture("canvas-gauge.js")
  expect(WidgetLint.lint(source, "step")).toEqual([])
  const output = await step(program(source), { phase: "init", data: { title: "Disk", value: 72 } })
  expect(JSON.stringify(output.view)).toContain('"type":"canvas"')
  const data = { title: "Disk", value: 72 }
  const drawn = await draw(program(source), { data, state: output.state, frame })
  expect(JSON.stringify(drawn)).toContain("72%")
  const pointer = { kind: "up" as const, x: 10, y: 10, width: 300, height: 120 }
  const tapped = await step(program(source), {
    phase: "event",
    data,
    state: output.state,
    event: { id: "0/1", type: "pointer", value: pointer },
  })
  expect(tapped.state).toEqual({ label: false })
  expect(JSON.stringify(await draw(program(source), { data, state: tapped.state, frame }))).not.toContain("72%")
})

test("the color shader fixture lints and follows its slider", async () => {
  const source = await fixture("color-shader.js")
  expect(WidgetLint.lint(source, "step")).toEqual([])
  const first = await step(program(source), { phase: "init", data: {} })
  const next = await step(program(source), {
    phase: "event",
    data: {},
    state: first.state,
    event: { id: "0/1", type: "change", value: 2 },
  })
  expect(JSON.stringify(next.view)).toContain('"values":[2]')
  const focused = await step(program(source), {
    phase: "event",
    data: {},
    state: next.state,
    event: { id: "", type: "focus", value: true },
  })
  expect(focused.state).toEqual(next.state)
})
