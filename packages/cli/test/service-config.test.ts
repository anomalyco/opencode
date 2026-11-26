import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, FileSystem } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { OPENCODE_VERSION } from "../src/version"
import { it } from "../../core/test/lib/effect"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

it.live("missing service.json returns an empty config and initializes cleanly on first write", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-service-config-missing-" })
    const config = path.join(root, "config")
    const state = path.join(root, "state")
    const file = path.join(config, ServiceConfig.filename())

    yield* Effect.gen(function* () {
      expect(yield* ServiceConfig.read()).toEqual({})
      expect(yield* fs.exists(file)).toBe(false)

      yield* fs.makeDirectory(config)
      expect(yield* ServiceConfig.read()).toEqual({})

      const created = yield* ServiceConfig.password()
      expect(created.length).toBeGreaterThan(0)
      yield* ServiceConfig.set("port", "4321")
      expect(yield* ServiceConfig.read()).toEqual({ password: created, port: 4321 })
    }).pipe(Effect.provideService(Global.Service, Global.make({ config, state })))
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.live("corrupt or invalid service.json fails with ServiceConfig.InvalidError and is never overwritten", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-service-config-corrupt-" })
    const config = path.join(root, "config")
    const state = path.join(root, "state")
    const file = path.join(config, ServiceConfig.filename())
    const registration = path.join(state, ServiceConfig.filename())
    yield* fs.makeDirectory(config)
    yield* fs.makeDirectory(state)

    const samples = [
      '{"hostname":"0.0.0.0","port":"4096","password":"keep-me","cors":["https://app.example.com"],"env":{"KEEP":"1"}}\n',
      '{"port": 4096,',
      '{"remote":true,"port":"4096","password":"keep-me"}',
    ]

    yield* Effect.forEach(samples, (raw) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(file, raw)
        const registered = JSON.stringify({
          id: "keep-running",
          url: "http://127.0.0.1:9",
          pid: 2_147_483_647,
          password: "keep-me",
        })
        yield* fs.writeFileString(registration, registered)

        const readExit = yield* ServiceConfig.read().pipe(Effect.exit)
        expect(Exit.isFailure(readExit)).toBe(true)
        if (Exit.isFailure(readExit)) {
          const error = Cause.squash(readExit.cause)
          expect(error).toBeInstanceOf(ServiceConfig.InvalidError)
          if (error instanceof ServiceConfig.InvalidError) {
            expect(error._tag).toBe("ServiceConfig.InvalidError")
            expect(error.path).toBe(file)
            expect(error.issue.length).toBeGreaterThan(0)
            expect(error.message).toContain(file)
            expect(error.message).toContain(error.issue)
          }
        }

        yield* Effect.forEach(
          [
            ServiceConfig.options(),
            ServiceConfig.get(),
            ServiceConfig.get("port"),
            ServiceConfig.get("password"),
            ServiceConfig.password(),
            ServiceConfig.password("replacement"),
            ServiceConfig.acceptRemote(),
            ServiceConfig.remote(),
            ServiceConfig.set("disabled", "true"),
            ServiceConfig.set("disabled", "false"),
            ServiceConfig.set("remote", "true"),
            ServiceConfig.set("remote", "false"),
            ServiceConfig.set("hostname", "127.0.0.1"),
            ServiceConfig.set("port", "4097"),
            ServiceConfig.set("password", "replacement"),
            ServiceConfig.set("env", "OTHER", "2"),
            ServiceConfig.set("cors", "https://other.example.com"),
            ServiceConfig.unset("disabled"),
            ServiceConfig.unset("remote"),
            ServiceConfig.unset("hostname"),
            ServiceConfig.unset("port"),
            ServiceConfig.unset("password"),
            ServiceConfig.unset("env", "KEEP"),
            ServiceConfig.unset("cors"),
          ],
          (operation) =>
            Effect.gen(function* () {
              const exit = yield* operation.pipe(Effect.exit)
              expect(Exit.isFailure(exit)).toBe(true)
              if (Exit.isFailure(exit)) {
                expect(Cause.squash(exit.cause)).toBeInstanceOf(ServiceConfig.InvalidError)
              }
              expect(yield* fs.readFileString(file)).toBe(raw)
              expect(yield* fs.readFileString(registration)).toBe(registered)
            }),
        )

        expect(yield* ServiceConfig.registrationFile()).toBe(registration)
      }),
    ).pipe(Effect.provideService(Global.Service, Global.make({ config, state })))
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.live("unreadable service.json fails with PlatformError instead of returning empty config or overwriting", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-service-config-unreadable-" })
    const config = path.join(root, "config")
    const state = path.join(root, "state")
    const file = path.join(config, ServiceConfig.filename())
    yield* fs.makeDirectory(file, { recursive: true })

    yield* Effect.forEach(
      [ServiceConfig.read(), ServiceConfig.password(), ServiceConfig.set("port", "4097"), ServiceConfig.unset("port")],
      (operation) =>
        Effect.gen(function* () {
          const exit = yield* operation.pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "PlatformError" })
          }
          expect((yield* fs.stat(file)).type).toBe("Directory")
        }),
    ).pipe(Effect.provideService(Global.Service, Global.make({ config, state })))
  }).pipe(Effect.provide(NodeServices.layer)),
)

test("serve --service fails on invalid service.json without overwriting existing settings", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "config", ServiceConfig.filename())
  const registration = path.join(root.path, "state", "opencode", ServiceConfig.filename())
  const raw = '{"hostname":"127.0.0.1","port":"4096","password":"keep-me","env":{"KEEP":"1"}}\n'
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, raw)

  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: isolatedEnv(root.path),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  expect(stderr, stdout).toContain(`Invalid service config at ${file}`)
  expect(stderr).toContain('["port"]')
  expect(exitCode).toBe(1)
  expect(await Bun.file(file).text()).toBe(raw)
  expect(await Bun.file(registration).exists()).toBe(false)
})

test("service status and service stop still operate on a registered server when service.json is invalid", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "config", ServiceConfig.filename())
  const registration = path.join(root.path, "state", "opencode", ServiceConfig.filename())
  const raw = '{"port":"4096","password":"keep-me"}\n'
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(file, raw)

  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ version: OPENCODE_VERSION, pid: 2_147_483_647, urls: [] }),
  })
  const url = server.url.origin
  await fs.writeFile(
    registration,
    JSON.stringify({
      id: "running",
      version: OPENCODE_VERSION,
      url,
      pid: 2_147_483_647,
    }),
  )

  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), ...args], {
      env: isolatedEnv(root.path),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  }

  expect(await cli("service", "status")).toEqual({ stdout: url, stderr: "", exitCode: 0 })
  expect(await cli("service", "stop")).toEqual({ stdout: "", stderr: "", exitCode: 0 })
  expect(await Bun.file(registration).exists()).toBe(false)
  expect(await Bun.file(file).text()).toBe(raw)
})
