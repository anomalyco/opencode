// Workspace.Service.writeFile contract: the file lands at `p`, the
// return value carries a `diagnostics` record, and (with the null LSP
// layer the conformance runner provides) that record is empty.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

conformance("service-write-ok", (register) => {
  register("Workspace.Service.writeFile returns {diagnostics}", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "svc-write.txt")
    const eff = Effect.gen(function* () {
      const result = yield* ctx.svc.writeFile(p, "svc body")
      const readBack = yield* ctx.ws.readFileString(p).pipe(Effect.catch(() => Effect.succeed("")))
      return { result, readBack } as const
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as {
      result: { diagnostics: Record<string, unknown[]> }
      readBack: string
    }
    expect(r.result).toBeDefined()
    expect(typeof r.result.diagnostics).toBe("object")
    expect(r.result.diagnostics).not.toBeNull()
    expect(Array.isArray(r.result.diagnostics)).toBe(false)
    // Conformance runner wires the null LSP → diagnostics is always {}.
    expect(Object.keys(r.result.diagnostics).length).toBe(0)
    expect(r.readBack).toBe("svc body")
  })
})
