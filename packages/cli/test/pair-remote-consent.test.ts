import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { remoteConsent, type RemoteConsentPrompt } from "../src/commands/handlers/pair"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"

let root = ""
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-pair-remote-consent-"))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  process.exitCode = 0
})

const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )

// Records whether the user was asked so tests can assert the prompt was skipped.
function terminal(input: { readonly interactive: boolean; readonly answer?: boolean | symbol }) {
  const asked: true[] = []
  const prompt: RemoteConsentPrompt = {
    interactive: () => input.interactive,
    confirm: async () => {
      asked.push(true)
      return input.answer ?? false
    },
  }
  return { prompt, asked }
}

const consent = (yes: boolean, prompt: RemoteConsentPrompt) =>
  run(ServiceConfig.read().pipe(Effect.flatMap((config) => remoteConsent(config, { yes }, prompt))))

test("first enable asks before remote access is enabled and remembers acceptance", async () => {
  const accepting = terminal({ interactive: true, answer: true })
  expect(await consent(false, accepting.prompt)).toBe(true)
  expect(accepting.asked).toHaveLength(1)
  expect(await run(ServiceConfig.read())).toEqual({ remoteAccepted: true })

  const again = terminal({ interactive: true, answer: false })
  expect(await consent(false, again.prompt)).toBe(true)
  expect(again.asked).toHaveLength(0)
})

test("declining enables nothing and asks again next time", async () => {
  const declining = terminal({ interactive: true, answer: false })
  expect(await consent(false, declining.prompt)).toBe(false)
  expect(declining.asked).toHaveLength(1)
  expect(await run(ServiceConfig.read())).toEqual({})

  const cancelling = terminal({ interactive: true, answer: Symbol("clack:cancel") })
  expect(await consent(false, cancelling.prompt)).toBe(false)
  expect(await run(ServiceConfig.read())).toEqual({})
})

test("already enabled or previously enabled remote access does not ask", async () => {
  await run(ServiceConfig.remote())
  const enabled = terminal({ interactive: false })
  expect(await consent(false, enabled.prompt)).toBe(true)
  expect(enabled.asked).toHaveLength(0)

  // Turning remote access off forgets the address but not that it was enabled.
  await run(ServiceConfig.set("remote", "false"))
  expect(await run(ServiceConfig.read())).toEqual({ remoteAccepted: true })
  const disabled = terminal({ interactive: false })
  expect(await consent(false, disabled.prompt)).toBe(true)
  expect(disabled.asked).toHaveLength(0)
})

test("without a terminal, first enable fails unless --yes accepts", async () => {
  const headless = terminal({ interactive: false })
  expect(await consent(false, headless.prompt)).toBe(false)
  expect(process.exitCode).toBe(1)
  expect(headless.asked).toHaveLength(0)
  expect(await run(ServiceConfig.read())).toEqual({})

  expect(await consent(true, headless.prompt)).toBe(true)
  expect(headless.asked).toHaveLength(0)
  expect(await run(ServiceConfig.read())).toEqual({ remoteAccepted: true })
})

test("pair --remote without a terminal fails before enabling anything, and help documents --yes", async () => {
  const cli = async (args: string[]) => {
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
  const [pair, help] = await Promise.all([cli(["pair", "--remote"]), cli(["pair", "--help"])])

  expect(pair.exitCode).toBe(1)
  expect(pair.output).toBe(
    [
      "This will expose your OpenCode server to the internet.",
      "Traffic is end-to-end encrypted, and access requires your server password.",
      "To pair locally instead, run `opencode pair` without the --remote flag.",
      "Run interactively or pass --yes to continue.",
      "",
    ].join(os.EOL),
  )
  expect(await Array.fromAsync(new Bun.Glob("**/service*.json").scan({ cwd: root, dot: true }))).toEqual([])
  expect(help.exitCode).toBe(0)
  expect(help.output).toContain("--yes")
})
