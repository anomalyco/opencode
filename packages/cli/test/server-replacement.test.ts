import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("closes the old server before spawning a persistent replacement", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-replacement-"))
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/server-replacement.ts")], {
    env: {
      ...globalThis.process.env,
      HOME: root,
      OPENCODE_DB: path.join(root, "opencode.db"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const line = stdout.split("\n").find((line) => line.startsWith("RESULT "))
  const result = line ? JSON.parse(line.slice("RESULT ".length)) : undefined

  try {
    expect(exitCode, stderr || stdout).toBe(0)
    expect(result?.replacementPID).toBeGreaterThan(0)
    expect(result?.replacementPID).not.toBe(result?.oldPID)
    const response = await waitForReplacement(result.url)
    expect(await response.json()).toEqual({ process: "replacement", pid: result.replacementPID })
  } finally {
    if (result?.replacementPID) globalThis.process.kill(result.replacementPID, "SIGTERM")
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function waitForReplacement(url: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => undefined)
    if (response?.ok) return response
    await Bun.sleep(25)
  }
  throw new Error("Replacement server did not bind the released port")
}
