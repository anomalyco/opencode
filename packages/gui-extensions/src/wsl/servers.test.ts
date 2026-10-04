import { expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import type { WslServerConfig } from "./contract"
import type { WslRuntime } from "./runtime"
import { createWslServersController } from "./servers"

test("teardown during a pending start resolves only after the started process exited", async () => {
  const children: ChildProcess[] = []
  const saved: WslServerConfig[] = []
  const controller = createWslServersController({
    cli: { version: "1.0.0" },
    runtime: {} as WslRuntime,
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
