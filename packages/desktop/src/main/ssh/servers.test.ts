import { expect, test } from "bun:test"
import type { SshHostProbe } from "../../preload/types"
import { createSshServersController, type SshServerConfig } from "./servers"
import { sshServerIdsToStartOnInitialize } from "./startup"

let persistedServers: SshServerConfig[] = []

function probe(host: string, overrides: Partial<SshHostProbe> = {}): SshHostProbe {
  return {
    host,
    reachable: true,
    opencodePath: "/home/dev/.opencode/bin/opencode",
    opencodeVersion: "1.18.13",
    expectedVersion: "1.18.13",
    matchesDesktop: true,
    error: null,
    ...overrides,
  }
}

function testControllerOptions() {
  persistedServers = []
  return {
    readServers: () => persistedServers,
    writeServers: (servers: SshServerConfig[]) => {
      persistedServers = servers
    },
    probeHost: async (host: string) => probe(host),
    listConfigHosts: () => [],
  }
}

test("starts every configured SSH server on initialization", () => {
  expect(sshServerIdsToStartOnInitialize([{ id: "ssh:dev@a" }, { id: "ssh:b" }])).toEqual(["ssh:dev@a", "ssh:b"])
})

test("adds a server, persists the normalized host, and reports ready", async () => {
  const controller = createSshServersController(
    "1.18.13",
    async () => ({
      listener: { stop: () => undefined, onExit: () => undefined },
      url: "http://127.0.0.1:50123",
      username: "opencode",
      password: "secret",
    }),
    testControllerOptions(),
  )

  const config = await controller.addServer(" dev@example.com ")
  expect(config).toEqual({ id: "ssh:dev@example.com", host: "dev@example.com" })
  expect(persistedServers).toEqual([config])

  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "ready")
  const runtime = controller.getState().servers[0].runtime
  expect(runtime).toEqual({
    kind: "ready",
    url: "http://127.0.0.1:50123",
    username: "opencode",
    password: "secret",
  })
})

test("rejects duplicate and invalid hosts", async () => {
  const controller = createSshServersController(
    "1.18.13",
    async () => new Promise<never>(() => undefined),
    testControllerOptions(),
  )
  await controller.addServer("dev@example.com")
  await expect(controller.addServer("dev@example.com")).rejects.toThrow("already added")
  await expect(controller.addServer("-oProxyCommand=x")).rejects.toThrow("Invalid SSH host")
})

test("marks servers failed with the opencode-missing reason", async () => {
  const controller = createSshServersController(
    "1.18.13",
    async () => {
      const error = new Error("opencode is not installed on dev@example.com") as Error & { reason?: string }
      error.reason = "opencode-missing"
      throw error
    },
    testControllerOptions(),
  )

  await controller.addServer("dev@example.com")
  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "failed")
  expect(controller.getState().servers[0].runtime).toEqual({
    kind: "failed",
    message: "opencode is not installed on dev@example.com",
    reason: "opencode-missing",
  })
})

test("ignores stale sidecars when the server is removed mid-start", async () => {
  let release: ((sidecar: never) => void) | undefined
  let stopped = 0
  const controller = createSshServersController(
    "1.18.13",
    async () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            listener: { stop: () => void stopped++, onExit: () => undefined },
            url: "http://127.0.0.1:50123",
            username: "opencode",
            password: "secret",
          })
      }),
    testControllerOptions(),
  )

  await controller.addServer("dev@example.com")
  await waitFor(() => !!release)
  await controller.removeServer("ssh:dev@example.com")
  release?.(undefined as never)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(controller.getState().servers).toEqual([])
  expect(persistedServers).toEqual([])
  expect(stopped).toBe(1)
})

test("stopServer disconnects without forgetting the server", async () => {
  let stopped = 0
  const controller = createSshServersController(
    "1.18.13",
    async () => ({
      listener: { stop: () => void stopped++, onExit: () => undefined },
      url: "http://127.0.0.1:50123",
      username: "opencode",
      password: "secret",
    }),
    testControllerOptions(),
  )

  await controller.addServer("dev@example.com")
  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "ready")
  await controller.stopServer("ssh:dev@example.com")

  expect(stopped).toBe(1)
  expect(controller.getState().servers[0].runtime).toEqual({ kind: "stopped" })
  expect(persistedServers).toHaveLength(1)
})

test("a late exit from a stopped sidecar does not override the stopped state", async () => {
  let exitCb: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  const controller = createSshServersController(
    "1.18.13",
    async () => ({
      listener: {
        stop: () => undefined,
        onExit: (cb) => {
          exitCb = cb
        },
      },
      url: "http://127.0.0.1:50123",
      username: "opencode",
      password: "secret",
    }),
    testControllerOptions(),
  )

  await controller.addServer("dev@example.com")
  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "ready")
  await controller.stopServer("ssh:dev@example.com")
  exitCb?.(255, null)

  expect(controller.getState().servers[0].runtime).toEqual({ kind: "stopped" })
})

test("probeHost stores results under the normalized host", async () => {
  const controller = createSshServersController("1.18.13", async () => new Promise<never>(() => undefined), {
    ...testControllerOptions(),
    probeHost: async (host: string) => probe(host, { opencodeVersion: "1.0.0", matchesDesktop: false }),
  })

  await controller.probeHost(" dev@example.com ")
  expect(controller.getState().hostProbes["dev@example.com"]).toMatchObject({
    host: "dev@example.com",
    matchesDesktop: false,
  })
  expect(controller.getState().job).toBeNull()
})

test("installOpencode refreshes the probe and restarts the matching server", async () => {
  const spawns: string[] = []
  const controller = createSshServersController(
    "1.18.13",
    async (host) => {
      spawns.push(host)
      return {
        listener: { stop: () => undefined, onExit: () => undefined },
        url: "http://127.0.0.1:50123",
        username: "opencode",
        password: "secret",
      }
    },
    {
      ...testControllerOptions(),
      installOpencode: async () => ({ code: 0, signal: null, stdout: "", stderr: "" }),
    },
  )

  await controller.addServer("dev@example.com")
  await waitFor(() => controller.getState().servers[0]?.runtime.kind === "ready")
  await controller.installOpencode("dev@example.com")
  await waitFor(() => spawns.length === 2)

  expect(controller.getState().hostProbes["dev@example.com"]).toBeDefined()
})

test("installOpencode surfaces installer failures", async () => {
  const controller = createSshServersController("1.18.13", async () => new Promise<never>(() => undefined), {
    ...testControllerOptions(),
    installOpencode: async () => ({ code: 1, signal: null, stdout: "", stderr: "curl: (7) connection refused" }),
  })

  await expect(controller.installOpencode("dev@example.com")).rejects.toThrow("curl: (7) connection refused")
})

test("normalizes persisted hosts when reading the store", async () => {
  persistedServers = []
  const controller = createSshServersController("1.18.13", async () => new Promise<never>(() => undefined), {
    readServers: () => [{ id: "ssh:dev@example.com", host: "dev@example.com" }, { host: "::1" } as SshServerConfig],
    writeServers: () => undefined,
    probeHost: async (host: string) => probe(host),
    listConfigHosts: () => ["work-box"],
  })

  await controller.initialize()
  expect(controller.getState().servers.map((item) => item.config)).toEqual([
    { id: "ssh:dev@example.com", host: "dev@example.com" },
    { id: "ssh:[::1]", host: "[::1]" },
  ])
  expect(controller.getState().configHosts).toEqual(["work-box"])
})

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}
