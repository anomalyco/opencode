import { NodeFileSystem } from "@effect/platform-node"
import { validateRoutes } from "@opentunnel/client/effect"
import { Service, type Info } from "@opencode/client/effect/service"
import { Global } from "@opencode/util/global"
import { OPENCODE_VERSION } from "../src/version"
import { expect, test } from "bun:test"
import { Deferred, Effect, FileSystem, Schedule, Schema } from "effect"
import { TestClock } from "effect/testing"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { ServerAddress } from "../src/services/server-address"
import { ServiceRegistration } from "../src/services/service-registration"
import { isolatedEnv, transpilerCache } from "./fixture/environment"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeFileSystem.layer)

test("managed service ports are stable per installation channel", () => {
  expect(ServiceConfig.defaultPort("latest")).toBe(0xc0de)
  expect(ServiceConfig.defaultPort("dev")).toBe(0xc0de)
  expect(ServiceConfig.defaultPort("beta")).toBe(0xc0de)
  expect(ServiceConfig.defaultPort("next")).toBe(0xc0de)
  expect(ServiceConfig.defaultPort("local")).toBe(0xc0df)
  expect(ServiceConfig.defaultPort("preview-a")).toBe(ServiceConfig.defaultPort("preview-a"))
  expect(ServiceConfig.defaultPort("preview-a")).not.toBe(ServiceConfig.defaultPort("preview-b"))
})

