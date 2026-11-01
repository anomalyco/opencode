import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode/client/service"
import { Global } from "@opencode/util/global"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { serviceFixture } from "../../client/test/fixture/service-fixture"
import { accelerate } from "../../client/test/fixture/service-timing"
import { ServiceConfig } from "../src/services/service-config"

test("service restart uses the configured startup owner without changing policy or stopping work on configuration edits", async () => {
  // This fixture serves static health responses; it never loads a model or the application server.
  await using fixture = await serviceFixture()
  const config = path.join(fixture.directory, "config")
  await mkdir(config)
  const layer = Global.layerWith({ config, state: fixture.directory })
  const run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.provide(NodeFileSystem.layer)))
  fixture.spawn("graceful")
  await fixture.waitForFile()
  const previous = await readFile(fixture.registration, "utf8")
  const command = fixture.command("environment")
  const file = path.join(config, ServiceConfig.filename())
  await writeFile(file, JSON.stringify({ password: "private-canary" }))
  for (const value of ["[]", '[""]', '"opencode"']) {
    await expect(run(ServiceConfig.set("command", value))).rejects.toThrow()
  }
  await run(ServiceConfig.set("command", JSON.stringify(command)))
  expect(await readFile(fixture.registration, "utf8")).toBe(previous)
  expect(JSON.parse(await run(ServiceConfig.get("command")))).toEqual(command)
  expect((await run(ServiceConfig.read())).password).toBe("private-canary")
  const options = await run(ServiceConfig.options())
  expect(options.command).toEqual(command)
  await accelerate(Service.stop)({ file: fixture.registration })
  const endpoint = await accelerate(Service.ensure)({ ...options, file: fixture.registration })
  const current = JSON.parse(await readFile(fixture.registration, "utf8"))
  fixture.track(current.pid)
  expect(endpoint.url).toBe(current.url)
  expect(current.pid).not.toBe(JSON.parse(previous).pid)
  expect(await Bun.file(fixture.registration + ".environment").exists()).toBe(true)
  await run(ServiceConfig.unset("command"))
  expect(JSON.parse(await readFile(fixture.registration, "utf8")).pid).toBe(current.pid)
  expect((await run(ServiceConfig.options())).command.slice(-2)).toEqual(["serve", "--service"])
  for (const value of ['{"command":[],"password":"private-canary"}', '{"password":"private-canary"']) {
    await writeFile(file, value)
    await expect(run(ServiceConfig.options())).rejects.toThrow("Invalid service configuration")
  }
})
