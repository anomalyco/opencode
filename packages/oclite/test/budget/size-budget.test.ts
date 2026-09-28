import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../lib/tmp"

const script = path.resolve(import.meta.dir, "../../scripts/size-budget.ts")

async function budget(dir?: string) {
  const proc = Bun.spawn([process.execPath, script, ...(dir ? [dir] : [])], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

const lines = (count: number) => Array.from({ length: count }, (_, index) => `export const v${index} = ${index}`).join("\n") + "\n"

describe("size budget", () => {
  test("passes on src", async () => {
    const result = await budget()
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("size budget ok")
  })

  test("fails when there are more than 45 files", async () => {
    await using dir = await tmpdir({
      files: Object.fromEntries(Array.from({ length: 46 }, (_, index) => [`f${index}.ts`, lines(1)])),
    })
    const result = await budget(dir.path)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("file count 46 > 45")
  })

  test("fails over 7000 lines, and forked/ lines are not counted", async () => {
    await using over = await tmpdir({ files: { "a.ts": lines(4000), "b/c.ts": lines(3001) } })
    const result = await budget(over.path)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("line count 7001 > 7000")

    await using forked = await tmpdir({ files: { "a.ts": lines(6000), "forked/big.ts": lines(5000) } })
    const ok = await budget(forked.path)
    expect(ok.code).toBe(0)
    expect(ok.stdout).toContain("forked: 1 files, 5000 lines")
  })
})
