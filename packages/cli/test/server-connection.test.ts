import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { OPENCODE_VERSION } from "../src/version"
import { expect, test } from "bun:test"
import { Console, Effect, FileSystem, Option, Scope } from "effect"
import { Command } from "effect/cli"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Commands, PrintLogs, Server, Standalone } from "../src/commands/commands"
import { Spec } from "../src/framework/spec"
import { ServerConnection } from "../src/services/server-connection"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"

test("resolution groups Effect-native lifecycle operations only for the managed service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-resolution-"))
  const id = "server-resolution-test"
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        version: OPENCODE_VERSION,
        pid: process.pid,
        urls: [],
      })
    },
  })
  const registration = path.join(root, "state", ServiceConfig.filename())
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    await fs.mkdir(path.dirname(registration), { recursive: true })
    await fs.writeFile(
      registration,
      JSON.stringify({
        id,
        version: OPENCODE_VERSION,
        url: server.url.toString(),
        pid: process.pid,
      }),
    )
    const resolved = await runPromise(ServerConnection.resolve())

    expect(resolved.endpoint.url).toBe(server.url.toString())
    expect(resolved.service).toBeDefined()
    if (!resolved.service) throw new Error("Expected managed service capabilities")
    expect(Effect.isEffect(resolved.service.reconnect())).toBe(true)
    expect(Effect.isEffect(resolved.service.restart())).toBe(true)
    expect(await runPromise(resolved.service.reconnect())).toEqual(resolved.endpoint)

    const explicit = await runPromise(ServerConnection.resolve({ server: server.url.toString() }))
    expect(explicit.endpoint.url).toBe(server.url.toString())
    expect(explicit.service).toBeUndefined()
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service options only require a matching version when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-options-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))

  try {
    expect((await runPromise(ServiceConfig.options())).version).toBeUndefined()
    expect((await runPromise(ServiceConfig.options({ checkVersion: true }))).version).toBe(OPENCODE_VERSION)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("global --server and --standalone flags parse in any position for server-connecting commands and reject on local-only commands", async () => {
  const captured: Array<{
    readonly path: string
    readonly server: string | undefined
    readonly standalone: boolean
  }> = []

  function bindTree(
    node: Spec.Any,
    prefix: ReadonlyArray<string> = [],
  ): Command.Command<string, unknown, unknown, unknown, never> {
    const currentPath = [...prefix, node.name].join(" ")
    const withHandler = node.spec.pipe(
      Command.withHandler((input: Record<string, unknown>) =>
        Effect.gen(function* () {
          const serverFlag = yield* Effect.serviceOption(Server).pipe(Effect.map(Option.flatten))
          const standaloneFlag = yield* Effect.serviceOption(Standalone)
          const inputServer = Option.isOption(input.server)
            ? Option.getOrUndefined(input.server as Option.Option<string>)
            : undefined
          const inputStandalone = typeof input.standalone === "boolean" ? input.standalone : undefined
          captured.push({
            path: currentPath,
            server: inputServer ?? Option.getOrUndefined(serverFlag),
            standalone: inputStandalone ?? Option.getOrElse(standaloneFlag, () => false),
          })
        }),
      ),
    ) as Command.Command<string, unknown, unknown, unknown, never>
    const children = Object.values(node.commands)
    if (children.length === 0) return withHandler
    return withHandler.pipe(
      Command.withSubcommands(children.map((child) => bindTree(child, [...prefix, node.name]))),
    ) as Command.Command<string, unknown, unknown, unknown, never>
  }

  const silentConsole: Console.Console = Object.assign(Object.create(console), {
    log: () => {},
    error: () => {},
  })

  const runArgs = (args: ReadonlyArray<string>) =>
    Effect.runPromise(
      Command.runWith(bindTree(Commands).pipe(Command.withGlobalFlags([PrintLogs])), {
        version: OPENCODE_VERSION,
        renderErrors: false,
      })(args).pipe(Effect.provideService(Console.Console, silentConsole), Effect.provide(NodeServices.layer)),
    )

  const url = "http://127.0.0.1:43210"
  const serverCases: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
    [["--server", url, "session", "list"], "opencode session list"],
    [["session", "--server", url, "list"], "opencode session list"],
    [["session", "list", "--server", url], "opencode session list"],
    [["session", "--server", url, "delete", "ses_123"], "opencode session delete"],
    [["--server", url, "plugin", "list"], "opencode plugin list"],
    [["plugin", "--server", url, "list"], "opencode plugin list"],
    [["plugin", "list", "--server", url], "opencode plugin list"],
    [["plugin", "--server", url, "check"], "opencode plugin check"],
    [["plugin", "--server", url, "update"], "opencode plugin update"],
    [["--server", url, "mcp", "list"], "opencode mcp list"],
    [["mcp", "--server", url, "list"], "opencode mcp list"],
    [["mcp", "list", "--server", url], "opencode mcp list"],
    [["mcp", "--server", url, "auth", "linear"], "opencode mcp auth"],
    [["mcp", "--server", url, "logout", "linear"], "opencode mcp logout"],
    [["auth", "--server", url, "list"], "opencode auth list"],
    [["debug", "--server", url, "config"], "opencode debug config"],
    [["debug", "--server", url, "agents"], "opencode debug agents"],
    [["debug", "--server", url, "heap-dump"], "opencode debug heap-dump"],
    [["--server", url, "models"], "opencode models"],
    [["models", "--server", url], "opencode models"],
    [["--server", url, "run", "hello"], "opencode run"],
    [["run", "hello", "--server", url], "opencode run"],
  ]

  for (const [args, expectedPath] of serverCases) {
    captured.length = 0
    await runArgs(args)
    expect(captured).toEqual([{ path: expectedPath, server: url, standalone: false }])
  }

  captured.length = 0
  await runArgs(["session", "--standalone", "list"])
  expect(captured).toEqual([{ path: "opencode session list", server: undefined, standalone: true }])

  await expect(runArgs(["plugin", "add", "some-plugin", "--server", url])).rejects.toThrow()
  await expect(runArgs(["plugin", "remove", "some-plugin", "--server", url])).rejects.toThrow()
  await expect(runArgs(["mcp", "add", "my-mcp", "--url", "https://example.com/mcp", "--server", url])).rejects.toThrow()
  await expect(runArgs(["serve", "--server", url])).rejects.toThrow()
  await expect(runArgs(["--server", url, "serve"])).rejects.toThrow()
  await expect(runArgs(["service", "status", "--server", url])).rejects.toThrow()
  await expect(runArgs(["service", "--server", url, "start"])).rejects.toThrow()
})

