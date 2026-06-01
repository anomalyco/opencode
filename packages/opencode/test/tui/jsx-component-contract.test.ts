import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const tuiRoot = path.resolve(import.meta.dir, "../../src/cli/cmd/tui")

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return files(full)
      if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) return Promise.resolve([full])
      return Promise.resolve([])
    }),
  )
  return nested.flat()
}

describe("TUI JSX component contract", () => {
  test("does not cast intrinsic tag strings into callable components", async () => {
    const offenders: string[] = []

    for (const file of await files(tuiRoot)) {
      const source = await readFile(file, "utf8")
      if (!/as\s+unknown\s+as\s*\([^)]*JSX\.IntrinsicElements/.test(source)) continue
      offenders.push(path.relative(tuiRoot, file))
    }

    expect(offenders).toEqual([])
  })
})