test("service disabled accepts only booleans without changing configuration on invalid input", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-disabled-config-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    expect(await run(ServiceConfig.get("disabled"))).toBe("false")
    await expect(run(ServiceConfig.set("disabled", "yes"))).rejects.toThrow("Disabled must be true or false")
    expect(await run(ServiceConfig.read())).toEqual({})
    await run(ServiceConfig.set("disabled", "true"))
    expect(await run(ServiceConfig.read())).toEqual({ disabled: true })
    await run(ServiceConfig.unset("disabled"))
    expect(await run(ServiceConfig.read())).toEqual({})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

// Enabling remote creates a real tunnel, so only the paths that stay local are covered here.
test("service remote accepts only booleans and persists across set and unset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-remote-config-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    expect(await run(ServiceConfig.get("remote"))).toBe("false")
    await expect(run(ServiceConfig.set("remote", "on"))).rejects.toThrow("Remote must be true or false")
    expect(await run(ServiceConfig.read())).toEqual({})
    await run(ServiceConfig.set("remote", "false"))
    expect(await run(ServiceConfig.read())).toEqual({})
    expect(await run(ServiceConfig.get("remote"))).toBe("false")
    await run(ServiceConfig.unset("remote"))
    expect(await run(ServiceConfig.read())).toEqual({})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("remote access route is random, stable once created, hidden, and forgotten when remote is turned off", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-remote-route-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  try {
    const route = await run(ServiceConfig.remote())
    // The SDK rejects invalid route names, which would keep the service from ever attaching.
    expect(() => validateRoutes({ [route]: "127.0.0.1:4096" })).not.toThrow()
    expect(route).toMatch(/^[0-9a-f]{16}$/)
    expect(await run(ServiceConfig.read())).toEqual({ remote: { route } })
    expect(await run(ServiceConfig.remote())).toBe(route)
    expect(await run(ServiceConfig.get("remote"))).toBe("true")
    expect(await run(ServiceConfig.get())).not.toContain(route)

    await run(ServiceConfig.set("remote", "false"))
    expect(await run(ServiceConfig.read())).toEqual({})
    expect(await run(ServiceConfig.get("remote"))).toBe("false")
    expect(await run(ServiceConfig.remote())).not.toBe(route)

    await run(ServiceConfig.unset("remote"))
    expect(await run(ServiceConfig.read())).toEqual({})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("reading a config with remote access stored as a boolean repairs it in place and keeps other settings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-remote-legacy-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  const file = path.join(root, "config", ServiceConfig.filename())
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })

    await Bun.write(file, JSON.stringify({ remote: true, password: "kept", env: { A: "1" } }))
    const enabled = await run(ServiceConfig.read())
    const route = enabled.remote?.route ?? ""
    expect(route).toMatch(/^[0-9a-f]{16}$/)
    expect(enabled).toEqual({ remote: { route }, password: "kept", env: { A: "1" } })
    expect(await Bun.file(file).json()).toEqual(enabled)
    expect(await run(ServiceConfig.read())).toEqual(enabled)

    await Bun.write(file, JSON.stringify({ remote: false, password: "kept" }))
    expect(await run(ServiceConfig.read())).toEqual({ password: "kept" })
    expect(await Bun.file(file).json()).toEqual({ password: "kept" })

    const current = JSON.stringify({ remote: { route: "0123456789abcdef" }, password: "kept" })
    await Bun.write(file, current)
    expect(await run(ServiceConfig.read())).toEqual({ remote: { route: "0123456789abcdef" }, password: "kept" })
    expect(await Bun.file(file).text()).toBe(current)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("local channel stores service config with the local service filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-"))
  try {
    await Effect.runPromise(
      ServiceConfig.set("hostname", "127.0.0.2").pipe(
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({
      hostname: "127.0.0.2",
    })
    expect(await Bun.file(path.join(root, "config", "service.json")).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service config manages environment variables", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-env-"))
  const layer = Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })
  try {
    await Effect.runPromise(
      ServiceConfig.set("env", "OPENCODE_SERVICE_ENV_TEST", "configured").pipe(
        Effect.provide(layer),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(
      await Effect.runPromise(
        ServiceConfig.get("env", "OPENCODE_SERVICE_ENV_TEST").pipe(
          Effect.provide(layer),
          Effect.provide(NodeFileSystem.layer),
        ),
      ),
    ).toBe("configured")
    expect(
      (
        await Effect.runPromise(
          ServiceConfig.options().pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)),
        )
      ).env,
    ).toEqual({ OPENCODE_SERVICE_ENV_TEST: "configured" })

    await Effect.runPromise(
      ServiceConfig.unset("env", "OPENCODE_SERVICE_ENV_TEST").pipe(
        Effect.provide(layer),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({})
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service filenames share release channels and identify preview channels", () => {
  expect(ServiceConfig.filename("latest")).toBe("service.json")
  expect(ServiceConfig.filename("dev")).toBe("service.json")
  expect(ServiceConfig.filename("beta")).toBe("service.json")
  expect(ServiceConfig.filename("next")).toBe("service.json")
  expect(ServiceConfig.filename("local")).toBe("service-local.json")
  expect(ServiceConfig.filename("preview-a")).toBe("service-preview-a.json")
  expect(ServiceConfig.filename("preview/a")).toBe("service-preview-a.json")
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-1234.2", "preview-a")).toBe(true)
  expect(ServiceConfig.versionBelongsToChannel("0.0.0-preview-a-other-1234", "preview-a")).toBe(false)
  expect(ServiceConfig.versionBelongsToChannel("1.2.3", "preview-a")).toBe(false)
})

test("service config migrates from the hashed channel filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-config-migration-"))
  const legacy = path.join(root, ServiceConfig.legacyFilename("preview-a")!)
  const target = path.join(root, ServiceConfig.filename("preview-a"))
  try {
    await fs.writeFile(legacy, JSON.stringify({ hostname: "127.0.0.2", port: 4098 }))
    await Effect.runPromise(ServiceConfig.migrateConfig(legacy, target).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(target).json()).toEqual({ hostname: "127.0.0.2", port: 4098 })

    await fs.writeFile(target, JSON.stringify({ port: 4099 }))
    await Effect.runPromise(ServiceConfig.migrateConfig(legacy, target).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(target).json()).toEqual({ port: 4099 })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("preview registration migration never moves stable discovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-migration-"))
  const legacy = path.join(root, "service.json")
  const target = path.join(root, ServiceConfig.filename("preview-a"))
  try {
    await fs.writeFile(
      legacy,
      JSON.stringify({ id: "old-preview", version: "0.0.0-preview-a-1234", url: "http://localhost:4096", pid: 1 }),
    )
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).json()).toMatchObject({ id: "old-preview" })

    await fs.rm(target)
    await fs.writeFile(legacy, JSON.stringify({ id: "stable", version: "1.2.3", url: "http://localhost:4096", pid: 1 }))
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).exists()).toBe(false)

    await fs.writeFile(
      legacy,
      JSON.stringify({ id: "old-preview", version: "0.0.0-preview-a-1234", url: "http://localhost:4096", pid: 1 }),
    )
    await fs.writeFile(target, JSON.stringify({ id: "current-preview" }))
    await Effect.runPromise(
      ServiceConfig.migrateRegistration(legacy, target, "preview-a", "0.0.0-preview-a-5678").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(legacy).exists()).toBe(true)
    expect(await Bun.file(target).json()).toMatchObject({ id: "current-preview" })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.effect("deleting a managed service registration stops its owner", () =>
  Effect.gen(function* () {
    const service = yield* registered()
    yield* service.fileSystem.remove(service.file)
    yield* service.stops
    yield* service.cleanup
    expect(yield* service.fileSystem.exists(service.file)).toBe(false)
  }),
)

