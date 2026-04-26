import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { Log } from "../util"
import { Process } from "../util"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type * as LSPServer from "./server"
import { NamedError } from "@opencode-ai/shared/util/error"
import { withTimeout } from "../util/timeout"
import { Filesystem } from "../util"

const DIAGNOSTICS_DEBOUNCE_MS = 150

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

export async function create(input: { serverID: string; server: LSPServer.Handle; root: string; directory: string }) {
  const l = log.clone().tag("serverID", input.serverID)
  l.info("starting client")

  const connection = createMessageConnection(
    new StreamMessageReader(input.server.process.stdout as any),
    new StreamMessageWriter(input.server.process.stdin as any),
  )

  const diagnostics = new Map<string, Diagnostic[]>()
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
  connection.onRequest("workspace/configuration", async () => {
    // Return server initialization options
    return [input.server.initialization ?? {}]
  })
  connection.onRequest("client/registerCapability", async () => {})
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

  if (input.server.initialization) {
    await connection.sendNotification("workspace/didChangeConfiguration", {
      settings: input.server.initialization,
    })
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
      async open(request: { path: string }) {
        request.path = path.isAbsolute(request.path) ? request.path : path.resolve(input.directory, request.path)
        const text = await Filesystem.readText(request.path)
        const extension = path.extname(request.path)
        const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"

        const version = files[request.path]
        if (version !== undefined) {
          log.info("workspace/didChangeWatchedFiles", request)
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: pathToFileURL(request.path).href,
                type: 2, // Changed
              },
            ],
          })

          const next = version + 1
          files[request.path] = next
          log.info("textDocument/didChange", {
            path: request.path,
            version: next,
          })
          await connection.sendNotification("textDocument/didChange", {
            textDocument: {
              uri: pathToFileURL(request.path).href,
              version: next,
            },
            contentChanges: [{ text }],
          })
          return
        }

        log.info("workspace/didChangeWatchedFiles", request)
        await connection.sendNotification("workspace/didChangeWatchedFiles", {
          changes: [
            {
              uri: pathToFileURL(request.path).href,
              type: 1, // Created
            },
          ],
        })

        log.info("textDocument/didOpen", request)
        diagnostics.delete(request.path)
        await connection.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: pathToFileURL(request.path).href,
            languageId,
            version: 0,
            text,
          },
        })
        files[request.path] = 0
        return
      },
    },
    get diagnostics() {
      return diagnostics
    },
    async waitForDiagnostics(request: { path: string }) {
      const normalizedPath = Filesystem.normalizePath(
        path.isAbsolute(request.path) ? request.path : path.resolve(input.directory, request.path),
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
      await Process.stop(input.server.process)
      l.info("shutdown")
    },
  }

  l.info("initialized")

  return result
}
