import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../fixture/fixture"

const entry = path.join(import.meta.dir, "../../src/index.ts")

async function moks(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, entry, ...args, "--json", "--cwd", cwd], {
    cwd,
    env: {
      ...process.env,
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_TEST_HOME: Global.Path.home,
      HOME: Global.Path.home,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    json = undefined
  }
  return { code, stdout, stderr, json }
}

describe("decision cli smoke", () => {
  test("commit → push adverse needs confirm → push with confirm", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".moks"))

    const committed = await moks(["commit", "--action", "reject", "--reason", "fit"], tmp.path)
    expect(committed.code).toBe(0)
    const commitId = (committed.json as { receipt: { id: string } }).receipt.id
    expect(commitId.startsWith("dec_")).toBe(true)

    const blocked = await moks(["push", "--commit-id", commitId], tmp.path)
    expect(blocked.code).toBe(2)
    expect((blocked.json as { error: string }).error).toBe("needs_confirm")

    const pushed = await moks(["push", "--commit-id", commitId, "--confirm"], tmp.path)
    expect(pushed.code).toBe(0)
    expect((pushed.json as { ok: boolean; receipt: { state: string } }).ok).toBe(true)
    expect((pushed.json as { receipt: { state: string } }).receipt.state).toBe("pushed")

    const status = await moks(["status", "--limit", "10"], tmp.path)
    expect(status.code).toBe(0)
    expect((status.json as { open: unknown[] }).open).toEqual([])
  })
})
