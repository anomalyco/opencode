import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { Log } from "../util/log"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "@opencode-ai/util/error"
import { withTimeout } from "../util/timeout"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import fs from "fs"

const DIAGNOSTICS_DEBOUNCE_MS = 150

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = VSCodeDiagnostic

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  export const Event = {
    Diagnostics: BusEvent.define(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
  }

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: string }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    const DEBUG_LOG = "/tmp/lsp-debug.log"
    const debugLog = (direction: string, data: unknown) => {
      const ts = new Date().toISOString()
      const line = `[${ts}] [${input.serverID}] ${direction} ${JSON.stringify(data)}\n`
      fs.appendFileSync(DEBUG_LOG, line)
    }

    const reader = new StreamMessageReader(input.server.process.stdout as any)
    const writer = new StreamMessageWriter(input.server.process.stdin as any)

    const connection = createMessageConnection(reader, writer)

    // Intercept outgoing traffic (client -> server)
    const originalSendRequest = connection.sendRequest.bind(connection)
    connection.sendRequest = ((...args: any[]) => {
      debugLog("CLIENT -> SERVER [request]", { method: args[0], params: args[1] })
      const result = originalSendRequest(...args)
      if (result && typeof result.then === "function") {
        result.then(
          (res: unknown) => debugLog("CLIENT <- SERVER [response]", { method: args[0], result: res }),
          (err: unknown) => debugLog("CLIENT <- SERVER [error]", { method: args[0], error: String(err) }),
        )
      }
      return result
    }) as any

    const originalSendNotification = connection.sendNotification.bind(connection)
    connection.sendNotification = ((...args: any[]) => {
      debugLog("CLIENT -> SERVER [notification]", { method: args[0], params: args[1] })
      return originalSendNotification(...args)
    }) as any

    // Intercept incoming traffic (server -> client) via onNotification/onRequest wrappers
    const originalOnNotification = connection.onNotification.bind(connection)
    connection.onNotification = ((method: any, handler: any) => {
      if (typeof method === "string" && handler) {
        return originalOnNotification(method, (...args: any[]) => {
          debugLog("SERVER -> CLIENT [notification]", { method, params: args[0] })
          return handler(...args)
        })
      }
      // Catch-all / generic notification handler
      return originalOnNotification(method, handler)
    }) as any

    const originalOnRequest = connection.onRequest.bind(connection)
    connection.onRequest = ((method: any, handler: any) => {
      if (typeof method === "string" && handler) {
        return originalOnRequest(method, async (...args: any[]) => {
          debugLog("SERVER -> CLIENT [request]", { method, params: args[0] })
          const result = await handler(...args)
          debugLog("CLIENT -> SERVER [response to server request]", { method, result })
          return result
        })
      }
      return originalOnRequest(method, handler)
    }) as any

    const diagnostics = new Map<string, Diagnostic[]>()

    // Track when the server's initial workspace/configuration request has been served,
    // so we don't send didChangeConfiguration before the server has its initial config.
    let configurationResolved: () => void
    const configurationReady = new Promise<void>((resolve) => {
      configurationResolved = resolve
    })

    // Track when the server has finished its post-config reload cycle.
    // Servers like Biome do: workspace/configuration → unregister → register capabilities.
    // Documents opened before this cycle completes get linted with stale/default settings.
    let serverReadyResolved: () => void
    const serverReady = new Promise<void>((resolve) => {
      serverReadyResolved = resolve
    })

    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const filePath = Filesystem.normalizePath(fileURLToPath(params.uri))
      l.info("textDocument/publishDiagnostics", {
        path: filePath,
        count: params.diagnostics.length,
      })
      const exists = diagnostics.has(filePath)
      diagnostics.set(filePath, params.diagnostics)
      if (!exists && input.serverID === "typescript") return
      Bus.publish(Event.Diagnostics, { path: filePath, serverID: input.serverID })
    })
    connection.onRequest("window/workDoneProgress/create", (params) => {
      l.info("window/workDoneProgress/create", params)
      return null
    })
    let configurationServed = false
    connection.onRequest("workspace/configuration", async () => {
      configurationServed = true
      configurationResolved()
      return [input.server.settings ?? input.server.initialization ?? {}]
    })
    connection.onRequest("client/registerCapability", async () => {
      serverReadyResolved()
    })
    connection.onRequest("client/unregisterCapability", async () => {})
    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: pathToFileURL(input.root).href,
      },
    ])
    connection.listen()

    l.info("sending initialize")
    await withTimeout(
      connection.sendRequest("initialize", {
        rootUri: pathToFileURL(input.root).href,
        processId: input.server.process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: pathToFileURL(input.root).href,
          },
        ],
        initializationOptions: {
          ...input.server.initialization,
        },
        capabilities: {
          window: {
            workDoneProgress: true,
          },
          workspace: {
            configuration: true,
            didChangeWatchedFiles: {
              dynamicRegistration: true,
            },
          },
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
        },
      }),
      45_000,
    ).catch((err) => {
      l.error("initialize error", { error: err })
      throw new InitializeError(
        { serverID: input.serverID },
        {
          cause: err,
        },
      )
    })

    await connection.sendNotification("initialized", {})

    if (input.server.initialization || input.server.settings) {
      // Wait for the server's initial workspace/configuration request to be handled
      // before sending didChangeConfiguration. Some servers (e.g. Biome) ask for config
      // right after initialized, and sending didChangeConfiguration before that response
      // is processed can cause the config to be overwritten or ignored.
      await Promise.race([configurationReady, new Promise<void>((r) => setTimeout(r, 2000))])
      // Yield to let the config response flush to the server before sending didChangeConfiguration
      await new Promise<void>((r) => setTimeout(r, 50))
      if (!configurationServed) {
        await connection.sendNotification("workspace/didChangeConfiguration", {
          settings: input.server.initialization,
        })
        // Server got config via didChangeConfiguration, not workspace/configuration —
        // it won't do a register cycle, so unblock serverReady
        serverReadyResolved()
      }
    } else {
      // No config to negotiate — server is ready immediately
      serverReadyResolved()
    }

    const files: {
      [path: string]: number
    } = {}

    const result = {
      root: input.root,
      get serverID() {
        return input.serverID
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: string }) {
          // Wait for the server to finish its initial config handshake and any
          // subsequent reload cycle (e.g. Biome's unregister/register after
          // reading workspace/configuration). Without this, documents opened
          // during the reload get linted with default settings.
          await Promise.race([serverReady, new Promise<void>((r) => setTimeout(r, 3000))])
          
          input.path = path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path)
          const text = await Filesystem.readText(input.path)
          const extension = path.extname(input.path)
          const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"

          const version = files[input.path]
          if (version !== undefined) {
            log.info("workspace/didChangeWatchedFiles", input)
            await connection.sendNotification("workspace/didChangeWatchedFiles", {
              changes: [
                {
                  uri: pathToFileURL(input.path).href,
                  type: 2, // Changed
                },
              ],
            })

            const next = version + 1
            files[input.path] = next
            log.info("textDocument/didChange", {
              path: input.path,
              version: next,
            })
            await connection.sendNotification("textDocument/didChange", {
              textDocument: {
                uri: pathToFileURL(input.path).href,
                version: next,
              },
              contentChanges: [{ text }],
            })
            return
          }

          log.info("workspace/didChangeWatchedFiles", input)
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: pathToFileURL(input.path).href,
                type: 1, // Created
              },
            ],
          })

          log.info("textDocument/didOpen", input)
          diagnostics.delete(input.path)
          await connection.sendNotification("textDocument/didOpen", {
            textDocument: {
              uri: pathToFileURL(input.path).href,
              languageId,
              version: 0,
              text,
            },
          })
          files[input.path] = 0
          return
        },
      },
      get diagnostics() {
        return diagnostics
      },
      async waitForDiagnostics(input: { path: string }) {
        const normalizedPath = Filesystem.normalizePath(
          path.isAbsolute(input.path) ? input.path : path.resolve(Instance.directory, input.path),
        )
        log.info("waiting for diagnostics", { path: normalizedPath })
        let unsub: () => void
        let debounceTimer: ReturnType<typeof setTimeout> | undefined
        return await withTimeout(
          new Promise<void>((resolve) => {
            unsub = Bus.subscribe(Event.Diagnostics, (event) => {
              if (event.properties.path === normalizedPath && event.properties.serverID === result.serverID) {
                // Debounce to allow LSP to send follow-up diagnostics (e.g., semantic after syntax)
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                  log.info("got diagnostics", { path: normalizedPath })
                  unsub?.()
                  resolve()
                }, DIAGNOSTICS_DEBOUNCE_MS)
              }
            })
          }),
          3000,
        )
          .catch(() => {})
          .finally(() => {
            if (debounceTimer) clearTimeout(debounceTimer)
            unsub?.()
          })
      },
      async shutdown() {
        l.info("shutting down")
        connection.end()
        connection.dispose()
        input.server.process.kill()
        l.info("shutdown")
      },
    }

    l.info("initialized")

    return result
  }
}