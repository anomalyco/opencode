import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
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

    yield* Effect.gen(function* () {
      expect(yield* ServiceConfig.read()).toEqual({})
      const created = yield* ServiceConfig.password()
      yield* ServiceConfig.set("port", "4321")
      expect(yield* ServiceConfig.read()).toEqual({ password: created, port: 4321 })
    }).pipe(Effect.provideService(Global.Service, Global.make({ config, state })))
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.live("corrupt or unreadable service.json fails cleanly and is never overwritten", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-service-config-corrupt-" })
    const config = path.join(root, "config")
    const state = path.join(root, "state")
    const file = path.join(config, ServiceConfig.filename())
    const registration = path.join(state, ServiceConfig.filename())
    yield* fs.makeDirectory(config)
    yield* fs.makeDirectory(state)

    const registered = JSON.stringify({ id: "keep-running", url: "http://127.0.0.1:9", pid: 2_147_483_647 })
    yield* fs.writeFileString(registration, registered)

    yield* Effect.gen(function* () {
      const samples = [
        '{"hostname":"0.0.0.0","port":"4096","password":"keep-me","env":{"KEEP":"1"}}\n',
        '{"port": 4096,',
        '{"remote":true,"port":"4096","password":"keep-me"}',
      ]

      yield* Effect.forEach(samples, (raw) =>
        Effect.gen(function* () {
          yield* fs.writeFileString(file, raw)
          const error = yield* ServiceConfig.read().pipe(Effect.flip)
          expect(error).toBeInstanceOf(ServiceConfig.InvalidError)
          expect(error.message).toContain(file)

          yield* Effect.forEach(
            [
              ServiceConfig.password(),
              ServiceConfig.set("port", "4097"),
              ServiceConfig.set("remote", "true"),
              ServiceConfig.unset("port"),
            ],
            (write) =>
              Effect.gen(function* () {
                expect(yield* write.pipe(Effect.flip)).toBeInstanceOf(ServiceConfig.InvalidError)
                expect(yield* fs.readFileString(file)).toBe(raw)
                expect(yield* fs.readFileString(registration)).toBe(registered)
              }),
          )
        }),
      )

      yield* fs.remove(file)
      yield* fs.makeDirectory(file)
      expect(yield* ServiceConfig.set("port", "4097").pipe(Effect.flip)).toMatchObject({ _tag: "PlatformError" })
      expect((yield* fs.stat(file)).type).toBe("Directory")
    }).pipe(Effect.provideService(Global.Service, Global.make({ config, state })))
  }).pipe(Effect.provide(NodeServices.layer)),
)

test("CLI refuses to overwrite an invalid service.json on serve --service while status and stop still work", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "config", ServiceConfig.filename())
  const registration = path.join(root.path, "state", "opencode", ServiceConfig.filename())
  const raw = '{"hostname":"127.0.0.1","port":"4096","password":"keep-me","env":{"KEEP":"1"}}\n'
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await fs.writeFile(file, raw)

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

  const serve = await cli("serve", "--service")
  expect(serve.exitCode).toBe(1)
  expect(serve.stderr).toContain(`Invalid service config at ${file}`)
  expect(serve.stderr).toContain('["port"]')
  expect(await Bun.file(file).text()).toBe(raw)
  expect(await Bun.file(registration).exists()).toBe(false)

  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ version: OPENCODE_VERSION, pid: 2_147_483_647, urls: [] }),
  })
  const url = server.url.origin
  await fs.writeFile(
    registration,
    JSON.stringify({ id: "running", version: OPENCODE_VERSION, url, pid: 2_147_483_647 }),
  )

  expect(await cli("service", "status")).toEqual({ stdout: url, stderr: "", exitCode: 0 })
  expect(await cli("service", "stop")).toEqual({ stdout: "", stderr: "", exitCode: 0 })
  expect(await Bun.file(registration).exists()).toBe(false)
  expect(await Bun.file(file).text()).toBe(raw)
})
