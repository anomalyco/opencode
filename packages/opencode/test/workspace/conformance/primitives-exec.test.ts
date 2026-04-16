// Primitives.exec / execStream conformance.

import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { conformance, isMarker } from "./_runner"

const dec = new TextDecoder()
const enc = new TextEncoder()

conformance("primitives-exec", (register) => {
  register("exec captures stdout + exit code via primitives", async (ctx) => {
    const eff = ctx.ws.exec("node", ["-e", "process.stdout.write('ok')"])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const res = out as { exitCode: number; stdout: string }
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe("ok")
  })

  register("execStream without stdin drains stdout via primitives", async (ctx) => {
    const eff = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ctx.ws.execStream("node", ["-e", "process.stdout.write('stream')"])
        const chunks = yield* Stream.runCollect(handle.stdout)
        const code = yield* handle.exitCode
        return { joined: chunks.map((b) => dec.decode(b)).join(""), code }
      }),
    )
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { joined: string; code: number | null }
    expect(r.joined).toBe("stream")
    expect(r.code).toBe(0)
  })

  register("execStream stdin Sink echoes via cat (LSP-critical)", async (ctx) => {
    const payload = "primitives stdin sink\n"
    const eff = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ctx.ws.execStream("cat", [])
        yield* Stream.run(Stream.make(enc.encode(payload)), handle.stdin)
        const chunks = yield* Stream.runCollect(handle.stdout)
        const code = yield* handle.exitCode
        return { joined: chunks.map((b) => dec.decode(b)).join(""), code }
      }),
    )
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { joined: string; code: number | null }
    expect(r.joined).toBe(payload)
    expect(r.code).toBe(0)
  })
})
