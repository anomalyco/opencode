import { afterEach, beforeEach, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RemoteTunnel } from "../src/services/remote-tunnel"
import { isolatedEnv } from "./fixture/environment"

let root = ""
let previousDataHome: string | undefined

const profile = () => path.join(root, "data", "opentunnel", "default")

const plantPending = async () => {
  await fs.mkdir(profile(), { recursive: true })
  await fs.writeFile(path.join(profile(), "pending.json"), "{}")
  await fs.writeFile(path.join(profile(), "token"), "token")
  await fs.writeFile(path.join(profile(), "private-key.pem"), "key")
}

const runCLI = async (args: string[]) => {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    env: isolatedEnv(root),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { output: stdout + stderr, exitCode }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-pair-remote-reset-"))
  previousDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = path.join(root, "data")
})

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = previousDataHome
  await fs.rm(root, { recursive: true, force: true })
})

test("reset discards a stuck pending tunnel", async () => {
  await plantPending()

  await Effect.runPromise(RemoteTunnel.reset())

  expect(await fs.stat(profile()).catch(() => undefined)).toBeUndefined()
})

test("reset succeeds when there is no stored tunnel", async () => {
  await Effect.runPromise(RemoteTunnel.reset())

  expect(await fs.stat(profile()).catch(() => undefined)).toBeUndefined()
})

// The spawned CLI boots the whole entrypoint, which needs more than Bun's 5s default on slower machines.
test(
  "pair --reset without --remote fails",
  async () => {
    const { output, exitCode } = await runCLI(["pair", "--reset"])

    expect(exitCode).toBe(1)
    expect(output).toContain("--reset requires --remote")
  },
  30_000,
)

test(
  "declining first-time consent leaves the stored tunnel alone",
  async () => {
    await plantPending()

    const { output, exitCode } = await runCLI(["pair", "--reset", "--remote"])

    expect(exitCode).toBe(1)
    expect(output).toContain("Run interactively or pass --yes to continue.")
    expect(await fs.stat(path.join(profile(), "pending.json")).catch(() => undefined)).toBeDefined()
  },
  30_000,
)
