import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Service } from "../src/effect/service"
import { ensure, stop } from "../src/promise/service"
import type { EnsureOptions, EnsureReason, StopOptions } from "../src/service"
import { serviceFixture, stopSignal, stoppedExitCode } from "./fixture/service-fixture"
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

  test(`${client.name} reconnect waits out an owner that stops answering for a while`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("stalling")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    await Bun.write(fixture.registration + ".stall", "")
    const reconnect = client.ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("record-start"),
    })

    // Outlast the three timed-out probes that used to get a live owner killed.
    await fixture.waitForRequests(4)
    await Bun.file(fixture.registration + ".stall").delete()

    expect((await reconnect).url).toBe(original.url)
    expect(owner.exitCode).toBe(null)
    expect(await fixture.signal()).toBeUndefined()
    expect(await Bun.file(fixture.registration + ".started").exists()).toBe(false)
  })

  test(`${client.name} reconnect keeps a silent owner whose health thread reports it busy`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("busy")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    await Bun.write(fixture.registration + ".stall", "")
    await Bun.write(fixture.registration + ".health", JSON.stringify({ blocked: 500 }))
    const reconnect = client.ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("record-start"),
    })

    // Stay silent well past the window that replaces an owner without a health thread.
    await fixture.waitForRequests(12)
    await Bun.file(fixture.registration + ".stall").delete()

    expect((await reconnect).url).toBe(original.url)
    expect(owner.exitCode).toBe(null)
    expect(await fixture.signal()).toBeUndefined()
  })

  test(`${client.name} reconnect keeps an owner waiting on disk however long it is blocked`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("busy")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    await Bun.write(fixture.registration + ".stall", "")
    await Bun.write(fixture.registration + ".health", JSON.stringify({ blocked: 600_000, disk: true }))
    const reconnect = client.ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("record-start"),
    })

    await fixture.waitForRequests(4)
    await Bun.file(fixture.registration + ".stall").delete()

    expect((await reconnect).url).toBe(original.url)
    expect(owner.exitCode).toBe(null)
    expect(await fixture.signal()).toBeUndefined()
  })

  test(`${client.name} reconnect replaces a hung owner as soon as its health thread says so`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("busy")
    await fixture.waitForFile()
    const original = await Bun.file(fixture.registration).json()
    await Bun.write(fixture.registration + ".stall", "")
    await Bun.write(fixture.registration + ".health", JSON.stringify({ blocked: 600_000 }))

    const endpoint = await client.ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("delayed", "10"),
    })
    const replacement = await Bun.file(fixture.registration).json()
    fixture.track(replacement.pid)

    expect(await owner.exited).toBe(stoppedExitCode)
    expect(replacement.pid).not.toBe(original.pid)
    expect(endpoint.url).toBe(replacement.url)
    // The first timed-out probe was enough: the service measured its own block.
    expect((await Bun.file(fixture.registration + ".requests").text()).trim().split("\n")).toHaveLength(1)
    expect(await Bun.file(fixture.registration + ".recovery").exists()).toBe(false)
  })

  test(`${client.name} reconnect leaves a hung owner to the client already replacing it`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("busy")
    await fixture.waitForFile()
    await Bun.write(fixture.registration + ".stall", "")
    await Bun.write(fixture.registration + ".health", JSON.stringify({ blocked: 600_000 }))
    // Another live client holds the recovery lock.
    await Bun.write(fixture.registration + ".recovery", String(process.pid))
    const reconnect = client.ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("delayed", "10"),
    })

    await fixture.waitForRequests(4)
    expect(owner.exitCode).toBe(null)
    expect(await fixture.signal()).toBeUndefined()

    // That client gives up without replacing it, so this one does.
    await Bun.file(fixture.registration + ".recovery").delete()
    const endpoint = await reconnect
    const replacement = await Bun.file(fixture.registration).json()
    fixture.track(replacement.pid)
    expect(await owner.exited).toBe(stoppedExitCode)
    expect(endpoint.url).toBe(replacement.url)
  })

  test(`${client.name} reconnect waits for the replacement another client is starting`, async () => {
    await using fixture = await serviceFixture()
    await Bun.write(fixture.registration + ".recovery", String(process.pid))
    const reconnect = client.ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("delayed", "10"),
    })

    // With nothing registered this client would start a contender at once.
    await Bun.sleep(300)
    expect(await fixture.starts()).toEqual([])
    const replacement = fixture.spawn("graceful")
    await fixture.waitForFile()

    expect((await reconnect).url).toBe((await Bun.file(fixture.registration).json()).url)
    expect(await fixture.starts()).toEqual([])
    expect((await Bun.file(fixture.registration).json()).pid).toBe(replacement.pid)
  })

  test(`${client.name} reconnect takes over the lock of a client that died while recovering`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("busy")
    await fixture.waitForFile()
    await Bun.write(fixture.registration + ".stall", "")
    await Bun.write(fixture.registration + ".health", JSON.stringify({ blocked: 600_000 }))
    const dead = Bun.spawn([process.execPath, "-e", ""])
    await dead.exited
    await Bun.write(fixture.registration + ".recovery", String(dead.pid))

    const endpoint = await client.ensure({
      file: fixture.registration,
      version: "test",
      command: fixture.command("delayed", "10"),
    })
    fixture.track((await Bun.file(fixture.registration).json()).pid)

    expect(await owner.exited).toBe(stoppedExitCode)
    expect(endpoint.url).toBe((await Bun.file(fixture.registration).json()).url)
    expect(await Bun.file(fixture.registration + ".recovery").exists()).toBe(false)
  })

  test(`${client.name} reconnect says why it gave up on an owner it left running`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("busy")
    await fixture.waitForFile()
    await Bun.write(fixture.registration + ".stall", "")
    await Bun.write(fixture.registration + ".health", JSON.stringify({ blocked: 600_000, disk: true }))

    const error = await client
      .ensure({ file: fixture.registration, version: "test", command: fixture.command("record-start") })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw error
    expect(error.message).toContain(`Background service ${owner.pid} is running, but has been waiting on disk`)
    expect(owner.exitCode).toBe(null)
  })

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
}
