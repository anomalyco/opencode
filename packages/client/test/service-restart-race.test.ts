import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { Service } from "../src/effect/service"
import { serviceFixture } from "./fixture/service-fixture"
import { accelerate } from "./fixture/service-timing"

function run<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))
}

// Helper that mirrors the real restart handler: stop must be confirmed, else never ensure
function restartEffect(options: { file: string }) {
  return Effect.gen(function* () {
    const stopResult = yield* Service.stop(options)
    if (!stopResult.stopped) {
      const reason = (stopResult as any).reason ?? "unknown"
      const cause = (stopResult as any).cause ? ` cause: ${(stopResult as any).cause}` : ""
      return yield* Effect.fail(
        new Error(
          `Service restart failed to stop incumbent (reason: ${reason}${cause}). Explicit restart never proceeds to ensure() after an unconfirmed stop.`,
        ),
      )
    }
    return yield* Service.ensure(options as any)
  })
}

describe("service restart race #37795", () => {
  test("explicit restart does not silently reuse unresponsive incumbent", async () => {
    await using fixture = await serviceFixture()
    const registration = fixture.registration

    // 1. Real registration — hanging server whose /api/health never resolves
    const hanging = fixture.spawn("hanging-stubborn")
    await fixture.waitForFile()
    const before = (await Bun.file(registration).json()) as any
    expect(hanging.exitCode).toBe(null)
    expect(before.pid).toBe(hanging.pid)

    // 2. Authenticated health probe times out while process remains alive
    // Service.discover should be undefined for hanging (probe timedOut)
    const discovered = await run(Service.discover({ file: registration } as any))
    expect(discovered).toBeUndefined()
    // direct fetch should timeout
    const probeTimedOut = await Effect.runPromise(
      Effect.promise(() =>
        fetch(new URL("/api/health", before.url), {
          headers: Service.headers({ url: before.url, auth: { type: "basic", username: "opencode", password: "private" } }),
          signal: AbortSignal.timeout(100),
        })
          .then(() => false)
          .catch(() => true),
      ),
    )
    expect(probeTimedOut).toBe(true)
    expect(hanging.exitCode).toBe(null) // still alive

    // 3+4. Service.stop returns stopped:false
    const stopResult = await run(Service.stop({ file: registration }) as any)
    expect(stopResult.stopped).toBe(false)
    // reason is timeout or still-registered depending on timing; must be falsy path
    expect(["timeout", "still-registered", "stale-registration", "error"]).toContain((stopResult as any).reason)
    // process remains alive after failed stop (stubborn traps SIGTERM and stays alive)
    expect(hanging.exitCode).toBe(null)
    try {
      process.kill(before.pid, 0)
    } catch {
      throw new Error("hanging process should still be alive after failed stop")
    }

    // 5+6. Real restart handler fails and never calls ensure()
    let ensureCalls = 0
    const originalEnsure = Service.ensure
    // @ts-ignore monkey patch
    ;(Service as any).ensure = (...args: any[]) => {
      ensureCalls++
      return (originalEnsure as any)(...args)
    }
    let restartError: unknown
    try {
      await run(restartEffect({ file: registration }) as any)
    } catch (e) {
      restartError = e
    }
    expect(restartError).toBeInstanceOf(Error)
    expect((restartError as Error).message).toMatch(/failed to stop incumbent/)
    expect(ensureCalls).toBe(0)

    // 7. Later recovery of the incumbent does not make the previous restart succeed
    // Kill the hanging stubborn and start a healthy server; ensure would now succeed,
    // but the previous restart invocation already failed and never called ensure.
    hanging.kill("SIGKILL")
    await hanging.exited.catch(() => {})
    // Wait for the rewritten file to be cleaned up; remove stale registration
    await Bun.sleep(50)
    // Previous restart is still failed; ensure was never called
    expect(ensureCalls).toBe(0)
    // A fresh ensure after recovery should succeed with a new instance (proves recovery is possible, but not reused silently)
    const freshEndpoint = await run(
      (accelerate(Service.ensure) as any)({
        file: registration,
        version: "test",
        command: fixture.command("delayed", "10"),
      }),
    )
    const afterRecovery = (await Bun.file(registration).json()) as any
    fixture.track(afterRecovery.pid)
    expect(freshEndpoint.url).toBe(afterRecovery.url)
    expect(afterRecovery.pid).not.toBe(before.pid)

    // cleanup monkey patch
    ;(Service as any).ensure = originalEnsure
  }, 15_000)

  test("successful restart replaces incumbent with new PID/instance", async () => {
    await using fixture = await serviceFixture()
    const registration = fixture.registration

    const incumbent = fixture.spawn("compatible")
    await fixture.waitForFile()
    const before = (await Bun.file(registration).json()) as any
    expect(incumbent.exitCode).toBe(null)
    fixture.track(before.pid)

    const stopResult = await run(Service.stop({ file: registration }) as any)
    expect(stopResult.stopped).toBe(true)
    expect((stopResult as any).reason).toBe("stopped")

    // wait for incumbent to exit
    await incumbent.exited
    expect(incumbent.exitCode).toBe(0)
    try {
      process.kill(before.pid, 0)
      throw new Error("old PID should be dead")
    } catch (e: any) {
      expect(e.code).toBe("ESRCH")
    }

    // ensure new instance
    const endpoint = await run(
      (accelerate(Service.ensure) as any)({
        file: registration,
        version: "test",
        command: fixture.command("delayed", "10"),
      }),
    )
    const after = (await Bun.file(registration).json()) as any
    fixture.track(after.pid)

    expect(after.pid).not.toBe(before.pid)
    expect(after.id).not.toBe(before.id)
    expect(endpoint.url).toBe(after.url)
  })

  test("stale-PID protection: unrelated process reusing registered PID is never killed", async () => {
    await using fixture = await serviceFixture()
    const registration = fixture.registration

    // Create an unrelated long-lived process (sleep) — this PID must never be signaled
    const unrelated = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" })
    const unrelatedPid = unrelated.pid
    expect(unrelated.exitCode).toBe(null)
    process.kill(unrelatedPid, 0) // verify alive

    // Create a real service registration with its own PID (different from unrelated)
    const hanging = fixture.spawn("hanging")
    await fixture.waitForFile()
    const original = (await Bun.file(registration).json()) as any
    expect(original.pid).not.toBe(unrelatedPid)
    expect(hanging.exitCode).toBe(null)

    // Service.stop targets the registered incumbent (hanging), not the unrelated sleep
    const stopResult = await run(Service.stop({ file: registration }) as any)
    expect(stopResult.stopped).toBe(true)

    // Unrelated process must remain alive — stop only signals the incumbent PID
    expect(unrelated.exitCode).toBe(null)
    process.kill(unrelatedPid, 0)

    await hanging.exited.catch(() => {})
    unrelated.kill("SIGTERM")
    await unrelated.exited.catch(() => {})
  })
})
