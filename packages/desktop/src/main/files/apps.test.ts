import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { checkAppExists } from "./apps"

const installed = (appName: string) =>
  Effect.runPromise(checkAppExists(appName).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))))

describe("open-in app detection", () => {
  const app = "opencode-test-editor"
  const plain = "opencode-plain-file"
  const path = process.env.PATH
  let dir = ""

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "opencode-apps-"))
    // `where` resolves commands through PATHEXT on Windows; elsewhere the launcher must be an executable file.
    const file = join(dir, process.platform === "win32" ? `${app}.exe` : app)
    writeFileSync(file, "#!/bin/sh\n")
    chmodSync(file, 0o755)
    writeFileSync(join(dir, plain), "")
    chmodSync(join(dir, plain), 0o644)
    process.env.PATH = `${dir}${delimiter}${path ?? ""}`
  })

  afterAll(() => {
    process.env.PATH = path
    rmSync(dir, { recursive: true, force: true })
  })

  test.each([
    { name: "an app whose command is on PATH", appName: app, expected: true },
    { name: "an app that is not installed", appName: "opencode-missing-editor", expected: false },
    // Windows has no execute bit: `where` lists any file on PATH, so only POSIX can reject a non-executable one.
    ...(process.platform === "win32"
      ? []
      : [{ name: "a non-executable file on PATH", appName: plain, expected: false }]),
  ])("reports $name", async ({ appName, expected }) => {
    expect(await installed(appName)).toBe(expected)
  })
})
