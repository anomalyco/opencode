import { afterEach, describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Cause, Effect, Exit, Layer } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Daemon } from "./daemon"

const dirs: string[] = []
const children: Array<ReturnType<typeof Bun.spawn>> = []

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL")
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("daemon stop", () => {
  test(
    "fails closed when health times out and the registered pid is still alive",
    async () => {
      const state = await stateDir()
      const server = await spawnFixture(`
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch() {
            return new Promise(() => {})
          },
        })
        console.log("http://127.0.0.1:" + server.port)
      `)
      await writeRegistration(state, { url: server.url, pid: server.pid })

      const error = await fail(state, (daemon) => daemon.stop())
      expect(error._tag).toBe("Daemon.Unreachable")
      expect(alive(server.pid)).toBe(true)
      expect(await Bun.file(path.join(state, "server.json")).exists()).toBe(true)
    },
    15_000,
  )

  test("does not signal a live pid from an unauthenticated registration", async () => {
    const state = await stateDir()
    await writeRegistration(state, { url: "http://127.0.0.1:1", pid: process.pid })

    const error = await fail(state, (daemon) => daemon.stop())
    expect(error._tag).toBe("Daemon.Unreachable")
    expect(alive(process.pid)).toBe(true)
    expect(await Bun.file(path.join(state, "server.json")).exists()).toBe(true)
  })

  test("removes a stale registration whose pid is already gone", async () => {
    const state = await stateDir()
    const child = spawnChild(["sleep", "60"])
    const pid = child.pid
    child.kill("SIGKILL")
    await child.exited
    await writeRegistration(state, { url: "http://127.0.0.1:1", pid })

    await run(state, (daemon) => daemon.stop())
    expect(await Bun.file(path.join(state, "server.json")).exists()).toBe(false)
  })

  test("succeeds when no registration exists", async () => {
    const state = await stateDir()
    await run(state, (daemon) => daemon.stop())
  })

  test("fails on a corrupt registration without deleting it", async () => {
    const state = await stateDir()
    await fs.writeFile(path.join(state, "server.json"), "not-json")

    const error = await fail(state, (daemon) => daemon.stop())
    expect(error._tag).toBe("Daemon.Corrupt")
    expect(await Bun.file(path.join(state, "server.json")).text()).toBe("not-json")
  })

  test("stops a healthy registered process and removes the registration", async () => {
    const state = await stateDir()
    const server = await spawnFixture(`
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          return Response.json({ healthy: true })
        },
      })
      console.log("http://127.0.0.1:" + server.port)
    `)
    await writeRegistration(state, { url: server.url, pid: server.pid })

    await run(state, (daemon) => daemon.stop())
    expect(alive(server.pid)).toBe(false)
    expect(await Bun.file(path.join(state, "server.json")).exists()).toBe(false)
  })
})

describe("daemon restart", () => {
  test(
    "does not start a replacement after an unconfirmed stop",
    async () => {
      const state = await stateDir()
      const server = await spawnFixture(`
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch() {
            return new Promise(() => {})
          },
        })
        console.log("http://127.0.0.1:" + server.port)
      `)
      await writeRegistration(state, { url: server.url, pid: server.pid, id: "incumbent" })

      const error = await fail(state, (daemon) => daemon.restart())
      expect(error._tag).toBe("Daemon.Unreachable")
      expect(alive(server.pid)).toBe(true)
      const registration = JSON.parse(await Bun.file(path.join(state, "server.json")).text())
      expect(registration.id).toBe("incumbent")
      expect(registration.pid).toBe(server.pid)
    },
    15_000,
  )
})

describe("daemon start", () => {
  test(
    "does not spawn a contender when the incumbent is registered and unresponsive",
    async () => {
      const state = await stateDir()
      const server = await spawnFixture(`
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch() {
            return new Promise(() => {})
          },
        })
        console.log("http://127.0.0.1:" + server.port)
      `)
      await writeRegistration(state, { url: server.url, pid: server.pid, id: "incumbent" })

      const error = await fail(state, (daemon) => daemon.start())
      expect(error._tag).toBe("Daemon.Unreachable")
      expect(alive(server.pid)).toBe(true)
      const registration = JSON.parse(await Bun.file(path.join(state, "server.json")).text())
      expect(registration.id).toBe("incumbent")
    },
    15_000,
  )
})

describe("daemon status", () => {
  test(
    "does not delete a live unresponsive registration",
    async () => {
      const state = await stateDir()
      const server = await spawnFixture(`
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch() {
            return new Promise(() => {})
          },
        })
        console.log("http://127.0.0.1:" + server.port)
      `)
      await writeRegistration(state, { url: server.url, pid: server.pid })

      const url = await run(state, (daemon) => daemon.status())
      expect(url).toBeUndefined()
      expect(await Bun.file(path.join(state, "server.json")).exists()).toBe(true)
      expect(alive(server.pid)).toBe(true)
    },
    15_000,
  )
})

function layer(state: string) {
  return Daemon.layer.pipe(Layer.provide(Global.layerWith({ state })), Layer.provide(NodeFileSystem.layer))
}

function run<A, E>(state: string, run: (daemon: Daemon.Interface) => Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    const daemon = yield* Daemon.Service
    return yield* run(daemon)
  }).pipe(Effect.provide(layer(state)), Effect.runPromise)
}

async function fail(state: string, run: (daemon: Daemon.Interface) => Effect.Effect<unknown, unknown>) {
  const exit = await Effect.gen(function* () {
    const daemon = yield* Daemon.Service
    return yield* run(daemon)
  }).pipe(Effect.provide(layer(state)), Effect.exit, Effect.runPromise)
  if (!Exit.isFailure(exit)) throw new Error("expected daemon call to fail")
  const error = Cause.squash(exit.cause)
  if (typeof error !== "object" || error === null || !("_tag" in error)) throw new Error("expected a tagged daemon error")
  return error as { _tag: string }
}

async function stateDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daemon-test-"))
  dirs.push(dir)
  return dir
}

async function writeRegistration(
  state: string,
  info: { url: string; pid: number; id?: string },
) {
  await fs.writeFile(
    path.join(state, "server.json"),
    JSON.stringify({
      id: info.id,
      version: InstallationVersion,
      url: info.url,
      pid: info.pid,
    }),
  )
}

async function spawnFixture(source: string) {
  const proc = spawnChild([process.execPath, "-e", source])
  const url = await firstLine(proc.stdout)
  return { proc, url, pid: proc.pid }
}

function spawnChild(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" })
  children.push(proc)
  return proc
}

async function firstLine(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (true) {
    const result = await reader.read()
    if (result.done) break
    buf += decoder.decode(result.value, { stream: true })
    const index = buf.indexOf("\n")
    if (index >= 0) {
      reader.releaseLock()
      return buf.slice(0, index).trim()
    }
  }
  return buf.trim()
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
