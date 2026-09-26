import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as LSPClient from "./client"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import * as LSPServer from "./server"
import { Config } from "@/config/config"
import { Process } from "@/util/process"
import { spawn as lspspawn } from "./launch"
import { Duration, Effect, Layer, Context, Schema, Schedule } from "effect"
import fs from "node:fs/promises"
import { InstanceState } from "@/effect/instance-state"
import { containsPath } from "@/project/instance-context"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LspEvent } from "@opencode-ai/schema/lsp-event"

export const Event = LspEvent

const Position = Schema.Struct({
  line: NonNegativeInt,
  character: NonNegativeInt,
})

export const Range = Schema.Struct({
  start: Position,
  end: Position,
}).annotate({ identifier: "Range" })
export type Range = typeof Range.Type

export const Symbol = Schema.Struct({
  name: Schema.String,
  kind: NonNegativeInt,
  location: Schema.Struct({
    uri: Schema.String,
    range: Range,
  }),
}).annotate({ identifier: "Symbol" })
export type Symbol = typeof Symbol.Type

export const DocumentSymbol = Schema.Struct({
  name: Schema.String,
  detail: Schema.optional(Schema.String),
  kind: NonNegativeInt,
  range: Range,
  selectionRange: Range,
}).annotate({ identifier: "DocumentSymbol" })
export type DocumentSymbol = typeof DocumentSymbol.Type

export const Status = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
}).annotate({ identifier: "LSPStatus" })
export type Status = typeof Status.Type

enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

const kinds = [
  SymbolKind.Class,
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Interface,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.Struct,
  SymbolKind.Enum,
]

const filterExperimentalServers = (servers: Record<string, LSPServer.Info>, flags: RuntimeFlags.Info) => {
  if (flags.experimentalLspTy) {
    if (servers["pyright"]) {
      delete servers["pyright"]
    }
  } else {
    if (servers["ty"]) {
      delete servers["ty"]
    }
  }
}

type LocInput = { file: string; line: number; character: number }

interface State {
  clients: LSPClient.Info[]
  servers: Record<string, LSPServer.Info>
  roots: Map<string, RootRecord>
  retiring: Set<Promise<void>>
  cleanupFailures: unknown[]
  report: (message: string, error: unknown) => void
  disposed: boolean
}

interface Attempt {
  promise?: Promise<LSPClient.Info | undefined>
  handle?: LSPServer.Handle
  retired: boolean
  cancelled: Promise<void>
  cancel: () => void
  record: RootRecord
  identity: RootIdentity
}

interface RootRecord {
  key: string
  root: string
  server: LSPServer.Info
  identity: RootIdentity
  broken: boolean
  stale: boolean
  attempt?: Attempt
  client?: LSPClient.Info
  clientAttempt?: Attempt
  retirement?: Promise<void>
}

interface RootIdentity {
  device: string
  inode: string
  type: "directory" | "other"
  birthtimeNs?: string
  stable: boolean
}

const keyFor = (root: string, server: LSPServer.Info) => JSON.stringify([root, server.id])

const rootChanged = (left: RootIdentity, right: RootIdentity) => {
  if (left.type !== right.type) return true
  if (!left.stable || !right.stable) return false
  return left.device !== right.device || left.inode !== right.inode || left.birthtimeNs !== right.birthtimeNs
}

async function rootIdentity(root: string) {
  try {
    const stat = await fs.stat(root, { bigint: true })
    const device = String(stat.dev)
    const inode = String(stat.ino)
    const birthtimeNs = stat.birthtimeNs === 0n ? undefined : String(stat.birthtimeNs)
    return {
      _tag: "present" as const,
      identity: {
        device,
        inode,
        type: stat.isDirectory() ? ("directory" as const) : ("other" as const),
        birthtimeNs,
        stable: stat.dev !== 0n && stat.ino !== 0n,
      },
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return { _tag: "missing" as const }
    }
    return { _tag: "uncertain" as const }
  }
}

