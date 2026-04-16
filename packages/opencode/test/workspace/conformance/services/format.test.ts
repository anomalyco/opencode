// Substrate-seam smoke for Format.Service — asserts ws.exec can rewrite
// a workspace file in place, which is Format's only substrate touchpoint.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "../_runner"

conformance("services/format", (register) => {
  register("ws.exec can rewrite a workspace file in place (format-style)", async (ctx) => {
    const file = path.posix.join(ctx.backend.rootPath, "format-target.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(file, "unformatted")
      // Simulated formatter: overwrite the file with a well-known token.
      const result = yield* ctx.ws.exec("sh", ["-c", `printf '%s' FORMATTED > "${file}"`])
      const readBack = yield* ctx.ws.readFileString(file)
      return { result, readBack } as const
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out.result.exitCode).toBe(0)
    expect(out.readBack).toBe("FORMATTED")
  })
})
