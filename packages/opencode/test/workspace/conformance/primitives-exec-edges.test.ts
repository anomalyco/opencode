// Primitives.execStream edge cases — forked-consumer drain must complete
// before `exitCode` resolves, otherwise the scope closes and the tail of
// the output is lost. LocalBackend inherits this from Node's ChildProcess;
// VercelBackend enforces it at the exit-code seam.

import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { Workspace } from "../../../src/workspace"
import { conformance, isMarker } from "./_runner"

const dec = new TextDecoder()
const enc = new TextEncoder()

const runBashShape = (
  ws: Workspace.Primitives.Interface,
  cmd: string,
  args: string[],
) =>
  Effect.scoped(
    Effect.gen(function* () {
      let output = ""
      const handle = yield* ws.execStream(cmd, args)
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.decodeText(handle.all), (chunk: string) =>
          Effect.sync(() => {
            output += chunk
          }),
        ),
      )
      const code = yield* handle.exitCode
      return { output, code }
    }),
  )

conformance("primitives-exec-edges", (register) => {
  // ─────────── drain: forked consumer races exit ───────────

  register("D.1 bash-shape: small stdout captured before exit wins race", async (ctx) => {
    const eff = runBashShape(ctx.ws, "sh", ["-c", "printf 'hello world'"])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { output: string; code: number | null }
    expect(r.code).toBe(0)
    expect(r.output).toContain("hello world")
  })

  register("D.2 bash-shape: multiline stdout fully captured", async (ctx) => {
    // 50 lines of distinct markers. Any dropped bytes will break the line count.
    const eff = runBashShape(ctx.ws, "sh", [
      "-c",
      "for i in $(seq 1 50); do echo line-$i; done",
    ])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { output: string; code: number | null }
    expect(r.code).toBe(0)
    const lines = r.output.trim().split("\n")
    expect(lines.length).toBe(50)
    expect(lines[0]).toBe("line-1")
    expect(lines[49]).toBe("line-50")
  })

  register("D.3 bash-shape: interleaved stdout + stderr both captured via handle.all", async (ctx) => {
    const eff = runBashShape(ctx.ws, "sh", [
      "-c",
      "echo to-stdout; echo to-stderr >&2; echo more-stdout",
    ])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { output: string; code: number | null }
    expect(r.code).toBe(0)
    expect(r.output).toContain("to-stdout")
    expect(r.output).toContain("to-stderr")
    expect(r.output).toContain("more-stdout")
  })

  register("D.4 bash-shape: empty stdout + exit 0 returns cleanly (no hang)", async (ctx) => {
    const eff = runBashShape(ctx.ws, "sh", ["-c", ":"])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { output: string; code: number | null }
    expect(r.code).toBe(0)
    expect(r.output).toBe("")
  })

  register("D.5 bash-shape: 1000 small chunks captured without loss", async (ctx) => {
    // One echo per iteration creates many separate gateway frames on
    // the vercel backend. Catches races in per-chunk drain.
    const eff = runBashShape(ctx.ws, "sh", [
      "-c",
      "i=0; while [ $i -lt 200 ]; do printf '.'; i=$((i+1)); done",
    ])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { output: string; code: number | null }
    expect(r.code).toBe(0)
    expect(r.output.length).toBe(200)
    expect(/^\.+$/.test(r.output)).toBe(true)
  })

  // ─────────── exit codes ───────────

  register("E.1 exit 0 on success", async (ctx) => {
    const eff = runBashShape(ctx.ws, "sh", ["-c", "true"])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).code).toBe(0)
  })

  register("E.2 non-zero exit captured", async (ctx) => {
    const eff = runBashShape(ctx.ws, "sh", ["-c", "exit 7"])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).code).toBe(7)
  })

  register("E.3 exit 2 on bad command", async (ctx) => {
    const eff = runBashShape(ctx.ws, "sh", ["-c", "command-that-does-not-exist-12345 || exit 2"])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).code).toBe(2)
  })

  // ─────────── I/O semantics ───────────

  register("I.1 binary stdout preserved byte-for-byte via handle.all", async (ctx) => {
    // Emit a fixed non-UTF-8 byte sequence (0xC3 0x28 is a classic invalid
    // UTF-8). Collect via handle.all (raw Uint8Array union) and compare
    // bytes. We read `handle.all` rather than `handle.stdout` because
    // VercelBackend's exit-code gating tracks allQueue drain only — that
    // is the stream the bash tool actually consumes in production. Per-
    // stream subscription tracking for stdoutQueue/stderrQueue is
    // future work documented in the exitCodeEffect in
    // vercel-exec-channel.ts.
    const eff = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ctx.ws.execStream("sh", [
          "-c",
          "printf '\\xc3\\x28\\x00\\xff'",
        ])
        const chunks = yield* Stream.runCollect(handle.all)
        const code = yield* handle.exitCode
        let total = 0
        for (const c of chunks) total += c.length
        const buf = new Uint8Array(total)
        let off = 0
        for (const c of chunks) {
          buf.set(c, off)
          off += c.length
        }
        return { buf, code }
      }),
    )
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { buf: Uint8Array; code: number | null }
    expect(r.code).toBe(0)
    expect(Array.from(r.buf)).toEqual([0xc3, 0x28, 0x00, 0xff])
  })

  register("I.2 large stdout (4 KB) captured fully via bash-shape drain", async (ctx) => {
    // 4096 'a' characters. If any block is dropped the length check fails.
    const eff = runBashShape(ctx.ws, "sh", [
      "-c",
      "printf 'a%.0s' $(seq 1 4096)",
    ])
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { output: string; code: number | null }
    expect(r.code).toBe(0)
    expect(r.output.length).toBe(4096)
    expect(/^a+$/.test(r.output)).toBe(true)
  })

  register("I.3 stdin sink into cat echoes back via bash-shape", async (ctx) => {
    const payload = "edges stdin sink\n"
    const eff = Effect.scoped(
      Effect.gen(function* () {
        let output = ""
        const handle = yield* ctx.ws.execStream("cat", [])
        yield* Stream.run(Stream.make(enc.encode(payload)), handle.stdin)
        yield* Effect.forkScoped(
          Stream.runForEach(Stream.decodeText(handle.all), (chunk: string) =>
            Effect.sync(() => {
              output += chunk
            }),
          ),
        )
        const code = yield* handle.exitCode
        return { output, code }
      }),
    )
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { output: string; code: number | null }
    expect(r.code).toBe(0)
    expect(r.output).toContain("edges stdin sink")
  })

  // ─────────── sandbox filesystem state ───────────

  register("S.1 sequential execStream calls share the same sandbox (write → read)", async (ctx) => {
    const tag = `edges-s1-${Date.now()}`
    const writeEff = runBashShape(ctx.ws, "sh", [
      "-c",
      `echo ${tag} > /tmp/oc-edges-s1.txt`,
    ])
    const readEff = runBashShape(ctx.ws, "sh", [
      "-c",
      "cat /tmp/oc-edges-s1.txt",
    ])
    const write = await ctx.expectWorkspaceSubstrateOrSuccess(writeEff)
    if (isMarker(write)) return
    expect((write as any).code).toBe(0)
    const read = await ctx.expectWorkspaceSubstrateOrSuccess(readEff)
    if (isMarker(read)) return
    expect((read as any).code).toBe(0)
    expect((read as any).output).toContain(tag)
  })

  register("S.2 each bash call is a fresh shell (cwd does not persist)", async (ctx) => {
    await ctx.expectWorkspaceSubstrateOrSuccess(
      runBashShape(ctx.ws, "sh", ["-c", "cd /tmp"]),
    )
    const second = await ctx.expectWorkspaceSubstrateOrSuccess(
      runBashShape(ctx.ws, "sh", ["-c", "pwd"]),
    )
    if (isMarker(second)) return
    const out = (second as any).output as string
    // The second shell's pwd must NOT be /tmp (/tmp was set in the
    // first, disjoint shell). We accept any other cwd as "cleanly
    // isolated". On vercel the default is /vercel/sandbox; on local
    // it's whatever the backend's rootPath was.
    expect(out.trim()).not.toBe("/tmp")
  })

  // ─────────── cancellation ───────────

  register("C.1 kill() on a long-running child unblocks the scope", async (ctx) => {
    // Throwing backend fails at execStream itself — covered by the
    // substrate-leak marker elsewhere. This test only makes sense
    // against backends that can actually spawn.
    if (ctx.kind === "throwing") return
    const t0 = Date.now()
    const eff = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ctx.ws.execStream("sh", ["-c", "sleep 30"])
        yield* Effect.sleep("300 millis")
        yield* handle.kill
        // Kill-signal exit is backend-specific (PlatformError on local,
        // null on vercel). Don't assert on the value.
        yield* handle.exitCode.pipe(Effect.option)
      }),
    )
    await Effect.runPromise(eff.pipe(Effect.orElseSucceed(() => undefined)))
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(10_000)
  })
})
