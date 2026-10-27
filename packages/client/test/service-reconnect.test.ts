import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { renameSync, writeFileSync } from "node:fs"
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

  test(`${client.name} conditional stop preserves a different same-version owner and pending handoff`, async () => {
    await using previous = await serviceFixture()
    await using current = await serviceFixture()
    previous.spawn("protocol")
    const owner = current.spawn("protocol")
    await Promise.all([previous.waitForFile(), current.waitForFile()])
    const expected = await Bun.file(previous.registration).json()
    const registered = await Bun.file(current.registration).json()
    const pending = JSON.stringify({
      source: { id: expected.id, pid: expected.pid, url: expected.url },
      handoff: null,
      expiresAt: Date.now() + 30_000,
    })
    await Bun.write(previous.registration, JSON.stringify(registered))
    await Bun.write(previous.registration + ".pty-handoff", pending)

    await client.stop({ file: previous.registration, expected, pty: "handoff" })

    expect(owner.exitCode).toBe(null)
    expect(await Bun.file(previous.registration).json()).toEqual(registered)
    expect(await Bun.file(previous.registration + ".pty-handoff").text()).toBe(pending)
    expect(await Bun.file(current.registration + ".handoff-request").exists()).toBe(false)
    expect(await current.signal()).toBeUndefined()
    expect(await fetch(new URL("/api/info", registered.url)).then((response) => response.json())).toMatchObject({
      pid: owner.pid,
    })
  })

  test(`${client.name} conditional stop preserves a pending handoff without a registration`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("protocol")
    await fixture.waitForFile()
    const expected = await Bun.file(fixture.registration).json()
    const pending = JSON.stringify({
      source: { id: expected.id, pid: expected.pid, url: expected.url },
      handoff: null,
      expiresAt: Date.now() + 30_000,
    })
    await Bun.write(fixture.registration + ".pty-handoff", pending)
    await Bun.file(fixture.registration).delete()

    await client.stop({ file: fixture.registration, expected })

    expect(owner.exitCode).toBe(null)
    expect(await fixture.signal()).toBeUndefined()
    expect(await Bun.file(fixture.registration + ".pty-handoff").text()).toBe(pending)
    expect(await Bun.file(fixture.registration).exists()).toBe(false)
  })

  test(`${client.name} conditional stop hands off and stops its observed owner`, async () => {
    await using fixture = await serviceFixture()
    const owner = fixture.spawn("protocol")
    await fixture.waitForFile()
    const expected = await Bun.file(fixture.registration).json()

    await client.stop({ file: fixture.registration, expected, pty: "handoff" })

    expect(await owner.exited).toBe(stoppedExitCode)
    expect(await fixture.signal()).toBe(stopSignal)
    expect(await Bun.file(fixture.registration + ".handoff-request").exists()).toBe(true)
    expect(await Bun.file(fixture.registration).exists()).toBe(false)
  })

  test(`${client.name} replacement preserves a compatible owner published after its decision`, async () => {
    await using previous = await serviceFixture()
    await using current = await serviceFixture()
    previous.spawn("handoff")
    const owner = current.spawn("protocol")
    await Promise.all([previous.waitForFile(), current.waitForFile()])
    const registered = await Bun.file(current.registration).json()
    const pending = JSON.stringify({
      source: { id: registered.id, pid: registered.pid, url: registered.url },
      handoff: null,
      expiresAt: Date.now() + 30_000,
    })
    await Bun.write(previous.registration + ".pty-handoff", pending)
    const starts: EnsureReason[] = []

    const endpoint = await client.ensure({
      file: previous.registration,
      version: "test",
      command: [],
      onStart: (reason) => {
        starts.push(reason)
        writeFileSync(previous.registration + ".replacement", JSON.stringify(registered))
        renameSync(previous.registration + ".replacement", previous.registration)
      },
    })

    expect(starts).toEqual(["version-mismatch"])
    expect(endpoint.url).toBe(registered.url)
    expect(owner.exitCode).toBe(null)
    expect(await Bun.file(previous.registration).json()).toEqual(registered)
    expect(await Bun.file(previous.registration + ".pty-handoff").text()).toBe(pending)
    expect(await Bun.file(current.registration + ".handoff-request").exists()).toBe(false)
    expect(await current.signal()).toBeUndefined()
    expect(await fetch(new URL("/api/info", endpoint.url)).then((response) => response.json())).toMatchObject({
      pid: owner.pid,
    })
  })
}
