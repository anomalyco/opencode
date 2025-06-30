import path from "path"
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { App } from "../app/app"
import { Log } from "../util/log"
import { LANGUAGE_EXTENSIONS } from "./language"
import { Bus } from "../bus"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "../util/error"

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
    Diagnostics: Bus.event(
      "lsp.client.diagnostics",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
  }

  export async function create(serverID: string, server: LSPServer.Handle) {
    const app = App.info()
    log.info("starting client", { id: serverID })

    const connection = createMessageConnection(
      new StreamMessageReader(server.process.stdout),
      new StreamMessageWriter(server.process.stdin),
    )

    const diagnostics = new Map<string, Diagnostic[]>()
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const path = new URL(params.uri).pathname
      log.info("textDocument/publishDiagnostics", {
        path,
      })
      diagnostics.set(path, params.diagnostics)
      Bus.publish(Event.Diagnostics, { path, serverID })
    })
    connection.onRequest("workspace/configuration", async () => {
      return [{}]
    })
    connection.listen()

    log.info("sending initialize", { id: serverID })
    await Promise.race([
      connection.sendRequest("initialize", {
        processId: server.process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: "file://" + app.path.cwd,
          },
        ],
        initializationOptions: {
          ...server.initialization,
        },
        capabilities: {
          workspace: {
            configuration: true,
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
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new InitializeError({ serverID }))
        }, 5_000)
      }),
    ])
    await connection.sendNotification("initialized", {})
    log.info("initialized")

    const files: {
      [path: string]: number
    } = {}

    const result = {
      get serverID() {
        return serverID
      },
      get connection() {
        return connection
      },
      notify: {
        async open(input: { path: string }) {
          input.path = path.isAbsolute(input.path)
            ? input.path
            : path.resolve(app.path.cwd, input.path)
          const file = Bun.file(input.path)
          const text = await file.text()
          const version = files[input.path]
          if (version === undefined) {
            log.info("textDocument/didOpen", input)
            diagnostics.delete(input.path)
            const extension = path.extname(input.path)
            const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"
            await connection.sendNotification("textDocument/didOpen", {
              textDocument: {
                uri: `file://` + input.path,
                languageId,
                version: 0,
                text,
              },
            })
            files[input.path] = 0
            return
          }

          log.info("textDocument/didChange", input)
          diagnostics.delete(input.path)
          await connection.sendNotification("textDocument/didChange", {
            textDocument: {
              uri: `file://` + input.path,
              version: ++files[input.path],
            },
            contentChanges: [
              {
                text,
              },
            ],
          })
        },
      },
      get diagnostics() {
        return diagnostics
      },
      async waitForDiagnostics(input: { path: string }) {
        input.path = path.isAbsolute(input.path)
          ? input.path
          : path.resolve(app.path.cwd, input.path)
        log.info("waiting for diagnostics", input)
        let unsub: () => void
        let timeout: NodeJS.Timeout
        return await Promise.race([
          new Promise<void>(async (resolve) => {
            unsub = Bus.subscribe(Event.Diagnostics, (event) => {
              if (
                event.properties.path === input.path &&
                event.properties.serverID === result.serverID
              ) {
                log.info("got diagnostics", input)
                clearTimeout(timeout)
                unsub?.()
                resolve()
              }
            })
          }),
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
              log.info("timed out refreshing diagnostics", input)
              unsub?.()
              resolve()
            }, 5000)
          }),
        ])
      },
      async shutdown() {
        log.info("shutting down")
        connection.end()
        connection.dispose()
        server.process.kill("SIGTERM")
      },
    }

    return result
  }
}
