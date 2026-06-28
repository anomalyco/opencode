import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Glob } from "@opencode-ai/core/util/glob"
import * as Bm25 from "./bm25"
import { parsePath } from "./paths"

export interface SearchInput {
  query: string
  scope?: string
  scope_id?: string
  type?: string
  limit?: number
}

export interface SearchResult {
  path: string
  snippet: string
  score: number
  scope: string
  scope_id: string
  type: string
}

export interface Interface {
  readonly root: () => Effect.Effect<string>
  readonly search: (input: SearchInput) => Effect.Effect<SearchResult[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const root = path.join(Global.Path.data, "memory")

    const rootEff = Effect.fn("Memory.root")(function* () {
      return root
    })

    const search = Effect.fn("Memory.search")(function* (input: SearchInput) {
      const exists = yield* fs.existsSafe(root)
      if (!exists) return [] as SearchResult[]

      const files = Glob.scanSync("**/*.md", { cwd: root, absolute: true, dot: true })
      if (files.length === 0) return [] as SearchResult[]

      // Read bodies + derive locator from path; apply scope/scope_id/type
      // filters before ranking (mirrors MiMo's SQL WHERE clause semantics).
      const docs: Bm25.Doc[] = []
      const meta = new Map<string, { scope: string; scope_id: string; type: string }>()
      for (const file of files) {
        const normalized = file.replaceAll("\\", "/")
        const loc = parsePath(normalized)
        if (!loc) continue
        if (input.scope && loc.scope !== input.scope) continue
        if (input.scope_id && loc.scope_id !== input.scope_id) continue
        if (input.type && loc.type !== input.type) continue
        const body = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (body === undefined) continue
        docs.push({ path: file, body })
        meta.set(file, { scope: loc.scope, scope_id: loc.scope_id, type: loc.type })
      }

      const ranked = Bm25.search(docs, input.query, { limit: input.limit ?? 10 })
      return ranked.map((r) => {
        const m = meta.get(r.path)!
        return {
          path: r.path,
          snippet: r.snippet,
          score: r.score,
          scope: m.scope,
          scope_id: m.scope_id,
          type: m.type,
        }
      })
    })

    return Service.of({ root: rootEff, search })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer))

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })

export * as Memory from "./service"
