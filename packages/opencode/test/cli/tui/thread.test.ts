import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import yargs from "yargs"
import { tmpdir } from "../../fixture/fixture"
import { MiniLocalCommand } from "../../../src/cli/cmd/mini"
import { TuiThreadCommand, resolveThreadDirectory } from "../../../src/cli/cmd/tui"
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

  test("parses supported mini --no-replay forms", async () => {
    for (const option of ["--no-replay", "--no-replay=true", "--noReplay"]) {
      const args = await yargs([])
        .command({ ...MiniLocalCommand, handler: () => {} })
        .exitProcess(false)
        .parse([option, "--replay-limit", "10"])

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

  cliIt.live("rejects removed top-level mini alias", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["--mini"])

      opencode.expectExit(result, 1)
      expect(result.stderr).not.toContain("opencode mini requires a TTY stdout")
    }),
  )

  cliIt.live("rejects removed run mini flag", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["run", "--mini"])

      opencode.expectExit(result, 1)
      expect(result.stderr).not.toContain("opencode mini requires a TTY stdout")
    }),
  )

  cliIt.live("routes local sessions through mini", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["mini"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("opencode mini requires a TTY stdout")
    }),
  )

  cliIt.live("routes attached sessions through mini attach", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["mini", "attach", "http://127.0.0.1:1"])

      opencode.expectExit(result, 1)
      expect(result.stderr).toContain("opencode mini requires a TTY stdout")
    }),
  )

  cliIt.live("rejects removed attach mini alias", ({ opencode }) =>
    Effect.gen(function* () {
      const result = yield* opencode.spawn(["attach", "http://127.0.0.1:1", "--mini"])

      opencode.expectExit(result, 1)
      expect(result.stderr).not.toContain("opencode mini requires a TTY stdout")
    }),
  )
})
