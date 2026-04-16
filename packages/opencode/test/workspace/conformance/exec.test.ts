// exec / execStream conformance. The stdin Sink test is the critical
// one — LSP wiring relies on ExecStreamHandle.stdin being a real
// writable Sink that delivers bytes to the child process.

import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { conformance, isMarker } from "./_runner"

const dec = new TextDecoder()
const enc = new TextEncoder()

conformance("exec", (register) => {
  register("exec captures stdout + exit code", async (ctx) => {
    const eff = ctx.backend.exec("node", ["-e", "process.stdout.write('hi')"])
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const res = out as { exitCode: number; stdout: string; stderr: string }
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe("hi")
  })

  register("execStream without stdin drains stdout", async (ctx) => {
    const eff = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ctx.backend.execStream("node", ["-e", "process.stdout.write('stream')"])
        const chunks = yield* Stream.runCollect(handle.stdout)
        const code = yield* handle.exitCode
        const joined = chunks.map((b) => dec.decode(b)).join("")
        return { joined, code }
      }),
    )
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { joined: string; code: number | null }
    expect(r.joined).toBe("stream")
    expect(r.code).toBe(0)
  })

  register("execStream stdin Sink echoes via cat (LSP-critical)", async (ctx) => {
    const payload = "hello via sink\n"
    const eff = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ctx.backend.execStream("cat", [])
        // Feed bytes to the child process's stdin via the returned
        // Sink. On close, cat echoes them to stdout.
        yield* Stream.run(Stream.make(enc.encode(payload)), handle.stdin)
        const chunks = yield* Stream.runCollect(handle.stdout)
        const code = yield* handle.exitCode
        const joined = chunks.map((b) => dec.decode(b)).join("")
        return { joined, code }
      }),
    )
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { joined: string; code: number | null }
    expect(r.joined).toBe(payload)
    expect(r.code).toBe(0)
  })

  register("kill interrupts a long-running command", async (ctx) => {
    // kill() may race with process termination. The child can either
    // exit cleanly with a non-zero code OR die from the signal and
    // have exitCode fail with a BackendError. Both outcomes prove kill
    // worked. The real contract is: the scoped block resolves — no
    // hang. We recover from a failing exitCode so we can still run
    // per-backend assertions.
    const eff = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ctx.backend.execStream("node", [
          "-e",
          "setInterval(() => {}, 1000); console.log('up'); setTimeout(() => {}, 60_000)",
        ])
        yield* Effect.forkScoped(Stream.runDrain(handle.stdout).pipe(Effect.ignore))
        yield* Effect.sleep("50 millis")
        yield* handle.kill
        const code = yield* handle.exitCode.pipe(
          Effect.catch(() => Effect.succeed(null as number | null)),
        )
        return { code }
      }),
    )
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const code = (out as { code: number | null }).code
    expect(code === null || code !== 0).toBe(true)
  })
})
