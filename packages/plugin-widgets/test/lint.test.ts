import { expect, test } from "bun:test"
import { builtins } from "@opencode/widget/widget-template"
import { WidgetLint } from "../src/lint.js"

test("every built-in widget template passes the lint", () => {
  for (const widgetTemplate of builtins)
    expect([widgetTemplate.name, WidgetLint.lint(widgetTemplate.source, widgetTemplate.mode)]).toEqual([
      widgetTemplate.name,
      [],
    ])
})

test("reports shape problems with their positions, without running anything", () => {
  const source = [
    "const COLORS = ['red', 'blue']",
    "const started = Date.now()",
    "let count = 0",
    "widget.render(ui.text('hi'))",
    "function submit(value) { return value }",
    "function update(state) { return state }",
  ].join("\n")
  expect(WidgetLint.lint(source, "step")).toEqual([
    { message: "a step widget template must define `function view(state, data)`" },
    { message: "top-level constants must not run code (calls, `new`, assignments)", line: 2, column: 17 },
    {
      message: "only function and `const` declarations may appear at the top level; nothing runs when it loads",
      line: 3,
      column: 1,
    },
    {
      message: "only function and `const` declarations may appear at the top level; nothing runs when it loads",
      line: 4,
      column: 1,
    },
    { message: "`submit` is defined by the widget prelude; use another name", line: 5, column: 1 },
    {
      message: expect.stringContaining("`update(state, event)` is gone: attach handlers to nodes"),
      line: 6,
      column: 1,
    },
  ])
})

test("ui.shader is reported with what replaces it", () => {
  expect(WidgetLint.lint('function view() { return ui.shader("x", { height: 1 }) }', "step")).toEqual([
    { message: "`ui.shader` is gone: a GPU canvas is `ui.canvas({ wgsl, values, height, ... })`", line: 1, column: 26 },
  ])
})

test("the removed event API is reported with what replaces it", () => {
  const source = [
    "async function main() {",
    "  const event = await widget.event()",
    "  const next = await widget.next({ frame: true })",
    "}",
  ].join("\n")
  expect(WidgetLint.lint(source, "live")).toEqual([
    { message: expect.stringContaining("`widget.event()` is gone"), line: 2, column: 23 },
    { message: expect.stringContaining("`widget.next()` is gone: await `widget.frame()`"), line: 3, column: 22 },
  ])
})

test("live widget templates need an async main; arrow functions in constants run later and are fine", () => {
  expect(WidgetLint.lint("function main(data) {}", "live")).toEqual([
    { message: "a live widget template must define `async function main(data)`" },
  ])
  expect(WidgetLint.lint("const main = async (data) => widget.render(ui.text(data.title))", "live")).toEqual([])
  expect(WidgetLint.lint("const view = (state, data) => ui.text(data.title)", "step")).toEqual([])
})

test("syntax errors carry the parser's position and oversized sources are refused", () => {
  expect(WidgetLint.lint("function view( {", "step")).toMatchObject([{ line: 1, column: 17 }])
  expect(WidgetLint.lint("//" + "x".repeat(WidgetLint.MAX_SOURCE_BYTES), "step")).toEqual([
    { message: "the source is over 128 KB" },
  ])
})

test("the plugin never imports a widget runner", async () => {
  const sources = await Promise.all(
    ["index.ts", "widget-templates.ts", "tools.ts", "lint.ts"].map((file) =>
      Bun.file(new URL(`../src/${file}`, import.meta.url)).text(),
    ),
  )
  for (const source of sources) {
    // The package root re-exports the step and live runners; only data subpaths are allowed.
    expect(source).not.toMatch(/from "@opencode\/widget"/)
    expect(source).not.toMatch(/@opencode\/widget\/(session|live|compile)/)
    expect(source).not.toMatch(/\bRuntime\b|\bstep\(/)
  }
})
