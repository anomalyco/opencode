import { describe, expect, test } from "bun:test"
import path from "node:path"

const sourcePath = path.join(import.meta.dir, "../../../core/src/tool/builtins.ts")

describe("closure Protocol V2 boundary", () => {
  test("keeps Protocol V2 an explicit non-participant while Task remains unported", async () => {
    const source = await Bun.file(sourcePath).text()
    const location = source.match(/export const node = makeLocationNode\(\{([\s\S]*?)\r?\n\}\)/)?.[1]
    const todo = source.match(/TODO: Port the remaining launch-follow-up leaves deliberately:([\s\S]*?)\*\//)?.[1]
    const layers = Array.from(location?.matchAll(/(\w+Tool)\.node/g) ?? [], (match) => match[1])

    expect(location).toBeDefined()
    expect(layers.length).toBeGreaterThan(0)
    expect(layers).toContain("BashTool")
    expect(layers).toContain("QuestionTool")
    expect(layers).not.toContain("TaskTool")
    expect(source).not.toMatch(/from ["'][^"']*\/task["']/)
    expect(todo).toBeDefined()
    expect(todo).toMatch(/\btask\b/)
  })
})
