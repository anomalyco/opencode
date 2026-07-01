import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import yargs from "yargs"
import { tmpdir } from "../../fixture/fixture"
import {
  hasExplicitNetworkOptions,
  resolveAutoAttachTarget,
  TuiThreadCommand,
  resolveThreadDirectory,
} from "../../../src/cli/cmd/tui"
import { cliIt } from "../../lib/cli-process"

describe("tui thread", () => {
  test("loads the TUI integration lazily", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/tui.ts", import.meta.url)).text()

    expect(source).toContain('await import("../tui/layer")')
    expect(source).toMatch(/await import\(["']@\/plugin\/tui\/runtime["']\)/)
    expect(source).not.toContain('import("./app")')
  })

  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"

    try {
      await fs.symlink(tmp.path, link, type)
      expect(resolveThreadDirectory(project, link, tmp.path)).toBe(tmp.path)
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("resolves a relative mini project from PWD when cwd differs", async () => {
    await using pwd = await tmpdir({ git: true })
    await using cwd = await tmpdir({ git: true })

    expect(resolveThreadDirectory(".", pwd.path, cwd.path)).toBe(pwd.path)
    expect(resolveThreadDirectory(undefined, pwd.path, cwd.path)).toBe(cwd.path)
  })

  test("parses supported --no-replay forms", async () => {
    for (const option of ["--no-replay", "--no-replay=true", "--noReplay"]) {
      const args = await yargs([])
        .command({ ...TuiThreadCommand, handler: () => {} })
        .exitProcess(false)
        .parse(["--mini", option, "--replay-limit", "10"])

      expect(args.replay === false || args.noReplay === true).toBe(true)
      expect(args.replayLimit).toBe(10)
    }
  })

  test("preserves boolean negation for existing options", async () => {
    const args = await yargs([])
      .command({ ...TuiThreadCommand, handler: () => {} })
      .exitProcess(false)
      .parse(["--mdns", "--no-mdns"])

    expect(args.mdns).toBe(false)
  })

  cliIt.live("rejects mini-only options without --mini", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["--replay-limit", "10"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("--replay-limit requires --mini")
    }),
  )

  cliIt.live("routes attached sessions to mini mode", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["attach", "http://127.0.0.1:1", "--mini"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("--mini requires a TTY stdout")
    }),
  )

  cliIt.live("rejects network options in mini mode", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["--mini", "--port", "4096"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("--port cannot be used with --mini")
    }),
  )

  test("does not probe when server.attach is not configured", async () => {
    let called = false
    const result = await resolveAutoAttachTarget({
      fetch: async () => {
        called = true
        return Response.json({ healthy: true })
      },
    })

    expect(result.type).toBe("embedded")
    expect(called).toBe(false)
  })

  test("attaches when the configured server is healthy", async () => {
    const requests: URL[] = []
    let headers: RequestInit["headers"]
    const result = await resolveAutoAttachTarget({
      url: "http://localhost:4096/",
      headers: { Authorization: "Basic test" },
      fetch: async (input, init) => {
        requests.push(input instanceof URL ? input : new URL(input.toString()))
        headers = init?.headers
        return Response.json({ healthy: true, version: "dev" })
      },
    })

    expect(result).toEqual({
      type: "attach",
      url: "http://localhost:4096/",
      headers: { Authorization: "Basic test" },
    })
    expect(requests.map((item) => item.toString())).toEqual(["http://localhost:4096/global/health"])
    expect(headers).toEqual({ Authorization: "Basic test" })
  })

  test("starts a local configured server when it is unreachable", async () => {
    const requests: URL[] = []
    const spawns: { hostname: string; port: number; shutdownAfterLastClient: boolean }[] = []
    let attempts = 0
    const result = await resolveAutoAttachTarget({
      url: "http://localhost:4096",
      startupAttempts: 2,
      startupDelayMs: 0,
      fetch: async (input) => {
        requests.push(input instanceof URL ? input : new URL(input.toString()))
        attempts++
        if (attempts === 1) throw new Error("ECONNREFUSED")
        return Response.json({ healthy: true, version: "dev" })
      },
      spawn: (input) => {
        spawns.push(input)
      },
    })

    expect(result).toEqual({ type: "attach", url: "http://localhost:4096", headers: undefined })
    expect(requests.map((item) => item.toString())).toEqual([
      "http://localhost:4096/global/health",
      "http://localhost:4096/global/health",
    ])
    expect(spawns).toEqual([{ hostname: "localhost", port: 4096, shutdownAfterLastClient: true }])
  })

  test("reports unreachable remote servers instead of falling back", async () => {
    const result = await resolveAutoAttachTarget({
      url: "http://192.168.1.100:4096",
      fetch: async () => {
        throw new Error("ECONNREFUSED")
      },
    })

    expect(result).toEqual({ type: "fatal", message: "server.attach target is unreachable" })
  })

  test("reports local startup failures", async () => {
    const result = await resolveAutoAttachTarget({
      url: "http://127.0.0.1:4096",
      fetch: async () => {
        throw new Error("ECONNREFUSED")
      },
      spawn: () => {
        throw new Error("spawn failed")
      },
    })

    expect(result).toEqual({ type: "fatal", message: "Failed to start server.attach target: spawn failed" })
  })

  test("reports authentication failures instead of falling back", async () => {
    const result = await resolveAutoAttachTarget({
      url: "http://localhost:4096",
      fetch: async () => new Response(undefined, { status: 401 }),
    })

    expect(result).toEqual({ type: "fatal", message: "server.attach authentication failed" })
  })

  test("reports invalid attach urls", async () => {
    const result = await resolveAutoAttachTarget({
      url: "not a url",
    })

    expect(result.type).toBe("fatal")
  })

  test("reports non-opencode health responses", async () => {
    const result = await resolveAutoAttachTarget({
      url: "http://localhost:4096",
      fetch: async () => Response.json({ ok: true }),
    })

    expect(result).toEqual({
      type: "fatal",
      message: "server.attach target is not a healthy opencode server",
    })
  })

  test("skips auto attach when network options are explicit", () => {
    expect(hasExplicitNetworkOptions(["opencode", "--port", "4096"])).toBe(true)
    expect(hasExplicitNetworkOptions(["opencode", "--hostname=0.0.0.0"])).toBe(true)
    expect(hasExplicitNetworkOptions(["opencode", "--cors", "http://localhost:5173"])).toBe(true)
    expect(hasExplicitNetworkOptions(["opencode"])).toBe(false)
  })
})
