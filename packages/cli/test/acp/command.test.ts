import { describe, expect, test } from "bun:test"
import path from "node:path"

describe("acp command", () => {
  test("is registered", async () => {
    const result = await cli(["--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^  acp[ \t]+Start an Agent Client Protocol server\r?$/m)
  })
})

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
