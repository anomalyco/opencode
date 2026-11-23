import { expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import type { WslServerConfig } from "./contract"
import type { WslRuntime } from "./runtime"
import { createWslServersController } from "./servers"

// SAFETY: these tests never need WSL; the CLI checks that call into it fail, and the controller only logs that.
const runtime = {} as WslRuntime

test("teardown during a pending start resolves only after the started process exited", async () => {
  const children: ChildProcess[] = []
  const saved: WslServerConfig[] = []

  const controller = createWslServersController({
    cli: { version: "1.0.0" },
    runtime,
    t: (key) => key,
    log: () => undefined,
    installCli: async () => undefined,
    readServers: () => saved,
    writeServers: (servers) => saved.splice(0, saved.length, ...servers),
    // A real server process that never turns healthy; an abort ends it and rejects once it exited.
    spawnSidecar: (_distro, signal) => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
      children.push(child)

      return new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            child.once("exit", () => reject(signal.reason))
            child.kill()
          },
          { once: true },
        ),
      )
    },
  })

  await controller.addServer("Debian")

  while (!children.length) await Bun.sleep(1)
  expect(children[0].exitCode).toBeNull()
  await controller.stopServers()
  expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true)
})

test("retrying a failed server twice at once spawns one server, which teardown stops", async () => {
  const spawned: string[] = []
  const stopped: string[] = []

  const controller = createWslServersController({
    cli: { version: "1.0.0" },
    runtime,
    t: (key) => key,
    log: () => undefined,
    installCli: async () => undefined,
    readServers: () => [{ id: "wsl:Debian", distro: "Debian" }],
    writeServers: () => undefined,
    // The launch start fails; every retry comes up at once.
    spawnSidecar: async (distro) => {
      const url = `http://127.0.0.1:${4100 + spawned.length}`
      spawned.push(url)

      if (spawned.length === 1) throw new Error("not healthy")

      return { url, password: distro, stop: async () => void stopped.push(url), onExit: () => undefined }
    },
  })

  const failed = Promise.withResolvers<void>()

  const unsubscribe = controller.subscribe(() => {
    if (controller.getState().servers[0]?.runtime.kind === "failed") failed.resolve()
  })

  controller.startConfiguredServers()
  await failed.promise
  unsubscribe()

  await Promise.all([controller.startServer("wsl:Debian"), controller.startServer("wsl:Debian")])

  expect(spawned).toEqual(["http://127.0.0.1:4100", "http://127.0.0.1:4101"])
  expect(controller.getState().servers[0]?.runtime).toEqual({
    kind: "ready",
    url: "http://127.0.0.1:4101",
    password: "Debian",
  })

  await controller.stopServers()
  expect(stopped).toEqual(["http://127.0.0.1:4101"])
})
