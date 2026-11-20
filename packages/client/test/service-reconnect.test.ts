import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Service } from "../src/effect/service"
import { ensure, stop } from "../src/promise/service"
import type { EnsureOptions, EnsureReason, StopOptions } from "../src/service"
import type { EnsureTiming } from "../src/service-timing"
import { serviceFixture, stopSignal, stoppedExitCode } from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

const clients = [
  {
    name: "Promise",
    ensure: (options: EnsureOptions, timing?: Partial<EnsureTiming>) => accelerate(ensure, timing)(options),
    stop,
  },
  {
    name: "Effect",
    ensure: (options: EnsureOptions, timing?: Partial<EnsureTiming>) =>
      Effect.runPromise(accelerate(Service.ensure, timing)(options).pipe(Effect.provide(NodeFileSystem.layer))),
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

    expect(await owner.exited).toBe(stoppedExitCode)
    expect(await fixture.signal()).toBe(stopSignal)
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
    expect(await owner.exited).toBe(stoppedExitCode)
    expect(await fixture.signal()).toBe(stopSignal)
    expect(await Bun.file(fixture.registration).exists()).toBe(false)
  })

  test(`${client.name} keeps a slow owner within its unresponsive budget without spawning contenders`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("hanging")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    const starts: EnsureReason[] = []

    const pending = client.ensure(
      {
        file: fixture.registration,
        command: fixture.command("record-start"),
        onStart: (reason) => starts.push(reason),
      },
      { unresponsiveTimeout: 60_000 },
    )
    await fixture.waitForRequests(5)

    expect(owner.exitCode).toBe(null)
    expect(await Bun.file(fixture.registration + ".signal").exists()).toBe(false)
    expect(await Bun.file(fixture.registration + ".started").exists()).toBe(false)
    expect(starts).toEqual([])

    await Bun.write(fixture.registration + ".release", "")
    const endpoint = await pending
    expect(endpoint.url).toBe(original.url)
    expect(owner.exitCode).toBe(null)
  })

  test(`${client.name} evicts a hung owner once a budget longer than the startup deadline runs out`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("hanging")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    const started = Date.now()
    const endpoint = await client.ensure(
      { file: fixture.registration, command: fixture.command("delayed", "10") },
      { requestTimeout: 80, unresponsiveTimeout: 700, spawnDelay: 100, promiseTimeout: 250 },
    )
    const replacement = await Bun.file(fixture.registration).json()
    fixture.track(replacement.pid)

    expect(Date.now() - started).toBeGreaterThanOrEqual(700)
    expect(await owner.exited).toBe(stoppedExitCode)
    expect(replacement.pid).not.toBe(original.pid)
    expect(endpoint.url).toBe(replacement.url)
  })

  test(`${client.name} keeps a server it started that stops answering until the startup deadline`, async () => {
    await using fixture = await serviceFixture()
    const pending = client
      .ensure({ file: fixture.registration, command: fixture.command("controlled") })
      .catch((error: unknown) => error)
    const [started] = await fixture.waitForStarts(1)
    await fixture.release(started, "hang")
    // Unanswered for longer than the 320 ms unresponsive budget, which would evict a service it did not start.
    await fixture.waitForRequests(5)
    expect(() => process.kill(started, 0)).not.toThrow()
    const error = await pending

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw error
    expect(error.message).toBe("Timed out waiting for the background service to start")
    expect((await Bun.file(fixture.registration).json()).pid).toBe(started)
    expect(() => process.kill(started, 0)).not.toThrow()
  })
}
