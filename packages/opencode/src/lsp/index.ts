import { App } from "../app/app"
import { Log } from "../util/log"
import { LSPClient } from "./client"
import path from "path"
import { LSPServer } from "./server"
import { Ripgrep } from "../file/ripgrep"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  const state = App.state(
    "lsp",
    async () => {
      log.info("initializing")
      const clients = new Map<string, LSPClient.Info>()
      const skip = new Set<string>()
      return {
        clients,
        skip,
      }
    },
    async (state) => {
      for (const client of state.clients.values()) {
        await client.shutdown()
      }
    },
  )

  export async function init() {
    log.info("init")
    const app = App.info()
    const result = Object.values(LSPServer).map(async (x) => {
      for (const extension of x.extensions) {
        const [file] = await Ripgrep.files({
          cwd: app.path.cwd,
          glob: "*" + extension,
        })
        if (!file) continue
        await LSP.touchFile(file, true)
        break
      }
    })
    return Promise.all(result)
  }

  export async function touchFile(input: string, waitForDiagnostics?: boolean) {
    const extension = path.parse(input).ext
    const s = await state()
    const matches = Object.values(LSPServer).filter((x) =>
      x.extensions.includes(extension),
    )
    for (const match of matches) {
      const existing = s.clients.get(match.id)
      if (existing) continue
      if (s.skip.has(match.id)) continue
      s.skip.add(match.id)
      const handle = await match.spawn(App.info())
      if (!handle) continue
      const client = await LSPClient.create(match.id, handle).catch(() => {})
      if (!client) {
        s.skip.add(match.id)
        continue
      }
      s.clients.set(match.id, client)
    }
    if (waitForDiagnostics) {
      await run(async (client) => {
        const wait = client.waitForDiagnostics({ path: input })
        await client.notify.open({ path: input })
        return wait
      })
    }
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
    )
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
