import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { Service, type EnsureReason } from "../src/promise/service"
import { ServiceHandoff } from "../src/service-handoff"
import { serviceFixture } from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

const ensure = accelerate(Service.ensure)

test("discovers a registered service", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn("graceful")
  await fixture.waitForFile()

  expect(await Service.discover({ file: registration, version: "test" })).toEqual(
    expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }),
  )
  expect(await Service.discover({ file: registration, version: "other" })).toBeUndefined()
})

test("discovers a compatible registered service", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn("compatible")
  await fixture.waitForFile()

  expect(await Service.discover({ file: registration, version: "2.1.0" })).toBeUndefined()
  expect(await Service.discover({ file: registration, version: "2.1.0-next.1" })).toEqual(
    expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }),
  )
  expect(await Service.discover({ file: registration, version: (version) => version.startsWith("2.") })).toEqual(
    expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }),
  )
  expect(await Service.discover({ file: registration, version: (version) => version.startsWith("3.") })).toBeUndefined()
})

test("ensures a missing service with native promises", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const starts: EnsureReason[] = []

  const endpoint = await ensure({
    file: registration,
    version: "test",
    command: fixture.command("coordinated"),
    onStart: (reason) => starts.push(reason),
  })
  const info = await Bun.file(registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
  expect(starts).toEqual(["missing"])
})

test("adds configured environment variables with native promises", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const endpoint = await ensure({
    file: registration,
    version: "test",
    command: fixture.command("environment"),
    env: { OPENCODE_SERVICE_ENV_TEST: "configured" },
  })
  const info = await Bun.file(registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
  expect(await Bun.file(registration + ".environment").text()).toBe("configured")
})

test.each(["handoff", "handoff-null", "old"])("replaces %s with the acknowledged terminal policy", async (mode) => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn(mode)
  await fixture.waitForFile()
  await ensure({
    file: registration,
    version: "test",
    command: fixture.command("environment"),
    env: { OPENCODE_PTY_HANDOFF: "must-not-inherit" },
  })
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  const captured = JSON.parse((await Bun.file(registration + ".handoffs").text()).trim()).handoff
  expect(captured === null ? null : JSON.parse(captured)).toEqual(
    mode === "old" ? null : await Bun.file(registration + ".prepared").json(),
  )
  expect(await Bun.file(registration + ".pty-requests").text()).toBe(
    mode === "old" ? "prepare\nshutdown\n" : "prepare\n",
  )
  expect(await Bun.file(registration + ".pty-handoff").exists()).toBe(false)
})

test("does not terminate a healthy server when handoff preparation fails", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn("handoff-failed")
  await fixture.waitForFile()
  await expect(ensure({ file: registration, version: "test", command: [] })).rejects.toThrow(
    "Failed to prepare persistent terminals for service replacement: HTTP 500",
  )
  expect(await Bun.file(registration + ".signal").exists()).toBe(false)
})

test("accepts a shared handoff when concurrent preparation receives a stopping response", async () => {
  await using fixture = await serviceFixture()
  const file = fixture.registration
  const handoff = {
    directory: fixture.directory,
    instanceID: "daemon",
    ticket: "ticket",
    expiresAt: Date.now() + 120_000,
  }
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let requests = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      if (++requests !== 1) return Response.json({ handoff })
      requested.resolve()
      await release.promise
      return new Response(null, { status: 503 })
    },
  })
  const info = { id: "server", pid: process.pid, url: server.url.toString() }
  const first = ServiceHandoff.prepare(file, info, 5_000)
  try {
    await requested.promise
    await ServiceHandoff.prepare(file, info, 5_000)
    release.resolve()
    await first
    expect(requests).toBe(2)
    expect(await ServiceHandoff.environment(file)).toEqual({ OPENCODE_PTY_HANDOFF: JSON.stringify(handoff) })
  } finally {
    release.resolve()
    await first.catch(() => undefined)
    await server.stop(true)
  }
})

test("waits for a live contender when another native contender fails", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration

  const endpoint = await ensure({
    file: registration,
    version: "test",
    command: fixture.command("coordinated-failed-loser", "300"),
  })
  const info = await Bun.file(registration).json()
  fixture.track(info.pid)

  expect(endpoint.url).toBe(info.url)
})

test("reports a failed registered service", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn("failed-owner")
  await fixture.waitForFile()

  await expect(ensure({ file: registration, version: "test", command: [] })).rejects.toThrow(
    "Background service failed to start",
  )
})

test("reports a bounded contender stderr tail with native promises", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const error = await Service.ensure({
    file: registration,
    version: "test",
    command: fixture.command("stderr-failed"),
  }).catch((error: unknown) => error)

  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).toContain("actionable startup failure")
  expect(error.message.length).toBeLessThan(9_000)
}, 10_000)

test("evicts an unresponsive registered service before starting its replacement", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  const existing = fixture.spawn("hanging")
  await fixture.waitForFile()
  const original = await Bun.file(registration).json()

  const endpoint = await ensure({
    file: registration,
    version: "test",
    command: fixture.command("delayed", "10"),
  })
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  expect((await Bun.file(registration + ".requests").text()).trim().split("\n")).toHaveLength(3)
  expect(await existing.exited).toBe(0)
  expect(replacement.pid).not.toBe(original.pid)
  expect(endpoint.url).toBe(replacement.url)
})

test("signals the registered service process", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn("graceful")
  await fixture.waitForFile()
  const source = await Bun.file(registration).json()
  const handoff = { directory: "unused", instanceID: "daemon", ticket: "ticket", expiresAt: Date.now() + 30_000 }
  await writeFile(registration + ".pty-handoff", JSON.stringify({ source, handoff, expiresAt: 0 }))
  expect((await ServiceHandoff.environment(registration)).OPENCODE_PTY_HANDOFF).toBeUndefined()
  await writeFile(
    registration + ".pty-handoff",
    JSON.stringify({
      source: { ...source, id: "another-server" },
      handoff,
      expiresAt: handoff.expiresAt,
    }),
  )
  expect((await ServiceHandoff.environment(registration)).OPENCODE_PTY_HANDOFF).toBeUndefined()

  await Service.stop({ file: registration })

  expect(await Bun.file(registration + ".signal").text()).toBe("SIGTERM")
  expect(await Bun.file(registration).exists()).toBe(false)
  expect(await Bun.file(registration + ".pty-handoff").exists()).toBe(false)
})
