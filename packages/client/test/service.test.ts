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
  await Promise.all(
    directories.map(async (directory) => {
      const info = await Bun.file(join(directory, "service.json"))
        .json()
        .catch(() => undefined)
      if (typeof info?.pid === "number") process.kill(info.pid, "SIGTERM")
    }),
  )
  processes.forEach((process) => process.kill("SIGTERM"))
  await Promise.all(processes.splice(0).map((process) => process.exited))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("a concurrent same-version start cannot invalidate a resolved endpoint", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const firstRequest = join(directory, "first-request")
  const release = join(directory, "release")
  const existing = spawn(registration, "test", "block-first", firstRequest, release)
  await waitForFile(registration)

  const first = run(
    Service.start({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "test", "healthy"],
    }),
  )
  await waitForFile(firstRequest)

  const resolved = await run(Service.start({ file: registration, version: "test" }))
  expect(await health(resolved.url)).toBe(true)

  await writeFile(release, "")
  await first
  await Bun.sleep(50)

  expect(existing.exitCode).toBe(null)
  expect(await health(resolved.url)).toBe(true)
})

test("a successful ungated probe of the requested version is not a mismatch", async () => {
  const directory = await temp()
  const registration = join(directory, "service.json")
  const firstRequest = join(directory, "first-request")
  const release = join(directory, "release")
  const existing = spawn(registration, "test", "block-first", firstRequest, release)
  await waitForFile(registration)

  const starts: Array<{ reason: Service.StartReason; existing?: Service.Info }> = []
  const started = run(
    Service.start({
      file: registration,
      version: "test",
      command: [process.execPath, fixture, registration, "test", "healthy"],
      onStart: (reason, info) => starts.push({ reason, existing: info }),
    }),
  )
  await waitForFile(firstRequest)
  await writeFile(release, "")
  const resolved = await started

  expect(starts).toEqual([])
  expect(existing.exitCode).toBe(null)
  expect(await health(resolved.url)).toBe(true)
})

function run<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))
}

function spawn(registration: string, version: string, mode: string, ...args: string[]) {
  const subprocess = Bun.spawn([process.execPath, fixture, registration, version, mode, ...args], {
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
  for (let attempt = 0; attempt < 1_000; attempt++) {
    if (await Bun.file(file).exists()) return
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function health(url: string) {
  return fetch(new URL("/api/health", url))
    .then((response) => response.ok)
    .catch(() => false)
}
