import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Service } from "../src/effect/index"

const fixture = join(import.meta.dir, "fixture/service.ts")
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

  const starts: Service.StartReason[] = []
  const first = run(
    Service.start({
      file: registration,
      version: "test",
      command: [],
      onStart: (reason) => starts.push(reason),
    }),
  )
  await waitForFile(registration + ".first-request")

  const resolved = await run(Service.start({ file: registration, version: "test" }))
  expect(resolved.url).toBe(original.url)

  await writeFile(registration + ".release", "")
  await first

  expect(starts).toEqual([])
  expect(await Bun.file(registration).json()).toEqual(original)
  expect(await health(resolved.url)).toEqual({ healthy: true, version: "test", pid: original.pid })
  expect(await run(Service.status({ file: registration }))).toEqual({ type: "ready", version: "test" })
})

test("waits for a registered service to finish starting", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const process = spawn(registration, "starting")
  await waitForFile(registration)
  const statuses: Service.Status[] = []
  const result = run(
    Service.start({ file: registration, version: "test", command: [], onStatus: (status) => statuses.push(status) }),
  )

  await Bun.sleep(500)
  expect(process.exitCode).toBe(null)
  expect(statuses).toContainEqual({ type: "starting", version: "test" })
  expect(statuses.filter((status) => status.type === "starting")).toHaveLength(1)
  await writeFile(registration + ".release", "")
  expect((await result).url).toBe((await Bun.file(registration).json()).url)
})

test("reports a failed registered service without spawning", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const process = spawn(registration, "failed-owner")
  await waitForFile(registration)

  await expect(run(Service.start({ file: registration, version: "test", command: [] }))).rejects.toMatchObject({
    message: "Could not open the database.",
    action: "Check the service logs.",
  })
  expect(process.exitCode).toBe(null)
})

test("requests graceful replacement of the exact service instance", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const process = spawn(registration, "graceful")
  await waitForFile(registration)
  const info = await Bun.file(registration).json()

  await run(Service.stop({ file: registration }, { targetVersion: "next" }))
  await process.exited
  expect(await Bun.file(registration + ".stop").json()).toEqual({ instanceID: info.id, targetVersion: "next" })
})

test("does not spawn contenders while an incompatible service rejects replacement", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const contender = join(directory, "contender.json")
  const existing = spawn(registration, "reject-stop")
  await waitForFile(registration)
  const controller = new AbortController()
  const starting = Effect.runPromise(
    Service.start({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, contender, "record-start"],
    }).pipe(Effect.provide(NodeFileSystem.layer)),
    { signal: controller.signal },
  )

  await waitForFile(registration + ".stop-attempt")
  await Bun.sleep(500)
  controller.abort()
  await starting.catch(() => undefined)

  expect(await Bun.file(contender + ".started").exists()).toBe(false)
  expect(existing.exitCode).toBe(null)
})

test("a legacy health response is still replaced", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const existing = spawn(registration, "legacy")
  await waitForFile(registration)

  const starts: Service.StartReason[] = []
  const result = run(Service.start({ file: registration, command: [], onStart: (reason) => starts.push(reason) }))

  await expect(result).rejects.toThrow("Missing service command")
  expect(starts).toEqual(["version-mismatch"])
  await existing.exited
}, 10_000)

test("waits for a slow winner while bounding lock probes", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const endpoint = await run(
    Service.start({
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
  }
}, 15_000)

test("reports a contender that fails to start", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  await expect(
    run(
      Service.start({
        file: registration,
        version: "test",
        command: [process.execPath, fixture, registration, "failed"],
      }),
    ),
  ).rejects.toThrow("Server process exited with code 1")
}, 10_000)

test("reports a contender terminated by a signal", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  await expect(
    run(
      Service.start({
        file: registration,
        version: "test",
        command: [process.execPath, fixture, registration, "signal"],
      }),
    ),
  ).rejects.toThrow(/Server process (terminated by|exited with code)/)
}, 10_000)

test("reports a slow contender that eventually fails", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  await expect(
    run(
      Service.start({
        file: registration,
        version: "test",
        command: [process.execPath, fixture, registration, "delayed-failed", "8000"],
      }),
    ),
  ).rejects.toThrow("Server process exited with code 1")
}, 15_000)

test("replaces an incompatible owner that appears during startup", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const starting = run(
    Service.start({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "delayed", "8000"],
    }),
  )
  await Bun.sleep(1_000)
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
  }
}, 20_000)

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
