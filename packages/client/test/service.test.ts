import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Service, type EnsureReason } from "../src/effect/service"
import { accelerate, waitForExit } from "./fixture/service-timing"

const fixture = join(import.meta.dir, "fixture/service.ts")
const ensure = accelerate(Service.ensure)
const processes: Bun.Subprocess[] = []
const directories: string[] = []

afterEach(async () => {
  processes.forEach((process) => process.kill("SIGTERM"))
  await Promise.all(processes.splice(0).map((process) => process.exited))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("a concurrent same-version start cannot invalidate a resolved endpoint", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  spawn(registration, "modern")
  await waitForFile(registration)
  const original = await Bun.file(registration).json()

  const starts: EnsureReason[] = []
  const first = run(
    ensure({
      file: registration,
      version: "test",
      command: [],
      onStart: (reason) => starts.push(reason),
    }),
  )
  await waitForFile(registration + ".first-request")

  const resolved = await run(ensure({ file: registration, version: "test" }))
  expect(resolved.url).toBe(original.url)

  await writeFile(registration + ".release", "")
  await first

  expect(starts).toEqual([])
  expect(await Bun.file(registration).json()).toEqual(original)
  expect(await health(resolved.url)).toEqual({ healthy: true, version: "test", pid: original.pid })
})

test("reuses a compatible registered service", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const existing = spawn(registration, "compatible")
  await waitForFile(registration)

  const starts: EnsureReason[] = []
  const endpoint = await run(
    ensure({
      file: registration,
      version: (version) => version.startsWith("2."),
      command: [],
      onStart: (reason) => starts.push(reason),
    }),
  )

  expect(endpoint.url).toBe((await Bun.file(registration).json()).url)
  expect(starts).toEqual([])
  expect(existing.exitCode).toBe(null)
})

test("adds configured environment variables when starting a service", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "environment"],
      env: { OPENCODE_SERVICE_ENV_TEST: "configured" },
    }),
  )
  const info = await Bun.file(registration).json()

  try {
    expect(endpoint.url).toBe(info.url)
    expect(await Bun.file(registration + ".environment").text()).toBe("configured")
  } finally {
    process.kill(info.pid, "SIGTERM")
    await waitForExit(info.pid)
  }
})

test("replaces an incompatible registered service", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const existing = spawn(registration, "incompatible")
  await waitForFile(registration)

  const starts: EnsureReason[] = []
  const endpoint = await run(
    ensure({
      file: registration,
      version: (version) => version.startsWith("2."),
      command: [process.execPath, fixture, registration, "delayed-compatible", "10"],
      onStart: (reason) => starts.push(reason),
    }),
  )
  const replacement = await Bun.file(registration).json()

  expect(await existing.exited).toBe(0)
  expect(replacement.version).toBe("2.1.0-next.1")
  expect(endpoint.url).toBe(replacement.url)
  expect(starts).toEqual(["version-mismatch"])
  process.kill(replacement.pid, "SIGTERM")
  await waitForExit(replacement.pid)
})

test("waits for a registered service to finish starting", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const process = spawn(registration, "starting")
  await waitForFile(registration)
  const result = run(ensure({ file: registration, version: "test", command: [] }))

  await waitForFile(registration + ".health-request")
  expect(process.exitCode).toBe(null)
  await writeFile(registration + ".release", "")
  expect((await result).url).toBe((await Bun.file(registration).json()).url)
})

test("reports a failed registered service without spawning", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const process = spawn(registration, "failed-owner")
  await waitForFile(registration)

  await expect(run(ensure({ file: registration, version: "test", command: [] }))).rejects.toThrow(
    "Background service failed to start",
  )
  expect(process.exitCode).toBe(null)
})

test("evicts an unresponsive registered service before starting its replacement", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const existing = spawn(registration, "hanging")
  await waitForFile(registration)
  const original = await Bun.file(registration).json()

  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "delayed", "10"],
    }),
  )
  const replacement = await Bun.file(registration).json()

  expect((await Bun.file(registration + ".requests").text()).trim().split("\n")).toHaveLength(3)
  expect(await existing.exited).toBe(0)
  expect(replacement.pid).not.toBe(original.pid)
  expect(endpoint.url).toBe(replacement.url)
  expect(await health(endpoint.url)).toEqual({ healthy: true, version: "test", pid: replacement.pid })
  process.kill(replacement.pid, "SIGTERM")
  await waitForExit(replacement.pid)
})

