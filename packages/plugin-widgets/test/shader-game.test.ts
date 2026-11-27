import { expect, test } from "bun:test"
import { $ } from "bun"
import path from "node:path"
import { LiveWidget, ManualClock, type Node, program } from "@opencode/widget"
import { WidgetLint } from "../src/lint.js"

// A complete shader game (a raymarched tunnel runner), run on the reference live host the way a client would run it.
const source = await Bun.file(new URL("./fixtures/tunnel-runner.js", import.meta.url)).text()

const shader = (node: Node | undefined): Extract<Node, { type: "canvas" }> | undefined => {
  if (!node) return
  if (node.type === "canvas" && node.wgsl !== undefined) return node
  return "children" in node ? node.children.map(shader).find((found) => found !== undefined) : undefined
}
const texts = (node: Node | undefined): string[] =>
  node
    ? [...(node.type === "text" ? [node.text] : []), ...("children" in node ? node.children.flatMap(texts) : [])]
    : []

test("the shader game example passes the lint", () => {
  expect(WidgetLint.lint(source, "live")).toEqual([])
})

test("the shader game renders its shader every frame, jumps on a tap and submits a score", async () => {
  const clock = new ManualClock()
  const widget = LiveWidget.start(program(source, "live"), { title: "Run", seconds: 60 }, { clock, busyMs: 2000 })
  await widget.when((current) => shader(current.view) !== undefined)
  const frame = { t: 0, dt: 1 / 60, width: 360, height: 280, scale: 2, pointer: null, dark: true }
  const tap = () =>
    widget.event({ id: "0/1", type: "pointer", value: { kind: "down", x: 180, y: 140, width: 360, height: 280 } })

  // Jump every barrier until two are cleared, then stop jumping and crash into the next one.
  let jumped = false
  for (let index = 0; index < 5_000 && !texts(widget.view).some((text) => text.startsWith("Crashed")); index++) {
    await widget.when(
      (current) => current.frameRequested || texts(current.view).some((text) => text.startsWith("Crashed")),
    )
    const values = shader(widget.view)?.values ?? []
    const [height = 0, , gap = 99, score = 0] = values
    if (score < 2 && gap < 3 && height === 0) {
      tap()
      jumped = true
    }
    if (!widget.frameRequested) break
    await clock.advance(16)
    widget.frame({ ...frame, t: index / 60 })
  }
  expect(jumped).toBe(true)
  expect(texts(widget.view)).toContain("Crashed after 2 barriers")
  widget.event({ id: "0/1", type: "press" })
  expect(await widget.done).toMatchObject({ type: "submit", value: { score: 2 } })
})

// Clients compile the shader with naga (Rune, mobile); check the same wrapped module when its CLI is installed.
test.skipIf(Bun.which("naga") === null)("the shader game's WGSL validates with naga", async () => {
  const wgsl = source.slice(
    source.indexOf("const WGSL = `") + 14,
    source.indexOf("`", source.indexOf("const WGSL = `") + 14),
  )
  const file = path.join(await $`mktemp -d`.text().then((dir) => dir.trim()), "shader.wgsl")
  await Bun.write(
    file,
    "struct Widget { resolution: vec2f, time: f32, scale: f32, pointer: vec4f, values: array<vec4f, 4> }\n" +
      "@group(0) @binding(0) var<uniform> widget: Widget;\n" +
      wgsl +
      "\n@fragment fn widget_main(@builtin(position) p: vec4f) -> @location(0) vec4f { return shade(p.xy); }\n",
  )
  expect((await $`naga ${file}`.quiet().nothrow()).exitCode).toBe(0)
})
