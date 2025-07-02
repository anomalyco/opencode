import { App } from "../app/app"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "path"
import { LSPServer } from "./server"
import { Ripgrep } from "../file/ripgrep"
import { z } from "zod"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: z.object({
          start: z.object({
            line: z.number(),
            character: z.number(),
          }),
          end: z.object({
            line: z.number(),
            character: z.number(),
          }),
        }),
      }),
    })
    .openapi({
      ref: "LSP.Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  const state = App.state(
    "lsp",
    async (app) => {
      log.info("initializing")
      const clients = new Map<string, LSPClient.Info>()
      for (const server of Object.values(LSPServer)) {
        for (const extension of server.extensions) {
          const [file] = await Ripgrep.files({
            cwd: app.path.cwd,
            glob: "*" + extension,
          })
          if (!file) continue
          const handle = await server.spawn(App.info())
          if (!handle) break
          const client = await LSPClient.create(server.id, handle).catch(
            () => {},
          )
          if (!client) break
          clients.set(server.id, client)
          break
        }
      }
      log.info("initialized")
      return {
        clients,
      }
    },
    async (state) => {
      for (const client of state.clients.values()) {
        await client.shutdown()
      }
    },
  )

  export async function init() {
    return state()
  }

  export async function touchFile(input: string, waitForDiagnostics?: boolean) {
    const extension = path.parse(input).ext
    const matches = Object.values(LSPServer)
      .filter((x) => x.extensions.includes(extension))
      .map((x) => x.id)
    await run(async (client) => {
      if (!matches.includes(client.serverID)) return
      const wait = waitForDiagnostics
        ? client.waitForDiagnostics({ path: input })
        : Promise.resolve()
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

  export async function hover(input: {
    file: string
    line: number
    character: number
  }) {
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

  export async function workspaceSymbol(query: string) {
    return run((client) =>
      client.connection.sendRequest("workspace/symbol", {
        query,
      }),
    ).then((result) => result.flat() as LSP.Symbol[])
  }

  async function run<T>(
    input: (client: LSPClient.Info) => Promise<T>,
  ): Promise<T[]> {
    const clients = await state().then((x) => [...x.clients.values()])
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
}