it.effect("corrupting a managed service registration stops its owner", () =>
  Effect.gen(function* () {
    const service = yield* registered()
    yield* service.fileSystem.writeFileString(service.file, "not-json")
    yield* service.stops
    yield* service.cleanup
    expect(yield* service.fileSystem.readFileString(service.file)).toBe("not-json")
  }),
)

it.effect("replacing a managed service registration stops its owner and preserves the foreign owner", () =>
  Effect.gen(function* () {
    const service = yield* registered()
    const foreign = JSON.stringify({ id: "foreign-owner", url: "http://127.0.0.1:4322", pid: process.pid })
    yield* service.fileSystem.writeFileString(service.file, foreign)
    yield* service.stops
    yield* service.cleanup
    expect(yield* service.fileSystem.readFileString(service.file)).toBe(foreign)
  }),
)

// Real process: a server whose boot failed must still be watching its registration.
test("deleting a failed service registration stops its owner", async () => {
  const service = await startManagedService("opencode-service-failed-delete-", true)
  try {
    await waitForFailed(service.info)
    await fs.rm(service.registration)
    expect(await waitForExit(service.owner)).toBe(true)
    await expectPortAvailable(service.port)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("clean managed service shutdown removes its registration", async () => {
  const service = await startManagedService("opencode-service-clean-")
  try {
    await Effect.runPromise(Service.stop({ file: service.registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await waitForExit(service.owner)).toBe(true)
    expect(await Bun.file(service.registration).exists()).toBe(false)
  } finally {
    await stopManagedService(service)
  }
}, 30_000)

test("concurrent service processes elect one server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-election-"))
  const env = serviceEnv(root)
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const port = await availablePort()
  const config = path.join(root, "config", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port }))
  const processes = Array.from({ length: 10 }, () => Bun.spawn(command, { env, stderr: "pipe", stdout: "pipe" }))

  try {
    const info = await waitForInfo(registration)
    const winner = processes.find((process) => process.pid === info.pid)
    const losers = processes.filter((process) => process.pid !== info.pid)
    const exited = await Promise.all(
      losers.map((process) => Promise.race([process.exited.then(() => true), Bun.sleep(60_000).then(() => false)])),
    )

    expect(exited).toEqual(losers.map(() => true))
    const errors = await Promise.all(
      losers.map(
        async (process) => (await new Response(process.stdout).text()) + (await new Response(process.stderr).text()),
      ),
    )
    expect(
      losers.map((process) => process.exitCode),
      errors.filter(Boolean).join("\n"),
    ).toEqual(losers.map(() => 0))
    expect(winner?.exitCode).toBe(null)
    expect(new URL(info.url).port).toBe(String(port))
    expect((await Bun.file(config).json()).password).toBe(info.password)
    expect(await Bun.file(registration + ".lock").exists()).toBe(false)
    expect(
      await fetch(new URL("/api/info", info.url), {
        headers: { authorization: "Basic " + btoa(`opencode:${info.password}`) },
      }).then((response) => response.json()),
    ).toEqual({
      version: info.version,
      pid: info.pid,
      urls: [info.url],
      // The server reports the canonical tmp directory; Windows os.tmpdir() can be an 8.3 short name.
      paths: { tmp: await fs.realpath(path.join(os.tmpdir(), "opencode")) },
      capabilities: { persistentPty: process.platform !== "win32" },
    })
    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    try {
      const contenderExited = await Promise.race([
        contender.exited.then(() => true),
        Bun.sleep(10_000).then(() => false),
      ])
      expect(contenderExited).toBe(true)
      expect(contender.exitCode).toBe(0)
      expect((await waitForInfo(registration)).id).toBe(info.id)
    } finally {
      contender.kill("SIGTERM")
      await contender.exited
    }
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await winner?.exited
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    processes.forEach((process) => process.kill("SIGTERM"))
    await Promise.all(processes.map((process) => process.exited))
    await fs.rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("configured managed service port overrides the channel default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-port-"))
  const port = await availablePort()
  const env = serviceEnv(root)
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const config = path.join(root, "config", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port, password: "" }))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env,
    stderr: "pipe",
    stdout: "ignore",
  })
  try {
    const info = await waitForInfo(registration)
    expect(new URL(info.url).port).toBe(String(port))
    expect(info.password).not.toBe("")
    expect((await Bun.file(config).json()).password).toBe(info.password)
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

test.each([
  { args: [], origins: ["http://192.0.2.10:3001", "https://configured.example.com"] },
  {
    args: ["--cors", "http://192.0.2.20:3001", "--cors", "https://override.example.com"],
    origins: ["http://192.0.2.20:3001", "https://override.example.com"],
  },
])(
  "managed service applies CORS configuration with flag overrides: $args",
  async ({ args, origins }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-cors-"))
    const config = path.join(root, "config", ServiceConfig.filename())
    const registration = path.join(root, "state", "opencode", ServiceConfig.filename())
    const cors = ["http://192.0.2.10:3001", "https://configured.example.com"]
    await fs.mkdir(path.dirname(config), { recursive: true })
    await fs.writeFile(config, JSON.stringify({ cors }))
    const owner = Bun.spawn(
      [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service", "--port", "0", ...args],
      { env: isolatedEnv(root), stderr: "pipe", stdout: "ignore" },
    )
    try {
      const info = await waitForInfo(registration)
      await Promise.all(
        [...new Set([...cors, ...origins, "https://unlisted.example.com"])].map(async (origin) => {
          const response = await fetch(new URL("/api/info", info.url), {
            method: "OPTIONS",
            headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
          })
          expect(response.headers.get("access-control-allow-origin")).toBe(
            origins.some((value) => value === origin) ? origin : null,
          )
        }),
      )
      expect((await Bun.file(config).json()).cors).toEqual(cors)
    } finally {
      owner.kill("SIGTERM")
      await owner.exited
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)

test("the original managed service contender binds when the occupied port is released", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-bind-retry-"))
  const recognizing = Promise.withResolvers<void>()
  const requests: string[] = []
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname)
      if (requests.length === 2) recognizing.resolve()
      return Response.json({ unrelated: true })
    },
  })
  const port = listener.port
  if (port === undefined) throw new Error("Server did not bind a port")
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config"), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(path.join(root, "config", "service-local.json"), JSON.stringify({ port }))
  await fs.writeFile(
    registration,
    JSON.stringify({
      id: "stale",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:1",
      pid: 2_147_483_647,
      password: "stale",
    }),
  )
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: isolatedEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })
  const stderr = new Response(contender.stderr).text()
  try {
    // The first probe is preflight; the second only happens after start() fails to bind.
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    expect(requests).toEqual(["/api/info", "/api/info"])
    await listener.stop(true)

    const info = await Promise.race([
      waitForInfo(registration, (info) => info.pid === contender.pid),
      contender.exited.then(() => undefined),
    ])
    expect(info?.pid, contender.exitCode === null ? undefined : await stderr).toBe(contender.pid)
    const endpoint = await Effect.runPromise(
      Service.discover({ file: registration }).pipe(
        Effect.filterOrFail((value) => value !== undefined),
        Effect.retry({ times: 400, schedule: Schedule.spaced("50 millis") }),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(new URL(endpoint.url).port).toBe(String(port))
    expect(
      await fetch(new URL("/api/info", endpoint.url), { headers: Service.headers(endpoint) }).then((response) =>
        response.json(),
      ),
    ).toMatchObject({ pid: contender.pid, version: OPENCODE_VERSION, urls: [endpoint.url] })
    expect(contender.exitCode).toBe(null)
    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await waitForExit(contender)).toBe(true)
    expect(await Bun.file(registration).exists()).toBe(false)
    await expectPortAvailable(port)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("unresponsive managed port occupancy reports a bounded conflict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-unresponsive-conflict-"))
  const recognizing = Promise.withResolvers<void>()
  const requests = { count: 0 }
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests.count += 1
      if (requests.count === 2) recognizing.resolve()
      return new Promise<Response>(() => {})
    },
  })
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    path.join(root, "config", "opencode", "service-local.json"),
    JSON.stringify({ port: listener.port }),
  )
  const stale = {
    id: "stale",
    version: OPENCODE_VERSION,
    url: "http://127.0.0.1:1",
    pid: process.pid,
    password: "stale",
  }
  await fs.writeFile(registration, JSON.stringify(stale))
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "pipe",
  })

  try {
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    const exitCode = await Promise.race([contender.exited, Bun.sleep(20_000).then(() => undefined)])
    expect(exitCode).toBe(1)
    const output = (await new Response(contender.stdout).text()) + (await new Response(contender.stderr).text())
    expect(output).toContain(`Managed service port ${listener.port} on 127.0.0.1 is already in use by another process`)
    expect(await Bun.file(registration).json()).toEqual(stale)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("port contender recognizes an incumbent registered during the bind race", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-bind-race-"))
  const recognizing = Promise.withResolvers<void>()
  const requests = { count: 0 }
  using listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests.count += 1
      if (requests.count === 2) recognizing.resolve()
      return Response.json(
        { version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } },
        { status: 503 },
      )
    },
  })
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const config = path.join(root, "config", "opencode", "service-local.json")
  await fs.mkdir(path.dirname(config), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port: listener.port }))
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    registration,
    JSON.stringify({
      id: "stale",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:1",
      pid: 2_147_483_647,
      password: "stale",
    }),
  )
  const contender = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })

  try {
    expect(await Promise.race([recognizing.promise.then(() => true), Bun.sleep(20_000).then(() => false)])).toBe(true)
    await Bun.sleep(8_000)
    const info = {
      id: "incumbent",
      version: OPENCODE_VERSION,
      url: `http://127.0.0.1:${listener.port}`,
      pid: process.pid,
      password: "incumbent",
    }
    await fs.writeFile(registration, JSON.stringify(info))

    expect(await Promise.race([contender.exited, Bun.sleep(20_000).then(() => undefined)])).toBe(0)
    expect(await Bun.file(registration).json()).toEqual(info)
  } finally {
    contender.kill("SIGTERM")
    await contender.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 45_000)

