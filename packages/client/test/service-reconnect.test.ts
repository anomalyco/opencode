import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Service } from "../src/effect/service"
import { ensure, stop } from "../src/promise/service"
import type { EnsureOptions, EnsureReason, StopOptions } from "../src/service"
import { serviceFixture } from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

const effect = accelerate(Service.ensure)
const clients = [
  { name: "Promise", ensure: accelerate(ensure), stop },
  {
    name: "Effect",
    ensure: (options: EnsureOptions) => Effect.runPromise(effect(options).pipe(Effect.provide(NodeFileSystem.layer))),
    stop: (options: StopOptions) => Effect.runPromise(Service.stop(options).pipe(Effect.provide(NodeFileSystem.layer))),
  },
]

for (const client of clients) {
  for (const policy of [
    { name: "no version requirement", version: undefined },
    { name: "matching exact version", version: "test" },
    { name: "accepting version predicate", version: (version: string) => version === "test" },
  ]) {
    test(`${client.name} reconnect preserves a protocol-incompatible owner with ${policy.name}`, async () => {
      await using fixture = await serviceFixture()
      const owner = fixture.spawn("protocol")
      await fixture.waitForFile()
      const original = await Bun.file(fixture.registration).json()
      const starts: EnsureReason[] = []
      const options = {
        file: fixture.registration,
        version: policy.version,
        command: fixture.command("record-start"),
        onStart: (reason: EnsureReason) => starts.push(reason),
      }
      expect((await client.ensure(options)).url).toBe(original.url)

      // The same process remains alive. Only its health endpoint becomes unavailable.
      await Bun.write(fixture.registration + ".missing-health", "")
      const error = await client.ensure(options).catch((error: unknown) => error)
      expect(await Bun.file(fixture.registration + ".signal").exists()).toBe(false)
      expect(await Bun.file(fixture.registration + ".handoff-request").exists()).toBe(false)
      expect(await Bun.file(fixture.registration + ".started").exists()).toBe(false)
      expect(starts).toEqual([])
      expect(owner.exitCode).toBe(null)
      expect(await Bun.file(fixture.registration).json()).toEqual(original)
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) throw error
      expect(error.message).toContain("incompatible health protocol")

      await Bun.file(fixture.registration + ".missing-health").delete()
      expect((await client.ensure(options)).url).toBe(original.url)
      expect(owner.exitCode).toBe(null)
    })
  }

  test(`${client.name} can explicitly replace a protocol-incompatible owner with a nonmatching version`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("protocol")
    await fixture.waitForFile()
    await Bun.write(fixture.registration + ".missing-health", "")
    const starts: EnsureReason[] = []
    const endpoint = await client.ensure({
      file: fixture.registration,
      version: "2.1.0-next.1",
      command: fixture.command("compatible"),
      onStart: (reason) => starts.push(reason),
    })
    const replacement = await Bun.file(fixture.registration).json()
    fixture.track(replacement.pid)

    expect(await owner.exited).toBe(0)
    expect(await Bun.file(fixture.registration + ".signal").text()).toBe("SIGTERM")
    expect(await Bun.file(fixture.registration + ".handoff-request").exists()).toBe(true)
    expect(starts).toEqual(["version-mismatch"])
    expect(replacement.pid).not.toBe(owner.pid)
    expect(replacement.version).toBe("2.1.0-next.1")
    expect(endpoint.url).toBe(replacement.url)
  })

  test(`${client.name} can explicitly stop a protocol-incompatible owner`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("protocol")
    await fixture.waitForFile()
    await Bun.write(fixture.registration + ".missing-health", "")

    await client.stop({ file: fixture.registration })
    expect(await owner.exited).toBe(0)
    expect(await Bun.file(fixture.registration + ".signal").text()).toBe("SIGTERM")
    expect(await Bun.file(fixture.registration).exists()).toBe(false)
  })
}
