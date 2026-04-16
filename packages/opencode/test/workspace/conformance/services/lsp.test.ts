// Substrate-seam smoke for LSP.Service. Pins the two primitives LSP
// depends on — `ws.execStream` for the language-server subprocess and
// `ws.readFileString` for didOpen payloads — across all backends.
// Full LSP tests against a real tsserver live under test/lsp/.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "../_runner"

conformance("services/lsp", (register) => {
  register(
    "ws.readFileString round-trips a source file (didOpen substrate seam)",
    async (ctx) => {
      const file = path.posix.join(ctx.backend.rootPath, "lsp-probe.ts")
      const bad = "const x: string = 42\n"
      const eff = Effect.gen(function* () {
        yield* ctx.ws.writeFile(file, bad)
        const read = yield* ctx.ws.readFileString(file)
        return { read } as const
      })
      const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
      if (isMarker(out)) return
      expect(out.read).toBe(bad)
    },
  )

  register(
    "ws.execStream fails at the backend seam on throwing backend",
    async (ctx) => {
      // This test is structured so it only actually asserts on the
      // throwing backend — on local/vercel it would try to spawn a
      // real LSP binary and is out of scope for this phase. The
      // expectWorkspaceSubstrateOrSuccess helper returns the marker
      // on throwing and the effect value elsewhere, letting us treat
      // both as passing.
      const eff = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* ctx.ws.execStream(
            "true",
            [],
            { cwd: ctx.backend.rootPath },
          )
          // Drain exitCode so any seam errors surface here.
          const code = yield* handle.exitCode
          return { code } as const
        }),
      )
      const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
      if (isMarker(out)) return
      // On local/vercel `true` exits 0.
      expect(out.code === 0 || out.code === null).toBe(true)
    },
  )
})