test("service registration replaces a stale owner with the bound address", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-stale-"))
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(
    registration,
    JSON.stringify({ id: "dead", version: "dead", url: "http://127.0.0.1:4321", pid: 2_147_483_647 }),
  )
  try {
    const cleanup = await Effect.runPromise(
      ServiceRegistration.register({
        address: { _tag: "TcpAddress", hostname: "127.0.0.1", port: 4321 },
        password: "secret",
        id: "owner",
        file: registration,
        shutdown: Effect.never,
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
    )
    expect(await Bun.file(registration).json()).toEqual({
      id: "owner",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:4321",
      pid: process.pid,
      password: "secret",
    })
    await Effect.runPromise(cleanup.pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("service registration brackets an IPv6 bound address so the URL stays parseable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-ipv6-"))
  const registration = path.join(root, "state", "opencode", "service-local.json")
  try {
    const cleanup = await Effect.runPromise(
      ServiceRegistration.register({
        address: { _tag: "TcpAddress", hostname: "::1", port: 22014 },
        password: "secret",
        id: "owner",
        file: registration,
        shutdown: Effect.never,
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
    )
    const url = (await Bun.file(registration).json()).url
    expect(url).toBe("http://[::1]:22014")
    // The unbracketed form is what broke every reader of this file, so assert on the read itself.
    expect(() => new URL(url)).not.toThrow()
    expect(new URL(url).hostname).toBe("[::1]")
    await Effect.runPromise(cleanup.pipe(Effect.provide(NodeFileSystem.layer)))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("ServerAddress leaves non-IPv6 addresses to effect's formatter", () => {
  expect(ServerAddress.formatAddress({ _tag: "TcpAddress", hostname: "127.0.0.1", port: 4096 })).toBe(
    "http://127.0.0.1:4096",
  )
  expect(ServerAddress.formatAddress({ _tag: "TcpAddress", hostname: "localhost", port: 4096 })).toBe(
    "http://localhost:4096",
  )
  expect(ServerAddress.formatAddress({ _tag: "UnixAddress", path: "/tmp/opencode.sock" })).toBe(
    "unix:///tmp/opencode.sock",
  )
})

test("a failed service stays registered and owns the selected port until stopped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-failed-"))
  const port = await availablePort()
  const database = path.join(root, "database")
  await fs.mkdir(database)
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  await fs.writeFile(path.join(root, "config", "opencode", "service-local.json"), JSON.stringify({ port }))
  const env = { ...serviceEnv(root), OPENCODE_DB: database }
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const registration = path.join(root, "state", "opencode", "service-local.json")
  const owner = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })

  try {
    const info = await waitForInfo(registration)
    await waitForFailed(info)
    expect(owner.exitCode).toBe(null)

    const contender = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
    expect(await Promise.race([contender.exited.then(() => true), Bun.sleep(10_000).then(() => false)])).toBe(true)
    expect(contender.exitCode).toBe(0)
    expect((await waitForInfo(registration)).id).toBe(info.id)
    expect(owner.exitCode).toBe(null)

    await Effect.runPromise(Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)))
    await owner.exited
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

async function waitForInfo(file: string, accept: (info: Info) => boolean = () => true) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (value !== undefined) {
      const info = await Schema.decodeUnknownPromise(Service.Info)(value)
      if (accept(info)) return info
    }
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service registration")
}

async function waitForFailed(info: Info) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const status = await fetch(new URL("/api/info", info.url), {
      headers: { authorization: "Basic " + btoa(`opencode:${info.password}`) },
    })
      .then((response) => response.status)
      .catch(() => undefined)
    if (status === 500) return
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service boot failure")
}

async function availablePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("Server did not bind a port")
  return port
}

