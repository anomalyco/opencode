import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, type FileSystem } from "effect"
import { join } from "node:path"
import { Service } from "../src/effect/service"
import { discover, ensure, headers, localServiceDirectories, stop } from "../src/promise/service"
import type { DiscoverOptions, EnsureOptions, StopOptions } from "../src/service"
import { serviceFixture, stoppedExitCode } from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

const effectEnsure = accelerate(Service.ensure)
const effectStop = accelerate(Service.stop)
const clients = [
  { name: "Promise", discover, ensure: accelerate(ensure), stop: accelerate(stop) },
  {
    name: "Effect",
    discover: (options: DiscoverOptions) => run(Service.discover(options)),
    ensure: (options: EnsureOptions) => run(effectEnsure(options)),
    stop: (options: StopOptions) => run(effectStop(options)),
  },
]

test("local service directories use the config override and XDG data root", () => {
  const base = import.meta.dir
  expect(
    localServiceDirectories({
      OPENCODE_CONFIG_DIR: join(base, "override"),
      XDG_CONFIG_HOME: join(base, "config"),
      XDG_DATA_HOME: join(base, "data"),
    }),
  ).toEqual({ config: join(base, "override"), data: join(base, "data", "opencode") })
})

for (const client of clients) {
  test(`${client.name} refuses a foreign process before health checks, version replacement or stop`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("hanging")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    const directories = { config: join(fixture.directory, "config"), data: join(fixture.directory, "data") }
    const registered = { ...original, directories }
    await Bun.write(fixture.registration, JSON.stringify(registered))

    for (const expected of [
      { ...directories, config: join(fixture.directory, "other-config") },
      { ...directories, data: join(fixture.directory, "other-data") },
    ]) {
      const options = { file: fixture.registration, directories: expected }
      const mismatch = "different config or data directory"
      await expect(client.discover(options)).rejects.toThrow(mismatch)
      await expect(client.ensure({ ...options, version: "another", command: [] })).rejects.toThrow(mismatch)
      await expect(client.stop(options)).rejects.toThrow(mismatch)
    }

    expect(owner.exitCode).toBeNull()
    expect(await Bun.file(fixture.registration + ".requests").exists()).toBe(false)
    expect(await Bun.file(fixture.registration).json()).toEqual(registered)
  })

  test(`${client.name} checks health for a foreign owner whose PID is not visible`, async () => {
    await using fixture = await serviceFixture()
    // A PID from the service's namespace can be valid in its health response but absent locally.
    const pid = 0x7fffffff
    expect(() => process.kill(pid, 0)).toThrow()
    const auth = { type: "basic", username: "opencode", password: "private" } as const
    let waiting = false
    using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (request.headers.get("authorization") !== headers({ url: request.url, auth })?.authorization)
          return new Response(null, { status: 401 })
        if (waiting) return new Promise<Response>(() => {})
        return Response.json({ pid, version: "test" })
      },
    })
    const directories = { config: join(fixture.directory, "config"), data: join(fixture.directory, "data") }
    const url = server.url.toString()
    const info = { pid, url, version: "test", password: auth.password, directories }
    await Bun.write(fixture.registration, JSON.stringify(info))

    const options = { file: fixture.registration, directories }
    expect(await client.discover(options)).toEqual({ url, auth })
    expect(await client.ensure({ ...options, command: [] })).toEqual({ url, auth })

    const foreign = { ...options, directories: { ...directories, data: join(fixture.directory, "other-data") } }
    await expect(client.discover(foreign)).rejects.toThrow("different config or data directory")
    await expect(client.ensure({ ...foreign, version: "another", command: [] })).rejects.toThrow(
      "different config or data directory",
    )
    await expect(client.stop(foreign)).rejects.toThrow("different config or data directory")

    waiting = true
    await expect(client.ensure({ ...foreign, command: [] })).rejects.toThrow("different config or data directory")
    expect(await Bun.file(fixture.registration).json()).toEqual(info)

    await server.stop(true)
    expect(await client.discover(foreign)).toBeUndefined()
  })

  test(`${client.name} refuses unverified legacy reuse and permits an explicit stop`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("compatible")
    await fixture.waitForFile()
    const options = {
      file: fixture.registration,
      directories: { config: join(fixture.directory, "config"), data: join(fixture.directory, "data") },
    }
    await expect(client.discover(options)).rejects.toThrow("does not report its config and data directories")
    await expect(client.ensure({ ...options, command: [] })).rejects.toThrow(
      "does not report its config and data directories",
    )
    expect(owner.exitCode).toBeNull()

    await client.stop(options)
    expect(await owner.exited).toBe(stoppedExitCode)
    expect(await Bun.file(fixture.registration).exists()).toBe(false)
  })
}

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))
}
