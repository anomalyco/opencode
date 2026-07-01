import * as InstanceState from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LSP } from "@/lsp/lsp"
import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import path from "path"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { BufferClosePayload, BufferPayload, DiagnosticOut, LocPayload } from "../groups/lsp"

// Rewrite absolute `file://` location URIs to workspace-relative paths; targets outside the workspace keep their absolute URI.
function rewriteLocations(directory: string, results: unknown[]): unknown[] {
  return results.map((entry) => {
    if (!entry || typeof entry !== "object") return entry
    const loc = entry as Record<string, unknown>
    const uri = loc["uri"] ?? loc["targetUri"]
    if (typeof uri !== "string" || !uri.startsWith("file://")) return entry
    let absolute: string
    try {
      absolute = fileURLToPath(uri)
    } catch {
      return entry
    }
    if (!FSUtil.contains(directory, absolute)) return entry
    const relative = path.relative(directory, absolute)
    const next: Record<string, unknown> = { ...loc }
    if ("uri" in loc) next["uri"] = relative
    if ("targetUri" in loc) next["targetUri"] = relative
    return next
  })
}

export const lspFeatureHandlers = HttpApiBuilder.group(InstanceHttpApi, "lsp-features", (handlers) =>
  Effect.gen(function* () {
    const lsp = yield* LSP.Service

    const resolve = Effect.fnUntraced(function* (relative: string) {
      const directory = (yield* InstanceState.context).directory
      const file = path.resolve(directory, relative)
      if (!FSUtil.contains(directory, file)) return yield* Effect.die(new Error("Path escapes the location"))
      return { directory, file }
    })

    const hover = Effect.fn("LspHttpApi.hover")(function* (ctx: { payload: LocPayload }) {
      const { file } = yield* resolve(ctx.payload.path)
      return yield* lsp.hover({ file, line: ctx.payload.line, character: ctx.payload.character }).pipe(Effect.orDie)
    })

    const definition = Effect.fn("LspHttpApi.definition")(function* (ctx: { payload: LocPayload }) {
      const { directory, file } = yield* resolve(ctx.payload.path)
      const results = yield* lsp
        .definition({ file, line: ctx.payload.line, character: ctx.payload.character })
        .pipe(Effect.orDie)
      return rewriteLocations(directory, results)
    })

    const references = Effect.fn("LspHttpApi.references")(function* (ctx: { payload: LocPayload }) {
      const { directory, file } = yield* resolve(ctx.payload.path)
      const results = yield* lsp
        .references({ file, line: ctx.payload.line, character: ctx.payload.character })
        .pipe(Effect.orDie)
      return rewriteLocations(directory, results)
    })

    const completion = Effect.fn("LspHttpApi.completion")(function* (ctx: { payload: LocPayload }) {
      const { file } = yield* resolve(ctx.payload.path)
      const context =
        ctx.payload.triggerKind != null
          ? { triggerKind: ctx.payload.triggerKind, triggerCharacter: ctx.payload.triggerCharacter }
          : undefined
      return yield* lsp
        .completion({ file, line: ctx.payload.line, character: ctx.payload.character }, context)
        .pipe(Effect.orDie)
    })

    const diagnostics = Effect.fn("LspHttpApi.diagnostics")(function* (ctx: { query: { path: string } }) {
      const { file } = yield* resolve(ctx.query.path)
      const all = yield* lsp.diagnostics().pipe(Effect.orDie)
      const entries = all[file] ?? []
      return entries.map(
        (d): DiagnosticOut => ({
          range: d.range,
          severity: d.severity,
          message: d.message,
          source: d.source,
          code: typeof d.code === "string" || typeof d.code === "number" ? d.code : undefined,
        }),
      )
    })

    const buffer = Effect.fn("LspHttpApi.buffer")(function* (ctx: { payload: BufferPayload }) {
      const { file } = yield* resolve(ctx.payload.path)
      yield* lsp.syncBuffer({ file, text: ctx.payload.text, version: ctx.payload.version }).pipe(Effect.orDie)
      return true
    })

    const bufferClose = Effect.fn("LspHttpApi.bufferClose")(function* (ctx: { payload: BufferClosePayload }) {
      const { file } = yield* resolve(ctx.payload.path)
      yield* lsp.closeBuffer(file).pipe(Effect.orDie)
      return true
    })

    return handlers
      .handle("hover", hover)
      .handle("definition", definition)
      .handle("references", references)
      .handle("completion", completion)
      .handle("diagnostics", diagnostics)
      .handle("buffer", buffer)
      .handle("bufferClose", bufferClose)
  }),
)
