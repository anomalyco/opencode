import { expect, test } from "bun:test"
import path from "node:path"
import { builtins, compile, prelude, preludeLive, program, step, version } from "../src/index.js"
import { backdrop, chart, confirm, form, suggestions } from "../src/source.js"

const src = path.resolve(import.meta.dir, "../src")

test("source.ts embeds the canonical .js files", async () => {
  expect(prelude).toBe(await Bun.file(path.join(src, "prelude.js")).text())
  expect(suggestions).toBe(await Bun.file(path.join(src, "widget-templates/suggestions.js")).text())
  expect(form).toBe(await Bun.file(path.join(src, "widget-templates/form.js")).text())
  expect(confirm).toBe(await Bun.file(path.join(src, "widget-templates/confirm.js")).text())
  expect(chart).toBe(await Bun.file(path.join(src, "widget-templates/chart.js")).text())
  expect(backdrop).toBe(await Bun.file(path.join(src, "widget-templates/backdrop.js")).text())
})

test("program is the prelude, a newline, then the source", () => {
  expect(program("function view() {}")).toBe(prelude + "\nfunction view() {}")
})

test("version addresses the program and data schema", () => {
  const data = { type: "object" } as const
  const expected = new Bun.CryptoHasher("sha256")
    .update(prelude + "\nsource\n" + JSON.stringify(data))
    .digest("hex")
    .slice(0, 16)
  expect(version("source", data)).toBe(expected)
  expect(version("source", data)).toMatch(/^[0-9a-f]{16}$/)
  expect(version("source", { type: "array" })).not.toBe(expected)
  expect(builtins.map((widgetTemplate) => widgetTemplate.version)).toEqual(
    builtins.map((widgetTemplate) => version(widgetTemplate.source, widgetTemplate.data, widgetTemplate.mode)),
  )
})

test("ui builders build every node type", async () => {
  const output = await step(
    program(`
      function view() {
        return ui.column({ gap: 1, align: "stretch" }, [
          ui.row([ui.text("a"), false, null, undefined, [ui.text(1, { style: "code", tone: "muted" })]]),
          ui.markdown("**b**"),
          ui.carousel({ index: 1, onChange: (state) => state }, [ui.image("x.png"), ui.image("y.png", { alt: "y", aspect: 2 })]),
          ui.card({ selected: true, onPress: (state) => state }, ui.text("inside")),
          ui.card({ id: "ignored" }, []),
          ui.button("Go", { variant: "danger", disabled: true }),
          ui.checkbox("Check", true),
          ui.checkbox("Loose", "yes"),
          ui.slider({ label: "Size", value: 2, min: 0, max: 4, step: 1 }),
          ui.select([{ value: "a", label: "A" }, "b"], { value: ["a"], multiple: true }),
          ui.input(undefined, { placeholder: "Name", multiline: true }),
          ui.divider(),
          ui.text("override", { type: "button" }),
          ui.canvas({ height: 10 }),
          ui.canvas({ height: 10, key: "chart" }),
        ])
      }
    `),
    { phase: "init", data: null },
  )
  expect(output.view).toEqual({
    type: "column",
    gap: 1,
    align: "stretch",
    children: [
      {
        type: "row",
        children: [
          { type: "text", text: "a" },
          { type: "text", text: "1", style: "code", tone: "muted" },
        ],
      },
      { type: "markdown", text: "**b**" },
      {
        type: "carousel",
        id: "0/2",
        index: 1,
        children: [
          { type: "image", src: "x.png" },
          { type: "image", src: "y.png", alt: "y", aspect: 2 },
        ],
      },
      { type: "card", id: "0/3", selected: true, children: [{ type: "text", text: "inside" }] },
      { type: "card", children: [] },
      { type: "button", id: "0/5", label: "Go", variant: "danger", disabled: true },
      { type: "checkbox", id: "0/6", label: "Check", checked: true },
      { type: "checkbox", id: "0/7", label: "Loose", checked: false },
      { type: "slider", id: "0/8", label: "Size", value: 2, min: 0, max: 4, step: 1 },
      {
        type: "select",
        id: "0/9",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "b" },
        ],
        value: ["a"],
        multiple: true,
      },
      { type: "input", id: "0/10", value: "", placeholder: "Name", multiline: true },
      { type: "divider" },
      { type: "text", text: "override" },
      { type: "canvas", height: 10 },
      { type: "canvas", id: "0/:chart", height: 10 },
    ],
  })
})

test("version covers the mode and a live widget template's capabilities", () => {
  const data = { type: "object" } as const
  const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16)
  const base = prelude + "\nsource\n" + JSON.stringify(data)
  // A live widget template's program has the live prelude too.
  const live = prelude + "\n" + preludeLive + "\nsource\n" + JSON.stringify(data)
  expect(version("source", data, "step")).toBe(hash(base))
  expect(version("source", data, "live")).toBe(hash(live + "\nlive"))
  const capabilities = { https: { hosts: ["api.example.com"] } }
  expect(version("source", data, "live", capabilities)).toBe(hash(live + "\nlive\n" + JSON.stringify(capabilities)))
})

test("compile checks syntax without running, with lines counted in the source", () => {
  expect(compile("async function main() { while (true) await widget.sleep(1) }", "live")).toBeUndefined()
  expect(compile("function view() { return ui.text(1) }")).toBeUndefined()
  expect(compile("async function main() {\n  const x = (\n}", "live")).toEqual({
    message: "SyntaxError: Unexpected token. Code must be plain JavaScript written as a program body. (line 3, col 1)",
    line: 3,
    column: 1,
  })
  expect(compile("function view() { await x }")).toMatchObject({ line: 1 })
})
