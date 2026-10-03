import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import path from "path"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./lsp.txt"
import { InstanceState } from "@/effect/instance-state"
import { pathToFileURL, fileURLToPath } from "url"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Process } from "@/util/process"
import type { TextEdit, WorkspaceEdit } from "vscode-languageserver-types"

const positionalOperations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

const symbolOperations = [
  "structure",
  "types",
  "symbols",
  "members",
  "refs",
  "callers",
  "implementations",
  "rename",
] as const

const operations = [...positionalOperations, ...symbolOperations] as const

// LSP SymbolKind values treated as types (class, enum, interface, struct).
const typeKinds = new Set([5, 10, 11, 23])

// A cold roslyn server answers workspace/symbol with an empty list while it
// loads the solution. Remember which worktrees have finished loading so only
// the first symbol query pays for the wait. Also cache the probe file per root
// so we don't re-glob the tree on every call.
const readyRoots = new Set<string>()
const rootProbeFile = new Map<string, string>()

const kindNames: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  22: "enum member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type parameter",
}

function kindName(kind: number) {
  return kindNames[kind] ?? `kind ${kind}`
}

// Roslyn's workspace/symbol containerName is not a namespace: types get
// "project <name> (net10.0)" and members get "in <Type> (project <name> ...)".
function cleanContainer(container?: string) {
  if (!container) return ""
  let value = container.replace(/^in\s+/i, "")
  value = value.replace(/\s*\(project\s+.*\)\s*$/i, "")
  if (/^project\s/i.test(value)) return ""
  return value.trim()
}

function qualifiedName(symbol: LSP.Symbol) {
  const container = cleanContainer(symbol.containerName)
  return container ? `${container}.${symbol.name}` : symbol.name
}

// Rank candidate symbols: exact simple-name match wins, then namespaces/types
// named in the requested name appearing in the container or file path.
function rankSymbols(name: string, candidates: LSP.Symbol[], predicate?: (symbol: LSP.Symbol) => boolean) {
  const pool = predicate ? candidates.filter(predicate) : candidates
  const list = pool.length ? pool : candidates
  const segments = name.toLowerCase().split(".")
  const short = segments.at(-1)
  const parents = segments.slice(0, -1)
  return list
    .map((symbol) => {
      const hay = `${symbol.containerName ?? ""} ${symbol.location.uri}`.toLowerCase()
      let score = symbol.name.toLowerCase() === short ? 1000 : 0
      for (const segment of parents) if (hay.includes(segment)) score += 10
      return { symbol, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.symbol)
}

// Roslyn's workspace/symbol is fuzzy (e.g. "SqlBuilder" matches
// "...SqlServerDataContextOptionsBuilderExtensions"), while the CLI baseline
// filters by name substring. Drop fuzzy-only matches so discovery stays
// predictable.
function matchesName(symbol: LSP.Symbol, query: string) {
  if (!query) return true
  return symbol.name.toLowerCase().includes(query.toLowerCase())
}

function locationOf(symbol: LSP.Symbol) {
  const file = fileURLToPath(symbol.location.uri)
  const start = symbol.location.range.start
  return { file, line: start.line + 1, character: start.character + 1 }
}

function formatSymbol(symbol: LSP.Symbol) {
  const loc = locationOf(symbol)
  return `${qualifiedName(symbol)} [${kindName(symbol.kind)}] ${loc.file}:${loc.line}:${loc.character}`
}

function findAll(nodes: readonly (LSP.DocumentSymbol | LSP.Symbol)[], name: string): LSP.DocumentSymbol | undefined {
  for (const node of nodes) {
    if (!("range" in node)) continue
    if (node.name === name || node.name.endsWith(`.${name}`)) return node
    const child = findAll(node.children ?? [], name)
    if (child) return child
  }
  return undefined
}

function formatMembers(node: LSP.DocumentSymbol, depth = 0): string[] {
  const start = node.selectionRange?.start ?? node.range.start
  const detail = node.detail && node.detail.includes(node.name) ? node.detail : `${node.detail ? `${node.detail} ` : ""}${node.name}`
  const head = `${"  ".repeat(depth)}${kindName(node.kind)} ${detail}  (${start.line + 1}:${start.character + 1})`
  return [head, ...(node.children ?? []).flatMap((child) => formatMembers(child, depth + 1))]
}

function offsetAt(lines: string[], line: number, character: number) {
  let total = 0
  for (let i = 0; i < line && i < lines.length; i++) total += lines[i].length + 1
  return total + character
}

function applyTextEdits(text: string, edits: TextEdit[]) {
  const lines = text.split("\n")
  const ordered = [...edits].sort(
    (a, b) =>
      offsetAt(lines, b.range.start.line, b.range.start.character) -
      offsetAt(lines, a.range.start.line, a.range.start.character),
  )
  return ordered.reduce((acc, edit) => {
    const start = offsetAt(lines, edit.range.start.line, edit.range.start.character)
    const end = offsetAt(lines, edit.range.end.line, edit.range.end.character)
    return acc.slice(0, start) + edit.newText + acc.slice(end)
  }, text)
}

function workspaceEditFiles(edit: WorkspaceEdit) {
  const files = new Map<string, TextEdit[]>()
  const add = (uri: string, edits: TextEdit[]) => {
    files.set(uri, [...(files.get(uri) ?? []), ...edits])
  }
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    if (edits?.length) add(uri, edits)
  }
  for (const change of edit.documentChanges ?? []) {
    if ("textDocument" in change && "edits" in change && Array.isArray(change.edits)) {
      add(change.textDocument.uri, change.edits as TextEdit[])
    }
  }
  return files
}

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The LSP operation to perform" }),
  filePath: Schema.optional(Schema.String).annotate({
    description:
      "The absolute or relative path to the file. Required for position-based operations. Optional for symbol-based operations: a file in the target language picks which server answers.",
  }),
  line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "The line number (1-based, as shown in editors) for position-based operations",
  }),
  character: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "The character offset (1-based, as shown in editors) for position-based operations",
  }),
  query: Schema.optional(Schema.String).annotate({
    description:
      "Search query for workspaceSymbol/types. `types` matches type names by substring. Empty string requests all symbols.",
  }),
  symbol: Schema.optional(Schema.String).annotate({
    description:
      "Full symbol name for semantic operations: symbols, members, refs, callers, implementations, rename.",
  }),
  newName: Schema.optional(Schema.String).annotate({ description: "New name for rename." }),
  apply: Schema.optional(Schema.Boolean).annotate({
    description: "For rename: write the edits to disk (default is a dry-run report).",
  }),
  solution: Schema.optional(Schema.String).annotate({
    description: "Path to a .sln/.slnx for structure; defaults to the first solution in the worktree.",
  }),
})

