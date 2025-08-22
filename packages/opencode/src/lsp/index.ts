import { App } from "../app/app"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "path"
import { LSPServer } from "./server"
import { z } from "zod"
import { Config } from "../config/config"
import { spawn } from "child_process"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  export const Range = z
    .object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    })
    .openapi({
      ref: "Range",
    })
  export type Range = z.infer<typeof Range>

  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: Range,
      }),
    })
    .openapi({
      ref: "Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z
    .object({
      name: z.string(),
      detail: z.string().optional(),
      kind: z.number(),
      range: Range,
      selectionRange: Range,
    })
    .openapi({
      ref: "DocumentSymbol",
    })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  // Process management to prevent excessive spawning
  interface ProcessInfo {
    process: any
    createdAt: number
    lastUsed: number
    refCount: number
    serverID: string
    root: string
  }

  const state = App.state(
    "lsp",
    async () => {
      const clients: LSPClient.Info[] = []
      const servers: Record<string, LSPServer.Info> = {}
      const processPool: Map<string, ProcessInfo> = new Map()
      const maxProcessesPerServer = 3 // Limit processes per server type
      const processTimeout = 300000 // 5 minutes timeout for unused processes

      // Cleanup timer for unused processes
      const cleanupInterval = setInterval(() => {
        const now = Date.now()
        for (const [key, info] of processPool.entries()) {
          if (info.refCount === 0 && now - info.lastUsed > processTimeout) {
            log.info(`Cleaning up unused LSP process ${info.serverID}`, { key, pid: info.process.pid })
            try {
              info.process.kill("SIGTERM")
              setTimeout(() => {
                if (!info.process.killed) {
                  info.process.kill("SIGKILL")
                }
              }, 5000)
            } catch (err) {
              log.error("Failed to kill LSP process", { key, error: err })
            }
            processPool.delete(key)
          }
        }
      }, 60000) // Check every minute

      for (const server of Object.values(LSPServer)) {
        servers[server.id] = server
      }
      const cfg = await Config.get()
      for (const [name, item] of Object.entries(cfg.lsp ?? {})) {
        const existing = servers[name]
        if (item.disabled) {
          log.info(`LSP server ${name} is disabled`)
          delete servers[name]
          continue
        }
        servers[name] = {
          ...existing,
          root: existing?.root ?? (async (_file, app) => app.path.root),
          extensions: item.extensions ?? existing.extensions,
          spawn: async (_app, root) => {
            const processKey = `${name}:${root}`

            // Check if we have an existing process for this server+root combination
            const existingProcess = processPool.get(processKey)
            if (existingProcess && !existingProcess.process.killed) {
              existingProcess.refCount++
              existingProcess.lastUsed = Date.now()
              log.info(`Reusing existing LSP process ${name}`, {
                pid: existingProcess.process.pid,
                refCount: existingProcess.refCount,
              })
              return {
                process: existingProcess.process,
                initialization: item.initialization,
              }
            }

            // Check if we've hit the process limit for this server type
            const serverProcesses = Array.from(processPool.values()).filter((p) => p.serverID === name)
            if (serverProcesses.length >= maxProcessesPerServer) {
              // Find the least recently used process and reuse it
              const lruProcess = serverProcesses.sort((a, b) => a.lastUsed - b.lastUsed)[0]
              if (lruProcess) {
                const lruKey = Array.from(processPool.entries()).find(([, info]) => info === lruProcess)?.[0]
                if (lruKey) {
                  processPool.delete(lruKey)
                  log.info(`Killing LRU LSP process ${name} due to limit`, {
                    pid: lruProcess.process.pid,
                    maxProcesses: maxProcessesPerServer,
                  })
                  try {
                    lruProcess.process.kill("SIGTERM")
                  } catch (err) {
                    log.error("Failed to kill LRU LSP process", { error: err })
                  }
                }
              }
            }

            // Spawn new process
            log.info(`Spawning new LSP process ${name}`, { root, command: item.command })
            const process = spawn(item.command[0], item.command.slice(1), {
              cwd: root,
              env: {
                ...process.env,
                ...item.env,
              },
            })

            // Handle process errors and cleanup
            process.on("error", (err) => {
              log.error(`LSP process ${name} error`, { pid: process.pid, error: err })
              processPool.delete(processKey)
            })

            process.on("exit", (code, signal) => {
              log.info(`LSP process ${name} exited`, {
                pid: process.pid,
                code,
                signal,
                root,
              })
              processPool.delete(processKey)
            })

            // Add to process pool
            processPool.set(processKey, {
              process,
              createdAt: Date.now(),
              lastUsed: Date.now(),
              refCount: 1,
              serverID: name,
              root,
            })

            return {
              process,
              initialization: item.initialization,
            }
          },
        }
      }

      log.info("enabled LSP servers", {
        serverIds: Object.values(servers)
          .map((server) => server.id)
          .join(", "),
      })

      return {
        broken: new Set<string>(),
        servers,
        clients,
        processPool,
        cleanupInterval,
      }
    },
    async (state) => {
      // Cleanup on shutdown
      if (state.cleanupInterval) {
        clearInterval(state.cleanupInterval)
      }

      // Shutdown all clients
      for (const client of state.clients) {
        await client.shutdown()
      }

      // Kill all processes in the pool
      for (const [key, info] of state.processPool.entries()) {
        log.info(`Killing LSP process ${info.serverID} on shutdown`, {
          key,
          pid: info.process.pid,
        })
        try {
          info.process.kill("SIGTERM")
          setTimeout(() => {
            if (!info.process.killed) {
              info.process.kill("SIGKILL")
            }
          }, 2000)
        } catch (err) {
          log.error("Failed to kill LSP process on shutdown", { key, error: err })
        }
      }
      state.processPool.clear()
    },
  )

  export async function init() {
    return state()
  }

  async function getClients(file: string) {
    const s = await state()
    const extension = path.parse(file).ext
    const result: LSPClient.Info[] = []

    for (const server of Object.values(s.servers)) {
      if (server.extensions.length && !server.extensions.includes(extension)) continue
      const root = await server.root(file, App.info())
      if (!root) continue
      if (s.broken.has(root + server.id)) continue

      const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (match) {
        result.push(match)
        continue
      }

      const handle = await server.spawn(App.info(), root).catch((err) => {
        s.broken.add(root + server.id)
        log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
        return undefined
      })
      if (!handle) continue

      const client = await LSPClient.create({
        serverID: server.id,
        server: handle,
        root,
        onShutdown: () => {
          // Decrease reference count when client shuts down
          const processKey = `${server.id}:${root}`
          const processInfo = s.processPool.get(processKey)
          if (processInfo) {
            processInfo.refCount = Math.max(0, processInfo.refCount - 1)
            processInfo.lastUsed = Date.now()
          }
        },
      }).catch((err) => {
        s.broken.add(root + server.id)
        handle.process.kill()
        log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
      })
      if (!client) continue
      s.clients.push(client)
      result.push(client)
    }
    return result
  }

  export async function touchFile(input: string, waitForDiagnostics?: boolean) {
    const clients = await getClients(input)
    await run(async (client) => {
      if (!clients.includes(client)) return
      const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
      await client.notify.open({ path: input })
      return wait
    })
  }

  export async function diagnostics() {
    const results: Record<string, LSPClient.Diagnostic[]> = {}
    for (const result of await run(async (client) => client.diagnostics)) {
      for (const [path, diagnostics] of result.entries()) {
        const arr = results[path] || []
        arr.push(...diagnostics)
        results[path] = arr
      }
    }
    return results
  }

  export async function hover(input: { file: string; line: number; character: number }) {
    return run((client) => {
      return client.connection.sendRequest("textDocument/hover", {
        textDocument: {
          uri: `file://${input.file}`,
        },
        position: {
          line: input.line,
          character: input.character,
        },
      })
    })
  }

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

  export async function workspaceSymbol(query: string) {
    return run((client) =>
      client.connection
        .sendRequest("workspace/symbol", {
          query,
        })
        .then((result: any) => result.filter((x: LSP.Symbol) => kinds.includes(x.kind)))
        .then((result: any) => result.slice(0, 10))
        .catch(() => []),
    ).then((result) => result.flat() as LSP.Symbol[])
  }

  export async function documentSymbol(uri: string) {
    return run((client) =>
      client.connection
        .sendRequest("textDocument/documentSymbol", {
          textDocument: {
            uri,
          },
        })
        .catch(() => []),
    )
      .then((result) => result.flat() as (LSP.DocumentSymbol | LSP.Symbol)[])
      .then((result) => result.filter(Boolean))
  }

  async function run<T>(input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await state().then((x) => x.clients)
    const tasks = clients.map((x) => input(x))
    return Promise.all(tasks)
  }

  export namespace Diagnostic {
    export function pretty(diagnostic: LSPClient.Diagnostic) {
      const severityMap = {
        1: "ERROR",
        2: "WARN",
        3: "INFO",
        4: "HINT",
      }

      const severity = severityMap[diagnostic.severity || 1]
      const line = diagnostic.range.start.line + 1
      const col = diagnostic.range.start.character + 1

      return `${severity} [${line}:${col}] ${diagnostic.message}`
    }
  }

  // Utility functions for monitoring and debugging
  export async function getProcessStats() {
    const s = await state()
    const stats = {
      totalProcesses: s.processPool.size,
      processByServer: {} as Record<string, number>,
      clients: s.clients.length,
      brokenServers: s.broken.size,
    }

    for (const info of s.processPool.values()) {
      stats.processByServer[info.serverID] = (stats.processByServer[info.serverID] || 0) + 1
    }

    return stats
  }

  export async function killAllProcesses() {
    const s = await state()
    log.info("Manually killing all LSP processes")

    for (const [key, info] of s.processPool.entries()) {
      try {
        info.process.kill("SIGTERM")
        setTimeout(() => {
          if (!info.process.killed) {
            info.process.kill("SIGKILL")
          }
        }, 2000)
      } catch (err) {
        log.error("Failed to kill LSP process", { key, error: err })
      }
    }

    s.processPool.clear()
    s.broken.clear()

    // Clear clients
    for (const client of s.clients) {
      await client.shutdown()
    }
    s.clients.length = 0
  }
}
