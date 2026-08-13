import { afterEach, expect, test } from "vitest"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { prepareDev } from "../../src/instance/dev.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("uses standalone mode and inheritable preloads for V2 development checkouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-drive-dev-"))
  const artifacts = await mkdtemp(join(tmpdir(), "opencode-drive-artifacts-"))
  directories.push(root, artifacts)
  await mkdir(join(root, "packages", "cli", "src", "services"), { recursive: true })
  await mkdir(join(root, "packages", "tui", "node_modules", "@opentui", "solid"), { recursive: true })
  await Promise.all([
    Bun.write(join(root, "packages", "cli", "src", "index.ts"), ""),
    Bun.write(join(root, "packages", "cli", "src", "services", "standalone.ts"), ""),
    Bun.write(join(root, "packages", "tui", "node_modules", "@opentui", "solid", "package.json"), "{}"),
  ])

  const result = await Effect.runPromise(prepareDev(artifacts, root))

  expect(result.command.at(-1)).toBe("--standalone")
  expect(result.scriptedCommand.at(-1)).toBe(join(root, "packages", "cli", "src", "index.ts"))
  expect(result.preloads).toContain("--conditions=browser")
  expect(result.preloads).toContain(
    `--preload=${join(root, "packages", "tui", "node_modules", "@opentui", "solid", "scripts", "preload.js")}`,
  )
})
