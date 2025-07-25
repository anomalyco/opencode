import path from "path"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import { App } from "../app/app"
import { Log } from "../util/log"
import { LANGUAGE_EXTENSIONS } from "./language"
import z from "zod"
import type { LSPServer } from "./server"
import { NamedError } from "../util/error"
import { TimeoutManager } from "./timeout-manager"
import { DiagnosticsManager } from "./diagnostics-manager"

export namespace LSPClient {
  const log = Log.create({ service: "lsp.client" })

  export type Info = NonNullable<Awaited<ReturnType<typeof create>>>

  export type Diagnostic = DiagnosticsManager.Diagnostic

  export const InitializeError = NamedError.create(
    "LSPInitializeError",
    z.object({
      serverID: z.string(),
    }),
  )

  export async function create(input: { serverID: string; server: LSPServer.Handle; root: string }) {
    const app = App.info()
    const l = log.clone().tag("serverID", input.serverID)
    l.info("starting client")

    const connection = createMessageConnection(
      new StreamMessageReader(input.server.process.stdout),
      new StreamMessageWriter(input.server.process.stdin),
    )

    const timeoutManager = new TimeoutManager.AdaptiveTimeout(TimeoutManager.DEFAULT_CONFIGS)
    const diagnosticsManager = new DiagnosticsManager.Manager(input.serverID, {
      suppressInitialEvents: true
    })

    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      diagnosticsManager.onDiagnosticsUpdate(params)
    })
    connection.onRequest("window/workDoneProgress/create", (params) => {
      l.info("window/workDoneProgress/create", params)
      return null
    })
    connection.onRequest("workspace/configuration", async () => {
      return [{}]
    })
    connection.listen()

    l.info("sending initialize")
    
    await timeoutManager.withTimeout(
      'initialize',
      connection.sendRequest("initialize", {
        rootUri: "file://" + input.root,
        processId: input.server.process.pid,
        workspaceFolders: [
          {
            name: "workspace",
            uri: "file://" + input.root,
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
          input.path = path.isAbsolute(input.path) ? input.path : path.resolve(app.path.cwd, input.path)
          const file = Bun.file(input.path)
          const text = await file.text()
          const version = files[input.path]
          if (version !== undefined) {
            diagnosticsManager.delete(input.path)
            await connection.sendNotification("textDocument/didClose", {
              textDocument: {
                uri: `file://` + input.path,
              },
            })
          }
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
        },
      },
      get diagnostics() {
        return diagnosticsManager
      },
      async waitForDiagnostics(input: { path: string }) {
        input.path = path.isAbsolute(input.path) ? input.path : path.resolve(app.path.cwd, input.path)
        log.info("waiting for diagnostics", input)
        
        const timeout = timeoutManager.getTimeout('diagnostics')
        return await diagnosticsManager.waitForDiagnostics(input.path, timeout)
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
