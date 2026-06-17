import { describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"

describe("goal bootstrap integration", () => {
  test("instance bootstrap imports and initializes the native goal service", async () => {
    const bootstrap = await readFile(path.join(import.meta.dir, "..", "..", "src", "project", "bootstrap.ts"), "utf8")

    expect(bootstrap).toContain('import { Goal } from "@/goal"')
    expect(bootstrap).toContain("const goal = yield* Goal.Service")
    expect(bootstrap).toContain("yield* goal.init()")
    expect(bootstrap).toContain("Goal.defaultLayer")
    expect(bootstrap).toContain("Goal.node")
  })
})