const current = (state: State, record: RootRecord, attempt: Attempt) =>
  !state.disposed &&
  !record.stale &&
  !attempt.retired &&
  state.roots.get(record.key) === record &&
  record.attempt === attempt &&
  record.identity === attempt.identity

const currentClient = (state: State, record: RootRecord, attempt: Attempt, client: LSPClient.Info) =>
  !state.disposed &&
  !record.stale &&
  state.roots.get(record.key) === record &&
  record.identity === attempt.identity &&
  record.client === client &&
  record.clientAttempt === attempt

function reportCleanupFailure(state: State, message: string, error: unknown) {
  if (state.disposed) {
    state.report(message, error)
    return
  }
  state.cleanupFailures.push(error)
}

function retire(state: State, record: RootRecord) {
  if (record.retirement) return record.retirement
  record.stale = true
  if (state.roots.get(record.key) === record) state.roots.delete(record.key)

  const attempt = record.attempt
  if (attempt && attempt.record === record) {
    attempt.retired = true
    attempt.cancel()
    if (record.attempt === attempt) record.attempt = undefined
    attempt.handle?.process.stdin?.destroy()
    attempt.handle?.process.stdout?.destroy()
    attempt.handle?.process.stderr?.destroy()
  }

  const client = record.client
  if (client && record.client === client) {
    record.client = undefined
    record.clientAttempt = undefined
    const index = state.clients.indexOf(client)
    if (index !== -1) state.clients.splice(index, 1)
  }

  const cleanup = Promise.allSettled([
    ...(attempt?.promise ? [attempt.promise] : []),
    ...(attempt?.handle ? [Process.stop(attempt.handle.process)] : []),
    ...(client ? [client.shutdown()] : []),
  ]).then((results) => {
    const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
    if (failures.length) throw new AggregateError(failures, `Failed to retire LSP root ${record.root}`)
  })
  record.retirement = cleanup
  state.retiring.add(cleanup)
  void cleanup.then(
    () => state.retiring.delete(cleanup),
    (error) => {
      state.retiring.delete(cleanup)
      reportCleanupFailure(state, "LSP root cleanup failed after disposal", error)
    },
  )
  return cleanup
}

async function waitForRetirements(state: State, remaining: Promise<void>[] = []) {
  const retirements = [...state.retiring]
  const results = await Promise.allSettled([...retirements, ...remaining])
  const failures = [
    ...state.cleanupFailures.splice(0),
    ...results.slice(retirements.length).flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
  ]
  if (failures.length) throw new AggregateError(failures, "Failed to retire LSP roots")
}

