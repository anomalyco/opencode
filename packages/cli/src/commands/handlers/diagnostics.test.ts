import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { bytes, executablesOnPath, inspect, isOrphanedTemp } from "./diagnostics"

describe("isOrphanedTemp", () => {
  test("matches the temp-then-rename leftovers", () => {
    expect(isOrphanedTemp("opencode.db.82072.tmp")).toBe(true)
    expect(isOrphanedTemp("packed-refs.44330.3f2a1c80-1b2e-4f6a.tmp")).toBe(true)
  })

  test("ignores real data files", () => {
    expect(isOrphanedTemp("opencode.db")).toBe(false)
    expect(isOrphanedTemp("opencode.log")).toBe(false)
    expect(isOrphanedTemp("tmp")).toBe(false)
  })
})

describe("bytes", () => {
  test("scales to a readable unit", () => {
    expect(bytes(0)).toBe("0 B")
    expect(bytes(1023)).toBe("1023 B")
    expect(bytes(1024)).toBe("1.0 KB")
    expect(bytes(1024 * 1024 * 1.5)).toBe("1.5 MB")
    expect(bytes(1024 ** 3)).toBe("1.0 GB")
  })
})

describe("inspect", () => {
  test("totals the tree and counts orphaned temp files", async () => {
    const root = join(tmpdir(), `opencode-doctor-${crypto.randomUUID()}`)
    await mkdir(join(root, "storage"), { recursive: true })
    await writeFile(join(root, "storage", "part.json"), "x".repeat(10))
    await writeFile(join(root, "storage", "part.json.999.tmp"), "")
    await writeFile(join(root, "opencode.db"), "y".repeat(100))

    const report = await inspect(root, join(root, "opencode.db"))
    expect(report.orphaned).toBe(1)
    expect(report.total).toBe(110)
    expect(report.children).toEqual([["storage", "10 B"]])
    expect(report.database.size).toBe("100 B")
  })
})

describe("executablesOnPath", () => {
  test("reports every opencode executable on PATH", async () => {
    const root = join(tmpdir(), `opencode-doctor-path-${crypto.randomUUID()}`)
    const first = join(root, "a")
    const second = join(root, "b")
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    await writeFile(join(first, "opencode"), "")
    await writeFile(join(second, "opencode"), "")

    expect(await executablesOnPath({ PATH: [first, second].join(":") })).toEqual([
      join(first, "opencode"),
      join(second, "opencode"),
    ])
    expect(await executablesOnPath({ PATH: first })).toEqual([join(first, "opencode")])
  })
})
