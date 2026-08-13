import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { CandidateCard } from "../../src/product/candidate-card"
import { DecisionAts } from "../../src/decision/ats"
import { tmpdir } from "../fixture/fixture"

const entry = path.join(import.meta.dir, "../../src/index.ts")
const SHA = /^[0-9a-f]{7,64}$/

async function moks(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, entry, ...args, "--json", "--cwd", cwd], {
    cwd,
    env: {
      ...process.env,
      MOKS_PURE: "1",
      MOKS_DISABLE_PROJECT_CONFIG: "1",
      MOKS_TEST_HOME: Global.Path.home,
      HOME: Global.Path.home,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  const stdout = out[0]
  const stderr = out[1]
  const code = out[2]
  const parsed = (() => {
    if (!stdout.trim()) return
    return JSON.parse(stdout) as unknown
  })()
  return { code, stdout, stderr, json: parsed }
}

describe("decision cli smoke", () => {
  test("commit → push adverse needs confirm → push with confirm", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "HIRING.md"), "# Role\n")
        await CandidateCard.write(dir, {
          id: "cand_ada",
          stage: "sourced",
          extra: { name: "Ada" },
          body: "# Ada\n",
        })
      },
    })

    const committed = await moks(
      ["commit", "--action", "reject", "--target-id", "cand_ada", "--reason", "fit"],
      tmp.path,
    )
    expect(committed.code).toBe(0)
    const commitId = (committed.json as { receipt: { id: string } }).receipt.id
    expect(commitId).toMatch(SHA)

    const blocked = await moks(["push", "--commit-id", commitId], tmp.path)
    expect(blocked.code).toBe(2)
    expect((blocked.json as { error: string }).error).toBe("needs_confirm")

    const pushed = await moks(["push", "--commit-id", commitId, "--confirm", "--execute"], tmp.path)
    expect(pushed.code).toBe(0)
    expect((pushed.json as { ok: boolean; receipt: { state: string } }).ok).toBe(true)
    expect((pushed.json as { receipt: { state: string } }).receipt.state).toBe("pushed")

    const cache = await DecisionAts.loadCache(tmp.path)
    expect(cache.candidates.some((item) => item.id === "cand_ada" && item.stage === "reject")).toBe(true)

    const status = await moks(["status", "--limit", "10"], tmp.path)
    expect(status.code).toBe(0)
    expect((status.json as { open: unknown[] }).open).toEqual([])
  })
})
