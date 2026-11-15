import { expect, test } from "bun:test"
import { Clock, Duration, Effect, Exit, Scope } from "effect"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { Standalone } from "../src/services/standalone"
import { isolatedEnv } from "./fixture/environment"

test("standalone reconnect keeps a live child and replaces an exited child once", async () => {
  await using root = await tmpdir("opencode-cli-standalone-reconnect-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [process.execPath, path.join(import.meta.dir, "fixture/standalone-fake.ts"), log],
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    expect(await Effect.runPromise(connection.reconnect())).toEqual(connection.endpoint)
    expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(1)

    process.kill(connection.endpoint.pid, "SIGTERM")
    await Effect.runPromise(Effect.exit(connection.endpoint.exited))
    const [first, second] = await Promise.all([
      reconnectAfterExit(connection, connection.endpoint.pid),
      reconnectAfterExit(connection, connection.endpoint.pid),
    ])
    expect(first).toEqual(second)
    expect(first.pid).not.toBe(connection.endpoint.pid)
    expect(first.url).not.toBe(connection.endpoint.url)
    expect(first.auth.password).not.toBe(connection.endpoint.auth.password)
    expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(2)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("standalone retries keep recovering with bounded backoff", async () => {
  expect([0, 1, 2, 3, 20].map((failures) => Standalone.restartDelay(failures))).toEqual([
    0, 1_000, 2_000, 4_000, 30_000,
  ])
  await using root = await tmpdir("opencode-cli-standalone-backoff-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [process.execPath, path.join(import.meta.dir, "fixture/standalone-fake.ts"), log],
        retryBaseDelay: 0,
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    let endpoint = connection.endpoint
    for (const _ of [1, 2, 3]) {
      process.kill(endpoint.pid, "SIGTERM")
      await Effect.runPromise(Effect.exit(endpoint.exited))
      endpoint = await reconnectAfterExit(connection, endpoint.pid)
    }
    expect(endpoint.pid).not.toBe(connection.endpoint.pid)
    expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(4)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("concurrent failed reconnects honor the extended backoff", async () => {
  await using root = await tmpdir("opencode-cli-standalone-concurrent-backoff-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  const timing = path.join(root.path, "timing")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [
          process.execPath,
          path.join(import.meta.dir, "fixture/standalone-fake.ts"),
          log,
          "fail-first-replacement",
          `timing=${timing}`,
        ],
        retryBaseDelay: 250,
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    process.kill(connection.endpoint.pid, "SIGTERM")
    await Effect.runPromise(Effect.exit(connection.endpoint.exited))
    const results = await Promise.all([
      reconnectResult(connection, connection.endpoint.pid),
      reconnectResult(connection, connection.endpoint.pid),
    ])
    expect(results.filter((result) => "error" in result)).toHaveLength(1)
    expect(results.filter((result) => "endpoint" in result)).toHaveLength(1)
    const times = (await waitForSpawns(timing, 2)).map(Number)
    expect(times).toHaveLength(2)
    // The failed replacement extends the deadline to 500ms; the second caller must honor it.
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(400)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("manual restart wakes a reconnect sleeping in backoff", async () => {
  await using root = await tmpdir("opencode-cli-standalone-wake-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [process.execPath, path.join(import.meta.dir, "fixture/standalone-fake.ts"), log],
        retryBaseDelay: 20_000,
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    process.kill(connection.endpoint.pid, "SIGTERM")
    await Effect.runPromise(Effect.exit(connection.endpoint.exited))
    const parked = Promise.withResolvers<void>()
    const live = Clock.Clock.defaultValue()
    const clock: Clock.Clock = {
      ...live,
      sleep: (duration) =>
        Duration.toMillis(duration) < 10_000
          ? live.sleep(duration)
          : Effect.sync(() => parked.resolve()).pipe(Effect.andThen(Effect.never)),
    }
    const pending = reconnectAfterExit(connection, connection.endpoint.pid, clock)
    await Promise.race([
      parked.promise,
      Bun.sleep(20_000).then(() => {
        throw new Error("Reconnect did not enter backoff")
      }),
    ])
    await Effect.runPromise(connection.restart())
    const endpoint = await Promise.race([
      pending,
      Bun.sleep(4_000).then(() => {
        throw new Error("Manual restart did not wake reconnect")
      }),
    ])
    expect(endpoint.pid).not.toBe(connection.endpoint.pid)
    expect(await waitForSpawns(log, 2)).toHaveLength(2)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("standalone retries a replacement that exits before readiness", async () => {
  await using root = await tmpdir("opencode-cli-standalone-start-failure-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [
          process.execPath,
          path.join(import.meta.dir, "fixture/standalone-fake.ts"),
          log,
          "fail-first-replacement",
        ],
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    process.kill(connection.endpoint.pid, "SIGTERM")
    await Effect.runPromise(Effect.exit(connection.endpoint.exited))
    const failed = await reconnectResult(connection, connection.endpoint.pid)
    expect("error" in failed).toBe(true)
    expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(2)
    const recovered = await reconnectAfterExit(connection, connection.endpoint.pid)
    expect(running(recovered.pid)).toBe(true)
    expect((await Bun.file(log).text()).trim().split("\n")).toHaveLength(3)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("silent replacement times out and releases a queued manual restart", async () => {
  await using root = await tmpdir("opencode-cli-standalone-silent-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [process.execPath, path.join(import.meta.dir, "fixture/standalone-fake.ts"), log, "silent-once"],
        automaticTimeout: 2_000,
        retryBaseDelay: 0,
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    process.kill(connection.endpoint.pid, "SIGTERM")
    await Effect.runPromise(Effect.exit(connection.endpoint.exited))
    const pending = reconnectResult(connection, connection.endpoint.pid)
    const silent = Number((await waitForSpawns(log, 2))[1])
    const restart = Effect.runPromise(connection.restart())
    const result = await pending
    expect("error" in result ? String(result.error) : "").toContain("timed out")
    await restart
    const recovered = await reconnectAfterExit(connection, connection.endpoint.pid)
    expect(await waitForExit(silent)).toBe(true)
    expect(running(recovered.pid)).toBe(true)
    expect(await waitForSpawns(log, 3)).toHaveLength(3)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("cancelling a silent replacement closes its child scope", async () => {
  await using root = await tmpdir("opencode-cli-standalone-cancel-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [process.execPath, path.join(import.meta.dir, "fixture/standalone-fake.ts"), log, "silent-once"],
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    process.kill(connection.endpoint.pid, "SIGTERM")
    await Effect.runPromise(Effect.exit(connection.endpoint.exited))
    const controller = new AbortController()
    const pending = reconnectResult(connection, connection.endpoint.pid, controller.signal)
    const silent = Number((await waitForSpawns(log, 2))[1])
    controller.abort()
    expect("error" in (await pending)).toBe(true)
    expect(await waitForExit(silent)).toBe(true)
    const recovered = await reconnectAfterExit(connection, connection.endpoint.pid)
    expect(running(recovered.pid)).toBe(true)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("manual restart coalesces with an automatic replacement already in progress", async () => {
  await using root = await tmpdir("opencode-cli-standalone-race-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  const marker = path.join(root.path, "release")
  try {
    const connection = await Effect.runPromise(
      Standalone.connect({
        command: [
          process.execPath,
          path.join(import.meta.dir, "fixture/standalone-fake.ts"),
          log,
          "ready-after-file",
          marker,
        ],
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    process.kill(connection.endpoint.pid, "SIGTERM")
    await Effect.runPromise(Effect.exit(connection.endpoint.exited))
    const pending = reconnectAfterExit(connection, connection.endpoint.pid)
    await waitForSpawns(log, 2)
    const restart = Effect.runPromise(connection.restart())
    await Bun.write(marker, "ready")
    const replacement = await pending
    await restart
    expect((await Effect.runPromise(connection.reconnect())).pid).toBe(replacement.pid)
    expect(await waitForSpawns(log, 2)).toHaveLength(2)
    expect(running(replacement.pid)).toBe(true)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("standalone restart replaces the child and scope closure stops the replacement", async () => {
  await using root = await tmpdir("opencode-cli-standalone-cleanup-")
  const scope = Scope.makeUnsafe()
  const log = path.join(root.path, "spawns")
  const connection = await Effect.runPromise(
    Standalone.connect({
      command: [process.execPath, path.join(import.meta.dir, "fixture/standalone-fake.ts"), log],
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  try {
    await Effect.runPromise(connection.restart())
    const replacement = await Effect.runPromise(connection.reconnect())
    expect(replacement.pid).not.toBe(connection.endpoint.pid)
    expect(await waitForExit(connection.endpoint.pid)).toBe(true)
    expect(running(replacement.pid)).toBe(true)
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(await waitForExit(replacement.pid)).toBe(true)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

test("standalone server exits when its owner is killed", async () => {
  // Windows can hold the server's files briefly after it exits; the fixture retries removal on EBUSY.
  await using root = await tmpdir("opencode-cli-standalone-")
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/standalone-owner.ts")], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root.path, { OPENCODE_SERVER_USERNAME: "custom" }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const line = await Promise.race([
    readLine(owner.stdout, "STANDALONE_READY "),
    Bun.sleep(10_000).then(() => undefined),
  ])
  const [, rawPID, url, status] = line?.split(" ") ?? []
  const pid = Number(rawPID)

  try {
    expect(pid).toBeGreaterThan(0)
    expect(url).toStartWith("http://127.0.0.1:")
    expect(status).toBe("200")
    expect(running(pid)).toBe(true)

    owner.kill("SIGKILL")
    await owner.exited

    expect(await waitForExit(pid)).toBe(true)
  } finally {
    owner.kill("SIGKILL")
    await owner.exited
    if (running(pid)) process.kill(pid, "SIGKILL")
  }
})

async function readLine(stream: ReadableStream<Uint8Array>, prefix: string) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (true) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(decoder.decode(result.value, { stream: true }))
    const output = chunks.join("")
    const line = output.split("\n").find((line) => line.startsWith(prefix))
    if (line) {
      reader.releaseLock()
      return line
    }
  }
  reader.releaseLock()
  return (chunks.join("") + decoder.decode()).split("\n").find((line) => line.startsWith(prefix))
}

type Connection = Effect.Success<ReturnType<typeof Standalone.connect>>

async function reconnectAfterExit(connection: Connection, pid: number, clock = Clock.Clock.defaultValue()) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const endpoint = await Effect.runPromise(connection.reconnect().pipe(Effect.provideService(Clock.Clock, clock)))
    if (endpoint.pid !== pid) return endpoint
    await Bun.sleep(50)
  }
  throw new Error("Standalone server was not replaced")
}

async function reconnectResult(connection: Connection, pid: number, signal?: AbortSignal) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const endpoint = await Effect.runPromise(connection.reconnect(), { signal })
      if (endpoint.pid !== pid) return { endpoint }
    } catch (error) {
      return { error }
    }
    await Bun.sleep(50)
  }
  throw new Error("Standalone server did not reconnect or fail")
}

async function waitForSpawns(log: string, count: number) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const lines = (await Bun.file(log).text()).trim().split("\n")
    if (lines.length >= count) return lines
    await Bun.sleep(50)
  }
  throw new Error(`Expected ${count} lines in ${log}`)
}

async function waitForExit(pid: number) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (!running(pid)) return true
    await Bun.sleep(50)
  }
  return !running(pid)
}

function running(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
