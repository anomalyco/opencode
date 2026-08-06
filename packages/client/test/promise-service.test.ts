import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Service, type EnsureReason } from "../src/promise/service"

const fixture = join(import.meta.dir, "fixture/service.ts")
const processes: Bun.Subprocess[] = []
const directories: string[] = []

afterEach(async () => {
  processes.forEach((process) => process.kill("SIGTERM"))
  await Promise.all(processes.splice(0).map((process) => process.exited))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("discovers a registered service", async () => {
  const registration = await setup("graceful")

  expect(await Service.discover({ file: registration, version: "test" })).toEqual(
    expect.objectContaining({ url: expect.stringMatching(/^http:\/\//) }),
  )
  expect(await Service.discover({ file: registration, version: "other" })).toBeUndefined()
})

test("ensures a missing service with native promises", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const starts: EnsureReason[] = []

  const endpoint = await Service.ensure({
    file: registration,
    version: "test",
    command: [process.execPath, fixture, registration, "coordinated"],
    onStart: (reason) => starts.push(reason),
  })
  const info = await Bun.file(registration).json()
  try {
    expect(endpoint.url).toBe(info.url)
    expect(starts).toEqual(["missing"])
  } finally {
    process.kill(info.pid, "SIGTERM")
    await waitForExit(info.pid)
  }
}, 15_000)

test("waits for a live contender when another native contender fails", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")

  const endpoint = await Service.ensure({
    file: registration,
    version: "test",
    command: [process.execPath, fixture, registration, "coordinated-failed-loser"],
  })
  const info = await Bun.file(registration).json()
  try {
    expect(endpoint.url).toBe(info.url)
  } finally {
    process.kill(info.pid, "SIGTERM")
    await waitForExit(info.pid)
  }
}, 15_000)

test("reports a failed registered service", async () => {
  const registration = await setup("failed-owner")

  await expect(Service.ensure({ file: registration, version: "test", command: [] })).rejects.toThrow(
    "Background service failed to start",
  )
})

test("does not replace a version rejected by the caller", async () => {
  const registration = await setup("graceful")
  const directory = await temp()
  const contender = join(directory, "contender.json")
  const info = await Bun.file(registration).json()

  await expect(
    Service.ensure({
      file: registration,
      version: "old",
      canReplace: () => false,
      command: [process.execPath, fixture, contender, "record-start"],
    }),
  ).rejects.toThrow("Client version old cannot replace server version test")

  expect(await Bun.file(contender + ".started").exists()).toBe(false)
  expect(process.kill(info.pid, 0)).toBe(true)
})

test("requests graceful stop of the exact service instance", async () => {
  const registration = await setup("graceful")
  const info = await Bun.file(registration).json()

  await Service.stop({ file: registration })

  expect(await Bun.file(registration + ".stop").json()).toEqual({ instanceID: info.id })
})

async function setup(mode: string) {
  const directory = await temp()
  const registration = join(directory, "service.json")
  processes.push(Bun.spawn([process.execPath, fixture, registration, mode], { stdout: "ignore", stderr: "inherit" }))
  await waitForFile(registration)
  return registration
}

async function temp() {
  const directory = await mkdtemp(join(tmpdir(), "opencode-promise-service-"))
  directories.push(directory)
  return directory
}

async function waitForFile(file: string) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await Bun.file(file).exists()) return
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function waitForExit(pid: number) {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for process ${pid}`)
}
