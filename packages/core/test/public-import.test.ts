import { expect, test } from "bun:test"

test("imports the public skill module in a fresh process", async () => {
  const child = Bun.spawn([process.execPath, "-e", 'await import("@opencode-ai/core/skill")'], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
})