test("signals an unresponsive registered service process", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const process = spawn(registration, "hanging")
  await waitForFile(registration)

  await run(Service.stop({ file: registration }))
  await process.exited
  expect(await Bun.file(registration + ".signal").text()).toBe("SIGTERM")
  expect(await Bun.file(registration).exists()).toBe(false)
})

test("signals an incompatible service before starting its replacement", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const existing = spawn(registration, "old")
  await waitForFile(registration)
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "delayed", "10"],
    }),
  )
  const replacement = await Bun.file(registration).json()

  expect(await existing.exited).toBe(0)
  expect(endpoint.url).toBe(replacement.url)
  process.kill(replacement.pid, "SIGTERM")
  await waitForExit(replacement.pid)
})

test("a legacy health response is still replaced", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const existing = spawn(registration, "legacy")
  await waitForFile(registration)

  const starts: EnsureReason[] = []
  const result = run(ensure({ file: registration, command: [], onStart: (reason) => starts.push(reason) }))

  await expect(result).rejects.toThrow("Missing service command")
  expect(starts).toEqual(["version-mismatch"])
  await existing.exited
})

test("waits for a slow winner while bounding lock probes", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "coordinated"],
    }),
  )
  const info = await Bun.file(registration).json()
  try {
    expect(endpoint.url).toBe(info.url)
    expect(await health(endpoint.url)).toEqual({ healthy: true, version: "test", pid: info.pid })
    expect((await Bun.file(registration + ".starts").text()).trim().split("\n")).toHaveLength(2)
  } finally {
    process.kill(info.pid, "SIGTERM")
    await waitForExit(info.pid)
  }
})

test("waits for a live contender when another contender fails", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const endpoint = await run(
    ensure({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "coordinated-failed-loser", "300"],
    }),
  )
  const info = await Bun.file(registration).json()
  try {
    expect(endpoint.url).toBe(info.url)
  } finally {
    process.kill(info.pid, "SIGTERM")
    await waitForExit(info.pid)
  }
})

test("reports a contender that fails to start", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  await expect(
    run(
      ensure({
        file: registration,
        version: "test",
        command: [process.execPath, fixture, registration, "failed"],
      }),
    ),
  ).rejects.toThrow("Server process exited with code 1")
})

test("reports a bounded contender stderr tail", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const error = await run(
    Service.ensure({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "stderr-failed"],
    }),
  ).catch((error: unknown) => error)

  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).toContain("actionable startup failure")
  expect(error.message.length).toBeLessThan(9_000)
}, 10_000)

test("reports a contender terminated by a signal", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  await expect(
    run(
      ensure({
        file: registration,
        version: "test",
        command: [process.execPath, fixture, registration, "signal"],
      }),
    ),
  ).rejects.toThrow(/Server process (terminated by|exited with code)/)
})

test("reports a slow contender that eventually fails", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  await expect(
    run(
      ensure({
        file: registration,
        version: "test",
        command: [process.execPath, fixture, registration, "delayed-failed", "500"],
      }),
    ),
  ).rejects.toThrow("Server process exited with code 1")
})

test("replaces an incompatible owner that appears during startup", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const starting = run(
    ensure({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "delayed", "500"],
    }),
  )
  await waitForFile(registration + ".starts")
  const old = spawn(registration, "old")
  await waitForFile(registration)
  const endpoint = await starting
  const info = await Bun.file(registration).json()
  try {
    expect(endpoint.url).toBe(info.url)
    expect(info.version).toBe("test")
    await old.exited
  } finally {
    process.kill(info.pid, "SIGTERM")
    await waitForExit(info.pid)
  }
})

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))
}

function spawn(registration: string, mode: string, ...args: string[]) {
  const subprocess = Bun.spawn([process.execPath, fixture, registration, mode, ...args], {
    stdout: "ignore",
    stderr: "inherit",
  })
  processes.push(subprocess)
  return subprocess
}

async function temp() {
  const directory = await mkdtemp(join(tmpdir(), "opencode-client-service-"))
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

async function health(url: string) {
  return fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(1_000) }).then((response) => response.json())
}
