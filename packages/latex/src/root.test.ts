import { describe, expect, test } from "bun:test"
import { renderLatex } from "./render"

describe("root geometry", () => {
  test.each([
    ["x", String.raw`\frac{1}{2}`],
    ["x", String.raw`\sqrt{n}`],
    ["x", "123456789"],
    ["x", String.raw`\frac{123456789}{\frac{n}{m}}`],
    [String.raw`\frac{a}{b}`, "3"],
    [String.raw`\sqrt{\frac{a}{b}}`, String.raw`\sqrt{\frac{n}{m}}`],
    [String.raw`\text{界}`, String.raw`\text{次}`],
    ["", String.raw`\frac{1}{2}`],
  ])("preserves body %s and index %s", (bodySource, indexSource) => {
    const body = renderLatex(bodySource, { color: "red" })
    const index = renderLatex(indexSource, { color: "blue" })
    const root = renderLatex(String.raw`\sqrt[\textcolor{blue}{${indexSource}}]{\textcolor{red}{${bodySource}}}`)
    const bodyX = root.width - body.width
    const bodyY = root.height - body.height

    expect(root.cells).toHaveLength(root.height)
    expect(root.baseline).toBe(bodyY + body.baseline)
    expect(bodyX).toBeGreaterThan(index.width)
    expect(bodyY).toBeGreaterThanOrEqual(index.height)
    for (const row of root.cells) expect(row).toHaveLength(root.width)
    for (const [y, row] of body.cells.entries()) {
      for (const [x, cell] of row.entries()) expect(root.cells[bodyY + y][bodyX + x]).toEqual(cell)
    }
    for (const [y, row] of index.cells.entries()) {
      for (const [x, cell] of row.entries()) expect(root.cells[y][x]).toEqual(cell)
    }
    expect(root.cells.flat().filter((cell) => cell?.style?.color === "red")).toHaveLength(
      body.cells.flat().filter(Boolean).length,
    )
    expect(root.cells.flat().filter((cell) => cell?.style?.color === "blue")).toHaveLength(
      index.cells.flat().filter(Boolean).length,
    )
  })

  test("connects each nested overbar to a full-height stem", () => {
    const root = renderLatex(String.raw`\sqrt{\sqrt{\sqrt{x}}}`)
    expect(root.toString()).toBe([" ╭─────", " │ ╭───", " │ │ ╭─", "╰╯╰╯╰╯x"].join("\n"))
    expect(root.height).toBe(4)
    expect(root.baseline).toBe(3)
    for (const depth of [0, 1, 2]) {
      for (let y = depth; y < root.height; y++) expect(root.cells[y][depth * 2 + 1]).toBeDefined()
    }
    expect(root.cells.flat().filter((cell) => cell?.char === "x")).toHaveLength(1)
  })

  test("extends a fraction root below the math axis without moving its baseline", () => {
    const root = renderLatex(String.raw`\sqrt{\frac{a}{b}}`)
    expect(root.toString()).toBe([" ╭───", " │ a", " │───", "╰╯ b"].join("\n"))
    expect(root.height).toBe(4)
    expect(root.baseline).toBe(2)
    for (let y = 0; y < root.height; y++) expect(root.cells[y][1]).toBeDefined()
    expect(root.cells[root.baseline].map((cell) => cell?.char ?? " ").join("")).toContain("───")
    expect(root.cells[root.height - 1].some((cell) => cell?.char === "b")).toBe(true)
  })

  test.each([
    [String.raw`\sqrt{x}`, [" ╭─", "╰╯x"]],
    [String.raw`\sqrt[3]{x}`, ["3╭─", "╰╯x"]],
    [String.raw`\sqrt[\frac{1}{2}]{x}`, [" 1", "───", " 2 ╭─", "  ╰╯x"]],
    [String.raw`\sqrt[\sqrt{n}]{x}`, [" ╭─", "╰╯n╭─", "  ╰╯x"]],
  ])("uses the same connected construction for %s", (source, expected) => {
    expect(renderLatex(source).toString()).toBe(expected.join("\n"))
  })
})
