import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer, type FileSystem, type Path } from "effect"
import { checkAppExists, resolveAppPath } from "./apps"

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))))

const saved = { PATH: process.env.PATH, LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles }

let root = ""

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "opencode-apps-"))
  // Nothing on the PATH, so `where` finds nothing and only the installers' own folders can answer.
  process.env.PATH = ""
  process.env.LOCALAPPDATA = path.join(root, "local")
  process.env.ProgramFiles = path.join(root, "programs")
})

afterEach(() => {
  Object.assign(process.env, saved)
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform !== "win32")("Windows app detection", () => {
  test("finds an app that is not on the PATH in its installer's folder, and reports a missing one as absent", async () => {
    const alias = path.join(root, "local", "Microsoft", "WindowsApps", "wt.exe")
    mkdirSync(path.dirname(alias), { recursive: true })
    writeFileSync(alias, "")

    expect(await run(resolveAppPath("wt"))).toBe(alias)
    expect(await run(checkAppExists("wt"))).toBe(true)
    expect(await run(checkAppExists("Sublime Text"))).toBe(false)
    expect(await run(checkAppExists("code"))).toBe(false)
  })
})

describe.skipIf(process.platform !== "linux")("Linux app detection", () => {
  test("lists only commands that are executable files on the PATH", async () => {
    writeFileSync(path.join(root, "subl"), "#!/bin/sh\n")
    chmodSync(path.join(root, "subl"), 0o755)
    writeFileSync(path.join(root, "zed"), "")
    chmodSync(path.join(root, "zed"), 0o644)
    process.env.PATH = root

    expect(await run(checkAppExists("subl"))).toBe(true)
    expect(await run(checkAppExists("zed"))).toBe(false)
    expect(await run(checkAppExists("code"))).toBe(false)
  })
})
