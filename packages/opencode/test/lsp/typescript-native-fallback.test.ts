import { describe, test, expect, spyOn } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import * as LSPServer from "@/lsp/server"
import { Module } from "@opencode-ai/core/util/module"
import * as WhichModule from "@opencode-ai/core/util/which"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { tmpdir } from "../fixture/fixture"
import type { InstanceContext } from "@/project/instance-context"

function makeCtx(directory: string): InstanceContext {
  return { directory, worktree: "/", project: {} as any }
}

async function defaultFlags(): Promise<RuntimeFlags.Info> {
  return Effect.runPromise(Effect.gen(function* () { return yield* RuntimeFlags.Service }).pipe(Effect.provide(RuntimeFlags.layer())))
}

// typescript@7+ locked down its package.json `exports` map, so
// `require.resolve("typescript/lib/tsserver.js", ...)` throws
// ERR_PACKAGE_PATH_NOT_EXPORTED and Module.resolve returns undefined for it
// even when typescript is installed. Simulate that by forcing Module.resolve
// to return undefined, regardless of what's actually on disk.
describe("Typescript.spawn native fallback", () => {
  test("spawns local node_modules/.bin/tsc with --lsp -stdio when tsserver.js is unresolvable", async () => {
    await using tmp = await tmpdir()
    const root = tmp.path

    const binDir = path.join(root, "node_modules", ".bin")
    await fs.mkdir(binDir, { recursive: true })

    const ext = process.platform === "win32" ? ".cmd" : ""
    const tscPath = path.join(binDir, "tsc" + ext)
    const recordPath = path.join(root, "record.json")

    if (process.platform === "win32") {
      const implPath = path.join(binDir, "tsc-impl.js")
      await Bun.write(
        implPath,
        `const fs = require("fs")\nfs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))\n`,
      )
      await Bun.write(tscPath, `@echo off\r\nnode "${implPath}" %*\r\n`)
    } else {
      await Bun.write(
        tscPath,
        `#!/usr/bin/env node\nconst fs = require("fs")\nfs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))\n`,
      )
      await fs.chmod(tscPath, 0o755)
    }

    const spy = spyOn(Module, "resolve").mockReturnValue(undefined)
    try {
      const flags = await defaultFlags()
      const handle = await LSPServer.Typescript.spawn(root, makeCtx(root), flags)
      expect(handle).toBeDefined()
      if (!handle) return

      await new Promise<void>((resolve) => handle.process.once("exit", () => resolve()))
      expect(handle.initialization).toBeUndefined()

      const recorded = JSON.parse(await fs.readFile(recordPath, "utf-8"))
      expect(recorded.argv).toEqual(["--lsp", "-stdio"])
      expect(recorded.cwd).toBe(await fs.realpath(root))
    } finally {
      spy.mockRestore()
    }
  })

  test("returns undefined when neither tsserver.js nor a tsc binary can be found", async () => {
    await using tmp = await tmpdir()
    const root = tmp.path

    const resolveSpy = spyOn(Module, "resolve").mockReturnValue(undefined)
    // No local node_modules/.bin/tsc, and stub out PATH lookup so this
    // assertion doesn't depend on whether the host machine happens to have
    // a global `tsc` installed.
    const whichSpy = spyOn(WhichModule, "which").mockReturnValue(null)
    try {
      const flags = await defaultFlags()
      const handle = await LSPServer.Typescript.spawn(root, makeCtx(root), flags)
      expect(handle).toBeUndefined()
    } finally {
      resolveSpy.mockRestore()
      whichSpy.mockRestore()
    }
  })
})