async function reconcileRoots(state: State) {
  let updated = false
  for (const record of [...state.roots.values()]) {
    if (state.disposed) return updated
    const observed = await rootIdentity(record.root)
    if (state.roots.get(record.key) !== record) continue
    if (observed._tag === "uncertain") continue
    if (observed._tag === "present" && !rootChanged(record.identity, observed.identity)) continue
    retire(state, record)
    updated = true
  }
  await waitForRetirements(state)
  return updated
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status[]>
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  readonly touchFile: (input: string, diagnostics?: "document" | "full") => Effect.Effect<void>
  readonly diagnostics: () => Effect.Effect<Record<string, LSPClient.Diagnostic[]>>
  readonly hover: (input: LocInput) => Effect.Effect<any>
  readonly definition: (input: LocInput) => Effect.Effect<any[]>
  readonly references: (input: LocInput) => Effect.Effect<any[]>
  readonly implementation: (input: LocInput) => Effect.Effect<any[]>
  readonly documentSymbol: (uri: string) => Effect.Effect<(DocumentSymbol | Symbol)[]>
  readonly workspaceSymbol: (query: string) => Effect.Effect<Symbol[]>
  readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<any[]>
  readonly incomingCalls: (input: LocInput) => Effect.Effect<any[]>
  readonly outgoingCalls: (input: LocInput) => Effect.Effect<any[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LSP") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("LSP.state")(function* (ctx) {
        const cfg = yield* config.get()

        const servers: Record<string, LSPServer.Info> = {}

        if (!cfg.lsp) {
          yield* Effect.logInfo("all LSPs are disabled")
        } else {
          for (const server of Object.values(LSPServer)) {
            servers[server.id] = server
          }

          filterExperimentalServers(servers, flags)

          if (cfg.lsp !== true) {
            for (const [name, item] of Object.entries(cfg.lsp)) {
              const existing = servers[name]
              if (item.disabled) {
                yield* Effect.logInfo(`LSP server ${name} is disabled`)
                delete servers[name]
                continue
              }
              servers[name] = {
                ...existing,
                id: name,
                root: existing?.root ?? (async (_file, ctx) => ctx.directory),
                extensions: item.extensions ?? existing?.extensions ?? [],
                spawn: async (root) => ({
                  process: lspspawn(item.command[0], item.command.slice(1), {
                    cwd: root,
                    env: { ...process.env, ...item.env },
                  }),
                  initialization: item.initialization,
                }),
              }
            }
          }

          yield* Effect.logInfo("enabled LSP servers", {
            serverIds: Object.values(servers)
              .map((server) => server.id)
              .join(", "),
          })
        }

        const s: State = {
          clients: [],
          servers,
          roots: new Map(),
          retiring: new Set(),
          cleanupFailures: [],
          report: (message, error) => Effect.runFork(Effect.logError(message, { cause: error })),
          disposed: false,
        }

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            s.disposed = true
            for (const record of [...s.roots.values()]) retire(s, record)
            const clients = s.clients.splice(0)
            await waitForRetirements(
              s,
              clients.map((client) => client.shutdown()),
            )
          }).pipe(Effect.catchCause((cause) => Effect.logError("LSP root cleanup failed", { cause }))),
        )

        yield* Effect.gen(function* () {
          const updated = yield* Effect.promise(() => reconcileRoots(s))
          if (updated && !s.disposed) yield* events.publish(Event.Updated, {})
        }).pipe(
          Effect.catchCause((cause) => Effect.logError("LSP root reconciliation failed", { cause })),
          Effect.repeat(Schedule.spaced(Duration.millis(250))),
          Effect.delay(Duration.millis(250)),
          Effect.forkScoped,
        )

        return s
      }),
    )

    const getClients = Effect.fnUntraced(function* (file: string) {
      const ctx = yield* InstanceState.context
      if (!containsPath(file, ctx)) return [] as LSPClient.Info[]
      const s = yield* InstanceState.get(state)
      if (s.disposed) return [] as LSPClient.Info[]
      const clients = yield* Effect.promise(async () => {
        const empty = { result: [] as LSPClient.Info[], updated: false }
        if (s.disposed) return empty
        const extension = path.parse(file).ext || file
        const result: LSPClient.Info[] = []
        let updated = false

        async function schedule(record: RootRecord, attempt: Attempt) {
          const spawning = record.server.spawn(record.root, ctx, flags)
          let handle: LSPServer.Handle | undefined
          try {
            handle = await Promise.race([spawning, attempt.cancelled.then(() => undefined)])
          } catch {
            if (current(s, record, attempt)) record.broken = true
            return undefined
          }

          if (!handle) {
            if (!attempt.retired) {
              record.broken = true
              return undefined
            }
            void spawning.then(
              (late) => {
                if (!late) return
                return Process.stop(late.process).catch((error) =>
                  reportCleanupFailure(s, "LSP spawn cleanup failed", error),
                )
              },
              () => undefined,
            )
            return undefined
          }

          if (!current(s, record, attempt)) {
            await Process.stop(handle.process)
            return undefined
          }

          attempt.handle = handle
          const creating = LSPClient.create({
            serverID: record.server.id,
            server: handle,
            root: record.root,
            directory: ctx.directory,
            instance: ctx,
          })
          let client: LSPClient.Info | undefined
          try {
            client = await Promise.race([creating, attempt.cancelled.then(() => undefined)])
          } catch {
            if (current(s, record, attempt)) record.broken = true
            await Process.stop(handle.process)
            return undefined
          }
          if (!client) {
            void creating.then(
              (late) => late.shutdown().catch((error) => reportCleanupFailure(s, "LSP client cleanup failed", error)),
              () => undefined,
            )
            return undefined
          }

          if (!current(s, record, attempt)) {
            await client.shutdown()
            return undefined
          }

          record.client = client
          record.clientAttempt = attempt
          attempt.handle = undefined
          record.attempt = undefined
          s.clients.push(client)
          return client
        }

        for (const server of Object.values(s.servers)) {
          if (server.extensions.length && !server.extensions.includes(extension)) continue

          for (let retry = 0; retry < 3; retry++) {
            const root = await server.root(file, ctx)
            if (s.disposed) return empty
            if (!root) break
            const key = keyFor(root, server)
            const snapshot = s.roots.get(key)
            const observed = await rootIdentity(root)
            if (s.disposed) return empty
            if (s.roots.get(key) !== snapshot) continue

            let record = snapshot
            if (
              record &&
              (observed._tag === "missing" ||
                (observed._tag === "present" && rootChanged(record.identity, observed.identity)))
            ) {
              retire(s, record)
              updated = true
            }
            record = s.roots.get(key)
            if (!record) {
              if (observed._tag !== "present") break
              const replacement: RootRecord = {
                key,
                root,
                server,
                identity: observed.identity,
                broken: false,
                stale: false,
              }
              if (!s.roots.has(key)) s.roots.set(key, replacement)
              record = s.roots.get(key)
            }
            if (!record || record.broken) break

            if (record.client) {
              result.push(record.client)
              break
            }

            if (record.attempt) {
              const attempt = record.attempt
              const client = await attempt.promise
              if (s.disposed) return empty
              if (!client) {
                if (current(s, record, attempt) && record.broken) break
                continue
              }
              if (!currentClient(s, record, attempt, client)) continue
              result.push(client)
              break
            }

            if (s.disposed) return empty
            let cancel!: () => void
            const attempt: Attempt = {
              retired: false,
              cancelled: new Promise<void>((resolve) => {
                cancel = resolve
              }),
              cancel: () => cancel(),
              record,
              identity: record.identity,
            }
            record.attempt = attempt
            const task = schedule(record, attempt)
            attempt.promise = task

            void task.then(
              () => {
                if (record.attempt === attempt) record.attempt = undefined
              },
              (error) => {
                if (record.attempt === attempt) record.attempt = undefined
                reportCleanupFailure(s, "LSP root attempt cleanup failed after disposal", error)
              },
            )

            const client = await task
            if (s.disposed) return empty
            if (!client) {
              if (current(s, record, attempt) && record.broken) break
              continue
            }
            if (!currentClient(s, record, attempt, client)) continue
            result.push(client)
            updated = true
            break
          }
        }

        return { result, updated }
      })
      if (s.disposed) return []
      yield* clients.updated ? events.publish(Event.Updated, {}) : Effect.void
      if (s.disposed) return []
      return clients.result
    })

    const run = Effect.fnUntraced(function* <T>(file: string, fn: (client: LSPClient.Info) => Promise<T>) {
      const clients = yield* getClients(file)
      return yield* Effect.promise(() => Promise.all(clients.map((x) => fn(x))))
    })

    const runAll = Effect.fnUntraced(function* <T>(fn: (client: LSPClient.Info) => Promise<T>) {
      const s = yield* InstanceState.get(state)
      return yield* Effect.promise(() => Promise.all(s.clients.map((x) => fn(x))))
    })

    const init = Effect.fn("LSP.init")(function* () {
      yield* InstanceState.get(state)
    })

    const status = Effect.fn("LSP.status")(function* () {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      const result: Status[] = []
      for (const client of s.clients) {
        result.push({
          id: client.serverID,
          name: s.servers[client.serverID].id,
          root: path.relative(ctx.directory, client.root),
          status: "connected",
        })
      }
      return result
    })

    const hasClients = Effect.fn("LSP.hasClients")(function* (file: string) {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      if (s.disposed) return false
      return yield* Effect.promise(async () => {
        if (s.disposed) return false
        const extension = path.parse(file).ext || file
        for (const server of Object.values(s.servers)) {
          if (server.extensions.length && !server.extensions.includes(extension)) continue
          const root = await server.root(file, ctx)
          if (s.disposed) return false
          if (!root) continue
          if (s.roots.get(keyFor(root, server))?.broken) continue
          return true
        }
        return false
      })
    })

    const touchFile = Effect.fn("LSP.touchFile")(function* (input: string, diagnostics?: "document" | "full") {
      yield* Effect.logInfo("touching file", { file: input })
      const clients = yield* getClients(input)
      yield* Effect.promise(() =>
        Promise.all(
          clients.map(async (client) => {
            const after = Date.now()
            const version = await client.notify.open({ path: input })
            if (!diagnostics) return
            return client.waitForDiagnostics({
              path: input,
              version,
              mode: diagnostics,
              after,
            })
          }),
        ).catch(() => {}),
      )
    })

    const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
      const results: Record<string, LSPClient.Diagnostic[]> = {}
      const all = yield* runAll(async (client) => client.diagnostics)
      for (const result of all) {
        for (const [p, diags] of result.entries()) {
          const arr = results[p] || []
          arr.push(...diags)
          results[p] = arr
        }
      }
      return results
    })

    const hover = Effect.fn("LSP.hover")(function* (input: LocInput) {
      return yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/hover", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
    })

    const definition = Effect.fn("LSP.definition")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/definition", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const references = Effect.fn("LSP.references")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/references", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            context: { includeDeclaration: true },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const implementation = Effect.fn("LSP.implementation")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/implementation", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string) {
      const file = fileURLToPath(uri)
      const results = yield* run(file, (client) =>
        client.connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri } }).catch(() => []),
      )
      return (results.flat() as (DocumentSymbol | Symbol)[]).filter(Boolean)
    })

    const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
      const results = yield* runAll((client) =>
        client.connection
          .sendRequest<Symbol[]>("workspace/symbol", { query })
          .then((result) => result.filter((x) => kinds.includes(x.kind)).slice(0, 10))
          .catch(() => [] as Symbol[]),
      )
      return results.flat()
    })

    const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const callHierarchyRequest = Effect.fnUntraced(function* (
      input: LocInput,
      direction: "callHierarchy/incomingCalls" | "callHierarchy/outgoingCalls",
    ) {
      const results = yield* run(input.file, async (client) => {
        const items = await client.connection
          .sendRequest<unknown[] | null>("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => [] as unknown[])
        if (!items?.length) return []
        return client.connection.sendRequest(direction, { item: items[0] }).catch(() => [])
      })
      return results.flat().filter(Boolean)
    })

    const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: LocInput) {
      return yield* callHierarchyRequest(input, "callHierarchy/incomingCalls")
    })

    const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (input: LocInput) {
      return yield* callHierarchyRequest(input, "callHierarchy/outgoingCalls")
    })

    return Service.of({
      init,
      status,
      hasClients,
      touchFile,
      diagnostics,
      hover,
      definition,
      references,
      implementation,
      documentSymbol,
      workspaceSymbol,
      prepareCallHierarchy,
      incomingCalls,
      outgoingCalls,
    })
  }),
)

export * as Diagnostic from "./diagnostic"

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, RuntimeFlags.node, FSUtil.node, EventV2Bridge.node],
})

export * as LSP from "./lsp"
