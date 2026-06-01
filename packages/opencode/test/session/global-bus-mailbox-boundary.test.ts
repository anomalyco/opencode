import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const sourceRoots = ["src/session", "src/background", "src/tool"]

async function typescriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return typescriptFiles(path)
      if (entry.isFile() && path.endsWith(".ts")) return [path]
      return []
    }),
  )
  return files.flat()
}

describe("GlobalBus mailbox boundary", () => {
  test("session, background, and task sources do not depend on GlobalBus as queue state", async () => {
    const files = (await Promise.all(sourceRoots.map(typescriptFiles))).flat()
    const offenders = [] as string[]

    for (const file of files) {
      const source = await readFile(file, "utf8")
      if (/from\s+["']@\/bus\/global["']|from\s+["']\.\.\/bus\/global["']|GlobalBus\./.test(source)) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })
})
