import { expect, test } from "bun:test"
import { Service, type EnsureReason } from "../src/promise/service"
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

test("passes the prepared handoff to the replacement server", async () => {
  await using fixture = await serviceFixture()
  const registration = fixture.registration
  fixture.spawn("handoff")
  await fixture.waitForFile()
  await ensure({
    file: registration,
    version: "test",
    command: fixture.command("environment"),
    env: { OPENCODE_PTY_HANDOFF: "must-not-inherit" },
  })
  const replacement = await Bun.file(registration).json()
  fixture.track(replacement.pid)

  expect(await Bun.file(registration + ".handoff").json()).toEqual(await Bun.file(registration + ".prepared").json())
  expect(await Bun.file(registration + ".pty-handoff").exists()).toBe(false)
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

  await Service.stop({ file: registration })

  expect(await Bun.file(registration + ".signal").text()).toBe("SIGTERM")
  expect(await Bun.file(registration).exists()).toBe(false)
})