test("local config commands do not start or require a server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-local-config-cmd-"))
  try {
    const env = isolatedEnv(root)
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        path.join(import.meta.dir, "../src/index.ts"),
        "mcp",
        "add",
        "demo",
        "--global",
        "--url",
        "https://example.com/mcp",
      ],
      {
        cwd: path.join(import.meta.dir, ".."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(stdout).toContain('MCP server "demo" added')
    const config = await Bun.file(path.join(root, "config", "opencode.json")).json()
    expect(config).toMatchObject({
      mcp: {
        servers: {
          demo: { type: "remote", url: "https://example.com/mcp" },
        },
      },
    })
    expect(await Bun.file(path.join(root, "state", "opencode", ServiceConfig.filename())).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("connects to an already-running service on the configured port without spawning a contender and warns on version mismatch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-configured-port-discovery-"))
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get("authorization") !== `Basic ${btoa("opencode:configured-secret")}`) {
        return Response.json({ _tag: "UnauthorizedError", message: "Unauthorized" }, { status: 401 })
      }
      return Response.json({
        version: "0.0.0-older-server",
        pid: process.pid,
        urls: [],
      })
    },
  })
  const configDir = path.join(root, "config")
  const stateDir = path.join(root, "state")
  const layer = Global.layerWith({ home: root, config: configDir, state: stateDir })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))
  const warnings: string[] = []
  const originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    warnings.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
    return true
  }) as typeof process.stderr.write

  try {
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, ServiceConfig.filename()),
      JSON.stringify({
        hostname: "127.0.0.1",
        port: server.port,
        password: "configured-secret",
      }),
    )

    const resolved = await runPromise(ServerConnection.resolve())
    expect(resolved.endpoint).toEqual({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "basic", username: "opencode", password: "configured-secret" },
    })
    expect(warnings.join("")).toContain(
      `Warning: Server at http://127.0.0.1:${server.port} has version 0.0.0-older-server; this client is ${OPENCODE_VERSION}. Continuing anyway.`,
    )
    expect(await Bun.file(path.join(stateDir, ServiceConfig.filename())).exists()).toBe(false)

    // Also discovers a registration written to ~/.local/state/opencode when config.env.XDG_STATE_HOME differs.
    const homeRegistration = path.join(root, ".local", "state", "opencode", ServiceConfig.filename())
    await fs.mkdir(path.dirname(homeRegistration), { recursive: true })
    await fs.writeFile(
      homeRegistration,
      JSON.stringify({
        id: "desktop-owner",
        version: "0.0.0-older-server",
        url: `http://127.0.0.1:${server.port}`,
        pid: process.pid,
        password: "configured-secret",
      }),
    )
    await fs.writeFile(
      path.join(configDir, ServiceConfig.filename()),
      JSON.stringify({
        hostname: "127.0.0.1",
        port: server.port,
        password: "configured-secret",
        env: { XDG_STATE_HOME: stateDir },
      }),
    )
    const options = await runPromise(ServiceConfig.options())
    expect(options.file).toBe(homeRegistration)

    // Fails clearly without spawning when the configured server rejects the password.
    await fs.rm(homeRegistration, { force: true })
    await fs.writeFile(
      path.join(configDir, ServiceConfig.filename()),
      JSON.stringify({
        hostname: "127.0.0.1",
        port: server.port,
        password: "wrong-password",
      }),
    )
    await expect(runPromise(ServerConnection.resolve())).rejects.toThrow(
      `Server at http://127.0.0.1:${server.port} rejected the password`,
    )
  } finally {
    process.stderr.write = originalWrite
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("a build ignores another channel's service config and never sends it that password", async () => {
  expect(ServiceConfig.filename()).not.toBe("service.json")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-channel-isolation-"))
  const seen: Array<string | null> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push(request.headers.get("authorization"))
      return Response.json({ version: "0.0.0-production", pid: process.pid, urls: [] })
    },
  })
  const configDir = path.join(root, "config")
  const stateDir = path.join(root, "state")
  const layer = Global.layerWith({ home: root, config: configDir, state: stateDir })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))
  try {
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, "service.json"),
      JSON.stringify({ hostname: "127.0.0.1", port: server.port, password: "prod-secret" }),
    )
    const options = await runPromise(ServiceConfig.options())
    expect(options.file).toBe(path.join(stateDir, ServiceConfig.filename()))
    expect(options.env).toBeUndefined()
    expect(await runPromise(ServiceConfig.probeConfigured({ file: options.file }))).toBeUndefined()
    expect(seen).toEqual([])
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("probing sends each password only to its own URL and never sends OPENCODE_PASSWORD", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-probe-pairing-"))
  const stub = () => {
    const seen: Array<string | null> = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        seen.push(request.headers.get("authorization"))
        return Response.json({ _tag: "UnauthorizedError", message: "Unauthorized" }, { status: 401 })
      },
    })
    return { seen, server }
  }
  const configured = stub()
  const registered = stub()
  const configDir = path.join(root, "config")
  const stateDir = path.join(root, "state")
  const layer = Global.layerWith({ home: root, config: configDir, state: stateDir })
  const runPromise = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer), Effect.scoped))
  const originalPassword = process.env.OPENCODE_PASSWORD
  process.env.OPENCODE_PASSWORD = "env-secret"
  try {
    await fs.mkdir(configDir, { recursive: true })
    await fs.mkdir(stateDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, ServiceConfig.filename()),
      JSON.stringify({ hostname: "127.0.0.1", port: configured.server.port, password: "config-secret" }),
    )
    const file = path.join(stateDir, ServiceConfig.filename())
    await fs.writeFile(
      file,
      JSON.stringify({
        id: "owner",
        version: "0.0.0-other",
        url: `http://127.0.0.1:${registered.server.port}`,
        pid: process.pid,
        password: "registration-secret",
      }),
    )
    const result = await runPromise(ServiceConfig.probeConfigured({ file }))
    expect(result?.state).toBe("unauthorized")
    expect(configured.seen).toEqual([`Basic ${btoa("opencode:config-secret")}`])
    expect(registered.seen).toEqual([`Basic ${btoa("opencode:registration-secret")}`])
  } finally {
    if (originalPassword === undefined) delete process.env.OPENCODE_PASSWORD
    else process.env.OPENCODE_PASSWORD = originalPassword
    await configured.server.stop(true)
    await registered.server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
