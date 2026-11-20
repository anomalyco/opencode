import { expect, test } from "bun:test"
import path from "node:path"
import { builtins, compile, prelude, program, step, version } from "../src/index.js"
import { backdrop, chart, confirm, form, minigame, suggestions } from "../src/source.js"

const src = path.resolve(import.meta.dir, "../src")

test("source.ts embeds the canonical .js files", async () => {
  expect(prelude).toBe(await Bun.file(path.join(src, "prelude.js")).text())
  expect(suggestions).toBe(await Bun.file(path.join(src, "templates/suggestions.js")).text())
  expect(form).toBe(await Bun.file(path.join(src, "templates/form.js")).text())
  expect(confirm).toBe(await Bun.file(path.join(src, "templates/confirm.js")).text())
  expect(chart).toBe(await Bun.file(path.join(src, "templates/chart.js")).text())
  expect(backdrop).toBe(await Bun.file(path.join(src, "templates/backdrop.js")).text())
  expect(minigame).toBe(await Bun.file(path.join(src, "templates/minigame.js")).text())
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
  expect(builtins.map((template) => template.version)).toEqual(
    builtins.map((template) => version(template.source, template.data, template.mode)),
  )
})

test("ui builders build every node type", async () => {
  const output = await step(
    program(`
      function view() {
        return ui.column({ gap: 1, align: "stretch" }, [
          ui.row([ui.text("a"), false, null, undefined, [ui.text(1, { style: "code", tone: "muted" })]]),
          ui.markdown("**b**"),
          ui.carousel({ id: "c", index: 1 }, [ui.image("x.png"), ui.image("y.png", { alt: "y", aspect: 2 })]),
          ui.card({ id: "card", selected: true }, ui.text("inside")),
          ui.button("go", "Go", { variant: "danger", disabled: true }),
          ui.checkbox("check", "Check", true),
          ui.checkbox("loose", "Loose", "yes"),
          ui.slider("size", { label: "Size", value: 2, min: 0, max: 4, step: 1 }),
          ui.select("pick", [{ value: "a", label: "A" }], { value: ["a"], multiple: true }),
          ui.input("name", undefined, { placeholder: "Name", multiline: true }),
          ui.divider(),
          ui.text("override", { type: "button" }),
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
        id: "c",
        index: 1,
        children: [
          { type: "image", src: "x.png" },
          { type: "image", src: "y.png", alt: "y", aspect: 2 },
        ],
      },
      { type: "card", id: "card", selected: true, children: [{ type: "text", text: "inside" }] },
      { type: "button", id: "go", label: "Go", variant: "danger", disabled: true },
      { type: "checkbox", id: "check", label: "Check", checked: true },
      { type: "checkbox", id: "loose", label: "Loose", checked: false },
      { type: "slider", id: "size", label: "Size", value: 2, min: 0, max: 4, step: 1 },
      { type: "select", id: "pick", options: [{ value: "a", label: "A" }], value: ["a"], multiple: true },
      { type: "input", id: "name", value: "", placeholder: "Name", multiline: true },
      { type: "divider" },
      { type: "text", text: "override" },
    ],
  })
})

test("version covers the mode and a live template's capabilities", () => {
  const data = { type: "object" } as const
  const hash = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16)
  const base = prelude + "\nsource\n" + JSON.stringify(data)
  expect(version("source", data, "step")).toBe(hash(base))
  expect(version("source", data, "live")).toBe(hash(base + "\nlive"))
  const capabilities = { https: { hosts: ["api.example.com"] } }
  expect(version("source", data, "live", capabilities)).toBe(hash(base + "\nlive\n" + JSON.stringify(capabilities)))
  expect(builtins.find((template) => template.name === "minigame")?.mode).toBe("live")
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
