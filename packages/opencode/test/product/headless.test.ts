import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../fixture/fixture"
import { cliIt } from "../lib/cli-process"

const entry = path.join(import.meta.dir, "../../src/index.ts")

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

describe("headless surface", () => {
  test("run --help documents --json", async () => {
    const proc = Bun.spawn([process.execPath, entry, "run", "--help"], {
      cwd: path.dirname(entry),
      env: {
        ...process.env,
        MOKS_PURE: "1",
        MOKS_DISABLE_PROJECT_CONFIG: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const help = stdout + stderr
    expect(code).toBe(0)
    expect(help).toMatch(/--json/)
    expect(help).toMatch(/--format/)
  })

  test("commit / status / push --json exit codes", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".moks"))

    const committed = await moks(["commit", "--action", "note", "--reason", "headless"], tmp.path)
    expect(committed.code).toBe(0)
    expect(committed.json).toBeDefined()
    const commitId = (committed.json as { receipt: { id: string } }).receipt.id
    expect(commitId.startsWith("dec_")).toBe(true)

    const status = await moks(["status", "--limit", "5"], tmp.path)
    expect(status.code).toBe(0)
    expect((status.json as { open: { id: string }[] }).open.some((r) => r.id === commitId)).toBe(true)

    const pushed = await moks(["push", "--commit-id", commitId], tmp.path)
    expect(pushed.code).toBe(0)
    expect((pushed.json as { ok: boolean }).ok).toBe(true)
  })

  test("push --json adverse needs_confirm exits 2", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".moks"))

    const committed = await moks(["commit", "--action", "reject", "--reason", "fit"], tmp.path)
    expect(committed.code).toBe(0)
    const commitId = (committed.json as { receipt: { id: string } }).receipt.id

    const blocked = await moks(["push", "--commit-id", commitId], tmp.path)
    expect(blocked.code).toBe(2)
    expect((blocked.json as { error: string }).error).toBe("needs_confirm")
  })
})


cliIt.concurrent(
  "run --json emits NDJSON events and exits 0",
  ({ llm, opencode }) =>
    Effect.gen(function* () {
      yield* llm.text("headless json ok")
      const result = yield* opencode.run("ping", {
        format: undefined,
        extraArgs: ["--json"],
        timeoutMs: 45_000,
      })
      opencode.expectExit(result, 0, "moks run --json")
      const events = opencode.parseJsonEvents(result.stdout)
      expect(events.some((e) => e.type === "text")).toBe(true)
      const text = events.find((e) => e.type === "text")
      expect(JSON.stringify(text)).toContain("headless json ok")
    }),
  60_000,
)
