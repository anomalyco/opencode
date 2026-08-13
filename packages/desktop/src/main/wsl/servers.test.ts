import { expect, test } from "bun:test"
import type { WslServerConfig } from "../../preload/types"
import { wslCliInstallCommand } from "./runtime"
import { createWslServersController } from "./servers"

type ControllerOptions = Parameters<typeof createWslServersController>[0]

let persistedServers: WslServerConfig[] = []

test("passes a local CLI path directly to the V2 installer", () => {
  expect(wslCliInstallCommand({ version: "local", binary: "C:\\build\\opencode2" })).toBe(
    `curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/v2/install | bash -s -- --binary "$(wslpath -a 'C:\\build\\opencode2')"`,
  )
})

test("installs and verifies the bundled CLI version", async () => {
  persistedServers = []
  const installs: string[][] = []
  const controller = createWslServersController(
    testControllerOptions({
      installCli: async (distro, cli) => {
        installs.push([distro, cli.version])
      },
      resolveCli: async () => "/home/me/.opencode/bin/opencode2",
    }),
  )

  await controller.installOpencode("Debian")

  expect(installs).toEqual([["Debian", "0.0.0-next-16365"]])
  expect(controller.getState().opencodeChecks.Debian?.matchesDesktop).toBe(true)
})

test("rejects a WSL CLI version that differs from the bundled version", async () => {
  persistedServers = []
  const controller = createWslServersController(
    testControllerOptions({
      installCli: async () => undefined,
      resolveCli: async () => "/home/me/.opencode/bin/opencode2",
      readCliVersion: async () => "0.0.0-next-older",
    }),
  )

  await expect(controller.installOpencode("Debian")).rejects.toThrow(
    "OpenCode update finished but Debian still reports 0.0.0-next-older; expected 0.0.0-next-16365",
  )
})

test("stops a running WSL server before replacing its CLI", async () => {
  persistedServers = [{ id: "wsl:Debian", distro: "Debian" }]
  const events: string[] = []
  const controller = createWslServersController(
    testControllerOptions({
      spawnSidecar: async () => {
        events.push("start")
        return {
          stop: async () => {
            events.push("stop")
          },
          onExit: () => undefined,
          url: "http://127.0.0.1:4096",
          username: "opencode",
          password: "secret",
        }
      },
      installCli: async () => {
        events.push("install")
      },
    }),
  )
  controller.startConfiguredServers()
  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "ready")

  await controller.installOpencode("Debian")

  expect(events).toEqual(["start", "stop", "install", "start"])
  await controller.stopServers()
})

test("probes addable distros in parallel before checking OpenCode", async () => {
  persistedServers = []
  const started: string[] = []
  const release = new Map<string, () => void>()
  const opencode: string[] = []
  const controller = createWslServersController(
    testControllerOptions({
      spawnSidecar: pendingSidecar,
      probeDistro: async (distro) => {
        started.push(distro)
        await new Promise<void>((resolve) => release.set(distro, resolve))
        return { name: distro, canExecute: true, hasBash: true, hasCurl: true, error: null }
      },
      resolveCli: async (distro) => {
        opencode.push(distro)
        return "/home/me/.opencode/bin/opencode2"
      },
    }),
  )

  const task = controller.probeAddable(["Debian", "Ubuntu"])
  await waitFor(() => started.length === 2)
  expect(started).toEqual(["Debian", "Ubuntu"])
  expect(opencode).toEqual([])
  release.get("Debian")?.()
  release.get("Ubuntu")?.()
  await task

  expect(Object.keys(controller.getState().distroProbes)).toEqual(["Debian", "Ubuntu"])
  expect(opencode).toEqual(["Debian", "Ubuntu"])
  expect(Object.keys(controller.getState().opencodeChecks)).toEqual(["Debian", "Ubuntu"])
})

test("does not check OpenCode in addable distros that cannot execute commands", async () => {
  persistedServers = []
  const opencode: string[] = []
  const controller = createWslServersController(
    testControllerOptions({
      spawnSidecar: pendingSidecar,
      probeDistro: async (distro) => ({
        name: distro,
        canExecute: distro === "Debian",
        hasBash: distro === "Debian",
        hasCurl: distro === "Debian",
        error: distro === "Debian" ? null : "Open Ubuntu once to finish setup",
      }),
      resolveCli: async (distro) => {
        opencode.push(distro)
        return "/home/me/.opencode/bin/opencode2"
      },
    }),
  )

  await controller.probeAddable(["Debian", "Ubuntu"])

  expect(Object.keys(controller.getState().distroProbes)).toEqual(["Debian", "Ubuntu"])
  expect(opencode).toEqual(["Debian"])
  expect(Object.keys(controller.getState().opencodeChecks)).toEqual(["Debian"])
})

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}

function testControllerOptions(overrides: Partial<ControllerOptions> = {}): ControllerOptions {
  return {
    cli: { version: "0.0.0-next-16365" },
    spawnSidecar: async () => ({
      stop: async () => undefined,
      onExit: () => undefined,
      url: "http://127.0.0.1:4096",
      username: "opencode",
      password: "secret",
    }),
    readServers: () => persistedServers,
    writeServers: (servers: WslServerConfig[]) => {
      persistedServers = servers
    },
    readCliVersion: async () => "0.0.0-next-16365",
    resolveCli: async () => "/home/me/.opencode/bin/opencode2",
    ...overrides,
  }
}

const pendingSidecar = async () => new Promise<never>(() => undefined)
