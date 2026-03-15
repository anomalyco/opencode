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

  const MAX_SERVER_MESSAGES = 50

  export const Event = {
    Diagnostics: BusEvent.define(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
    Message: BusEvent.define(
      "lsp.client.message",
      z.object({
        serverID: z.string(),
        type: z.number(),
        message: z.string(),
      }),
    ),
  }

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: string }) {
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout as any),
      new StreamMessageWriter(input.server.process.stdin as any),
    )

    const diagnostics = new Map<string, Diagnostic[]>()

    // Track when the server's initial workspace/configuration request has been served,
    // so we don't send didChangeConfiguration before the server has its initial config.
    let configurationResolved: () => void = () => {}
    const configurationReady = new Promise<void>((resolve) => {
      configurationResolved = resolve
    })

    // Track when the server has finished its post-config reload cycle.
    // Servers like Biome do: workspace/configuration → unregister → register capabilities.
    // Documents opened before this cycle completes get linted with stale/default settings.
    let serverReadyResolved: () => void = () => {}
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
      const settings = input.server.settings ?? input.server.initialization ?? {}
      l.debug("workspace/configuration", { settings })
      return [settings]
    })
    connection.onRequest("client/registerCapability", async (params) => {
      l.debug("client/registerCapability", params)
      serverReadyResolved()
    })
    connection.onRequest("client/unregisterCapability", async (params) => {
      l.debug("client/unregisterCapability", params)
    })

    const serverMessages: Array<{ type: number; message: string }> = []
    const seen = new Set<string>()
    const logLevels = { 1: "error", 2: "warn", 3: "info", 4: "debug" } as const
    function handleServerMessage(method: string, params: { type: number; message: string }) {
      const level = logLevels[params.type as keyof typeof logLevels] ?? "info"
      l[level](method, { messageType: params.type, message: params.message })
      // Store errors, warnings, and info (type <= 3) for status exposure
      if (params.type <= 3 && !seen.has(params.message)) {
        seen.add(params.message)
        serverMessages.push({ type: params.type, message: params.message })
        if (serverMessages.length > MAX_SERVER_MESSAGES) serverMessages.shift()
        Bus.publish(Event.Message, { serverID: input.serverID, type: params.type, message: params.message })
      }
    }
    for (const msgType of ["window/logMessage", "window/showMessage"]) {
      connection.onNotification(msgType, (params: { type: number; message: string }) => {
        handleServerMessage(msgType, params)
      })
    }

    connection.onRequest("workspace/workspaceFolders", async () => {
      l.debug("workspace/workspaceFolders")
      return [
        {
          name: "workspace",
          uri: pathToFileURL(input.root).href,
        },
      ]
    })
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
      get messages() {
        return serverMessages
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
