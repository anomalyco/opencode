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
})

function run<A, E>(effect: Effect.Effect<A, E, never>) {
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
