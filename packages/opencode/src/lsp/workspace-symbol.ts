import * as InstanceState from "@/effect/instance-state"
import { Ripgrep } from "@/file/ripgrep"
import { LSP } from "@/lsp/lsp"
import path from "path"
import { Effect, Stream } from "effect"

const seedLimit = 200
const ignoredExtensions = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".md", ".txt", ".lock"])

export const search = Effect.fn("LSPWorkspaceSymbol.search")(function* (query: string) {
  const lsp = yield* LSP.Service
  const existing = yield* lsp.workspaceSymbol(query)
  if (existing.length) return existing

  const ripgrep = yield* Ripgrep.Service
  const instance = yield* InstanceState.context
  const matches = query
    ? yield* ripgrep.search({ cwd: instance.directory, pattern: query, limit: seedLimit }).pipe(
        Effect.map((result) => result.items.map((item) => item.path.text)),
        Effect.catch(() => Effect.succeed([])),
      )
    : []
  const files = matches.length
    ? matches
    : yield* ripgrep.files({ cwd: instance.directory }).pipe(
        Stream.take(seedLimit),
        Stream.runCollect,
        Effect.map((chunk) => [...chunk]),
        Effect.catch(() => Effect.succeed([])),
      )
  const seeded = new Set<string>()

  for (const file of files) {
    const extension = path.extname(file) || file
    if (ignoredExtensions.has(extension)) continue
    if (seeded.has(extension)) continue

    const absolute = path.join(instance.directory, file)
    if (!(yield* lsp.hasClients(absolute))) continue

    seeded.add(extension)
    yield* lsp.touchFile(absolute)
  }

  if (!seeded.size) return []
  return yield* lsp.workspaceSymbol(query)
})

export * as LSPWorkspaceSymbol from "./workspace-symbol"