export const LspTool = Tool.define(
  "lsp",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = instance.worktree || instance.directory
          // Symbol operations have no file argument, so the bootstrap search is
          // scoped to the opened directory. `worktree` can point above it for a
          // directory outside a repository, which would sweep unrelated files.
          const probeRoot = instance.directory

          const positional = (positionalOperations as readonly string[]).includes(args.operation)

          if (positional) {
            if (!args.filePath || args.line === undefined || args.character === undefined) {
              throw new Error(`operation ${args.operation} requires filePath, line and character`)
            }
            const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(instance.directory, args.filePath)
            yield* assertExternalDirectoryEffect(ctx, file)
            const meta =
              args.operation === "workspaceSymbol"
                ? { operation: args.operation }
                : args.operation === "documentSymbol"
                  ? { operation: args.operation, filePath: file }
                  : { operation: args.operation, filePath: file, line: args.line, character: args.character }
            yield* ctx.ask({ permission: "lsp", patterns: ["*"], always: ["*"], metadata: meta })
            const uri = pathToFileURL(file).href
            const position = { file, line: args.line - 1, character: args.character - 1 }
            const relPath = path.relative(instance.worktree, file)
            const detail =
              args.operation === "workspaceSymbol"
                ? ""
                : args.operation === "documentSymbol"
                  ? relPath
                  : `${relPath}:${args.line}:${args.character}`
            const title = detail ? `${args.operation} ${detail}` : args.operation

            const exists = yield* fs.existsSafe(file)
            if (!exists) throw new Error(`File not found: ${file}`)

            const available = yield* lsp.hasClients(file)
            if (!available) throw new Error("No LSP server available for this file type.")

            yield* lsp.touchFile(file, "document")

            const result: unknown[] = yield* (() => {
              switch (args.operation) {
                case "goToDefinition":
                  return lsp.definition(position)
                case "findReferences":
                  return lsp.references(position)
                case "hover":
                  return lsp.hover(position)
                case "documentSymbol":
                  return lsp.documentSymbol(uri)
                case "workspaceSymbol":
                  return lsp.workspaceSymbol(args.query ?? "")
                case "goToImplementation":
                  return lsp.implementation(position)
                case "prepareCallHierarchy":
                  return lsp.prepareCallHierarchy(position)
                case "incomingCalls":
                  return lsp.incomingCalls(position)
                case "outgoingCalls":
                  return lsp.outgoingCalls(position)
              }
              throw new Error(`Unsupported operation ${args.operation}`)
            })()

            return {
              title,
              metadata: { result },
              output: result.length === 0 ? `No results found for ${args.operation}` : JSON.stringify(result, null, 2),
            }
          }

          // Semantic operations accept a full symbol name instead of a position and
          // reuse the already-running language server (no separate MSBuild daemon).

          yield* ctx.ask({
            permission: "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: args.symbol
              ? { operation: args.operation, symbol: args.symbol }
              : { operation: args.operation },
          })

          // A symbol query needs a live client, but servers are keyed by file
          // extension and these operations have no file argument. Prefer a caller
          // supplied file in the target language; otherwise pick the project's
          // dominant extension. Touch the probe to start that server, then (once
          // per probe) wait until it can answer: a cold server returns an empty
          // workspace/symbol list while it loads, so poll until it answers.
          const hint = args.filePath
            ? path.isAbsolute(args.filePath)
              ? args.filePath
              : path.join(instance.directory, args.filePath)
            : undefined
          if (hint) yield* assertExternalDirectoryEffect(ctx, hint)
          const startProbe = Effect.fnUntraced(function* (query: string, preferred?: string) {
            const key = preferred ? `${probeRoot}::${path.extname(preferred)}` : probeRoot
            let file = preferred ?? rootProbeFile.get(key)
            if (!file) {
              const extensions = yield* lsp.serverExtensions()
              const pattern = extensions.length ? `**/*{${extensions.join(",")}}` : "**/*"
              const ignored = ["obj", "bin", "node_modules", ".git"].map((part) => `${path.sep}${part}${path.sep}`)
              const files = yield* fs
                .glob(pattern, { cwd: probeRoot, absolute: true, include: "file" })
                .pipe(Effect.catch(() => Effect.succeed<string[]>([])))
              const inside = files.filter(
                (candidate) =>
                  candidate.startsWith(`${probeRoot}${path.sep}`) && !ignored.some((part) => candidate.includes(part)),
              )
              // A symbol has no file of its own, so bootstrap from the project's
              // dominant extension. This keeps polyglot workspaces from answering
              // a C# query from, say, the first .json file.
              const counts = new Map<string, number>()
              for (const candidate of inside) {
                const ext = path.extname(candidate).toLowerCase()
                counts.set(ext, (counts.get(ext) ?? 0) + 1)
              }
              const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
              file = inside.find((candidate) => path.extname(candidate).toLowerCase() === dominant)
              if (file) rootProbeFile.set(key, file)
            }
            if (!file) throw new Error("No source files for a configured LSP server were found.")
            const available = yield* lsp.hasClients(file)
            if (!available) throw new Error("No LSP server available for the project files.")
            yield* lsp.touchFile(file)
            if (!query || readyRoots.has(key)) return file
            const deadline = Date.now() + 20000
            while (Date.now() < deadline) {
              const probe = yield* lsp.searchSymbols(query, file)
              if (probe.length > 0) {
                readyRoots.add(key)
                return file
              }
              yield* Effect.sleep(300)
            }
            return file
          })

          if (args.operation === "structure") {
            let solution: string | undefined
            if (args.solution) {
              solution = path.isAbsolute(args.solution) ? args.solution : path.join(root, args.solution)
            } else {
              const entries = yield* fs
                .readDirectoryEntries(root)
                .pipe(Effect.catch(() => Effect.succeed([] as FSUtil.DirEntry[])))
              const entry = entries.find((item) => item.type === "file" && /\.slnx?$/i.test(item.name))
              solution = entry ? path.join(root, entry.name) : undefined
            }
            if (!solution) throw new Error("No .sln/.slnx found in the worktree; pass `solution`.")
            const probe = yield* startProbe("", hint)
            const listed = yield* Effect.promise(() =>
              Process.text(["dotnet", "sln", solution!, "list"], { cwd: root, nothrow: true }),
            )
            const projects = listed.text
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
            const symbols = yield* lsp.searchSymbols("", probe)
            const containers = new Map<string, number>()
            for (const symbol of symbols) {
              const container = symbol.containerName
              if (!container) continue
              containers.set(container, (containers.get(container) ?? 0) + 1)
            }
            const tree = [
              solution,
              ...projects.map((project) => `  ${project}`),
              ...(containers.size
                ? [
                    "",
                    "namespaces/containers:",
                    ...[...containers.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, count]) => `  ${name} (${count})`),
                  ]
                : []),
            ]
            return {
              title: `structure ${path.relative(instance.worktree, solution)}`,
              metadata: { result: { solution, projects, symbols: symbols.length } },
              output: tree.join("\n"),
            }
          }

          if (args.operation === "types") {
            const query = args.query ?? args.symbol ?? ""
            const probe = yield* startProbe(query, hint)
            const symbols = (yield* lsp.searchSymbols(query, probe)).filter(
              (symbol) => typeKinds.has(symbol.kind) && matchesName(symbol, query),
            )
            return {
              title: `types ${query}`,
              metadata: { result: symbols },
              output: symbols.length === 0 ? "No types found" : symbols.map(formatSymbol).join("\n"),
            }
          }

          const name = args.symbol
          if (!name) throw new Error(`operation ${args.operation} requires \`symbol\``)

          const short = name.split(".").at(-1) ?? name
          const probe = yield* startProbe(short, hint)
          const candidates = yield* lsp.searchSymbols(short, probe)
          // `members` needs a type, so restrict resolution to type kinds there.
          const matches = rankSymbols(
            name,
            candidates,
            args.operation === "members" ? (symbol) => typeKinds.has(symbol.kind) : undefined,
          )
          if (matches.length === 0) {
            return {
              title: args.operation,
              metadata: { result: [] },
              output: `No symbol found for "${name}"`,
            }
          }
          const target = matches[0]
          const loc = locationOf(target)
          const position = { file: loc.file, line: loc.line - 1, character: loc.character - 1 }
          const available = yield* lsp.hasClients(loc.file)
          if (!available) throw new Error(`No LSP server available for ${loc.file} (resolved from "${name}").`)

          if (args.operation === "symbols") {
            const filtered = matches.filter((symbol) => matchesName(symbol, short))
            // Fall back to fuzzy matches for names the substring filter cannot
            // see (e.g. generic arity like "Foo<T>").
            const shown = filtered.length ? filtered : matches
            return {
              title: `symbols ${name}`,
              metadata: { result: shown },
              output: shown.map(formatSymbol).join("\n"),
            }
          }

          yield* lsp.touchFile(loc.file)

          if (args.operation === "members") {
            const uri = pathToFileURL(loc.file).href
            const nodes = yield* lsp.documentSymbol(uri)
            const node = findAll(nodes, target.name)
            if (!node) {
              return { title: `members ${name}`, metadata: { result: [] }, output: `No members found for "${name}"` }
            }
            const members = formatMembers(node)
            return {
              title: `members ${name}`,
              metadata: { result: members },
              output: members.join("\n"),
            }
          }

          if (args.operation === "refs") {
            const refs = yield* lsp.references(position)
            return {
              title: `refs ${name}`,
              metadata: { result: refs },
              output: refs.length === 0 ? `No references to "${name}"` : JSON.stringify(refs, null, 2),
            }
          }

          if (args.operation === "callers") {
            const calls = yield* lsp.incomingCalls(position)
            return {
              title: `callers ${name}`,
              metadata: { result: calls },
              output: calls.length === 0 ? `No callers of "${name}"` : JSON.stringify(calls, null, 2),
            }
          }

          if (args.operation === "implementations") {
            const impls = yield* lsp.implementation(position)
            return {
              title: `implementations ${name}`,
              metadata: { result: impls },
              output: impls.length === 0 ? `No implementations of "${name}"` : JSON.stringify(impls, null, 2),
            }
          }

          if (args.operation === "rename") {
            if (!args.newName) throw new Error("operation rename requires `newName`")
            const edit = yield* lsp.rename({ ...position, newName: args.newName })
            if (!edit) {
              return { title: `rename ${name}`, metadata: { result: [] }, output: `Rename failed for "${name}"` }
            }
            const files = workspaceEditFiles(edit)
            if (!args.apply) {
              const summary = [...files.entries()].map(
                ([uri, edits]) => `${fileURLToPath(uri)}: ${edits.length} edit(s)`,
              )
              return {
                title: `rename ${name} -> ${args.newName} (dry-run)`,
                metadata: { result: edit },
                output: [`Dry-run (${summary.length} file(s)). Pass apply=true to write.`, ...summary].join("\n"),
              }
            }
            const written: string[] = []
            for (const [uri, edits] of files) {
              const file = fileURLToPath(uri)
              const text = yield* fs.readFileStringSafe(file)
              if (text === undefined) continue
              yield* fs.writeWithDirs(file, applyTextEdits(text, edits))
              written.push(`${file}: ${edits.length} edit(s)`)
            }
            return {
              title: `rename ${name} -> ${args.newName}`,
              metadata: { result: edit },
              output: [`Applied rename in ${written.length} file(s).`, ...written].join("\n"),
            }
          }

          return {
            title: args.operation,
            metadata: { result: [] },
            output: `Unsupported operation ${args.operation}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