/** A registration watched in-process. `stops` advances the test clock until the watch shuts the server down. */
const registered = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const file = path.join(yield* fileSystem.makeTempDirectoryScoped(), "service-local.json")
  const stopped = yield* Deferred.make<void>()
  const cleanup = yield* ServiceRegistration.register({
    address: { _tag: "TcpAddress", hostname: "127.0.0.1", port: 4321 },
    password: "secret",
    id: "owner",
    file,
    shutdown: Deferred.succeed(stopped, undefined).pipe(Effect.asVoid),
  })
  // Let the watch's immediate first check read the intact file, so the damage is found by a scheduled check.
  yield* TestClock.withLive(Effect.sleep("50 millis"))
  // Each check reads the file for real, so give that I/O live time between 5 s steps. Fail rather than hang.
  const stops = Effect.gen(function* () {
    for (const _ of Array.from({ length: 100 })) {
      if (yield* Deferred.isDone(stopped)) return
      yield* TestClock.adjust("5 seconds")
      yield* TestClock.withLive(Effect.sleep("10 millis"))
    }
    return yield* Effect.fail(new Error("The registration watch never shut the server down"))
  })
  return { fileSystem, file, stops, cleanup }
})

function serviceEnv(root: string) {
  return {
    ...process.env,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: transpilerCache,
    HOME: root,
    OPENCODE_DB: path.join(root, "opencode.db"),
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
}

async function startManagedService(prefix: string, failBoot = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const port = await availablePort()
  const registration = path.join(root, "state", "opencode", "service-local.json")
  await fs.mkdir(path.join(root, "config", "opencode"), { recursive: true })
  if (failBoot) await fs.mkdir(path.join(root, "database"))
  await fs.writeFile(path.join(root, "config", "opencode", "service-local.json"), JSON.stringify({ port }))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: failBoot ? { ...serviceEnv(root), OPENCODE_DB: path.join(root, "database") } : serviceEnv(root),
    stderr: "pipe",
    stdout: "ignore",
  })
  const info = await waitForInfo(registration).catch(async (cause) => {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
    throw cause
  })
  return { root, port, registration, owner, info }
}

async function stopManagedService(service: Awaited<ReturnType<typeof startManagedService>>) {
  service.owner.kill("SIGTERM")
  await service.owner.exited
  await fs.rm(service.root, { recursive: true, force: true })
}

function waitForExit(process: Bun.Subprocess, timeout = 10_000) {
  return Promise.race([process.exited.then(() => true), Bun.sleep(timeout).then(() => false)])
}

async function expectPortAvailable(port: number) {
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() })
  await server.stop(true)
}
