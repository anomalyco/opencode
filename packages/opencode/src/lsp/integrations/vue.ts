import path from "path"
import { Global } from "@/global"
import { LSPClient } from "@/lsp/client"
import { LSPServer } from "@/lsp/server"
import { Log } from "@/util/log"

const log = Log.create({ service: "lsp.vue" })

const vueProjectCache = new Map<string, boolean>()

export namespace VueIntegration {
  export const hasVueFiles = async (root: string) => {
    if (vueProjectCache.has(root)) {
      return vueProjectCache.get(root)!
    }

    try {
      const proc = Bun.spawn(["find", root, "-name", "*.vue", "-type", "f", "-print", "-quit"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const result = await new Response(proc.stdout).text()
      const hasVue = result.trim().length > 0

      vueProjectCache.set(root, hasVue)
      return hasVue
    } catch {
      vueProjectCache.set(root, false)
      return false
    }
  }

  export const setupVueTypeScriptBridge = async (
    allClients: LSPClient.Info[],
    currentClients: LSPClient.Info[],
    getState: () => Promise<{ broken: Set<string>; clients: LSPClient.Info[] }>,
  ) => {
    const vueClient = currentClients.find((client) => client.serverID === "vue")
    if (!vueClient) return

    let tsClient = allClients.find((client) => client.serverID === "typescript" && client.root === vueClient.root)

    if (!tsClient) {
      const tsServer = LSPServer.Typescript
      const root = vueClient.root
      const state = await getState()
      if (!state.broken.has(root + tsServer.id)) {
        const handle = await tsServer.spawn(root)
        if (handle) {
          tsClient = await LSPClient.create({
            serverID: "typescript",
            server: handle,
            root,
          }).catch(async (err) => {
            ;(await getState()).broken.add(root + tsServer.id)
            handle.process.kill()
            log.error("Failed to create TypeScript client for Vue integration", { error: err })
            return undefined
          })
          if (tsClient) {
            const state = await getState()
            state.clients.push(tsClient)
            currentClients.push(tsClient)
          }
        }
      }
    }

    if (tsClient) {
      setupTsServerBridge(vueClient, tsClient)
    }
  }

  export const createVueEnabledTypeScriptConfig = async (root: string): Promise<Record<string, any>> => {
    const tsserver = await Bun.resolve("typescript/lib/tsserver.js", process.cwd()).catch(() => undefined)

    const initialization: Record<string, any> = {
      tsserver: {
        path: tsserver,
      },
    }

    const vueLsPath = await getVueLanguageServerPath()
    if (vueLsPath) {
      log.info("Enabling Vue TypeScript plugin integration", { root, vueLsPath })
      initialization["plugins"] = [
        {
          name: "@vue/typescript-plugin",
          location: path.dirname(vueLsPath),
          languages: ["vue"],
        },
      ]
    } else {
      log.warn("Vue language server not found - Vue features will be limited", { root })
    }

    return initialization
  }

  const setupTsServerBridge = (vueClient: LSPClient.Info, tsClient: LSPClient.Info) => {
    log.info("Setting up Vue/TypeScript tsserver bridge", {
      vueRoot: vueClient.root,
      tsRoot: tsClient.root,
    })

    vueClient.connection.onNotification(
      "tsserver/request",
      async ([id, command, payload]: [number, string, unknown]) => {
        try {
          log.info("Bridging tsserver request", { id, command })
          const result = await tsClient.connection.sendRequest("workspace/executeCommand", {
            command: "typescript.tsserverRequest",
            arguments: [command, payload],
          })
          const body = typeof result === "object" && result !== null && "body" in result ? result.body : result
          vueClient.connection.sendNotification("tsserver/response", [id, body])
        } catch (error) {
          log.error("Error bridging tsserver request", { id, command, error })
          vueClient.connection.sendNotification("tsserver/response", [id, { error: error?.toString() }])
        }
      },
    )
  }

  const getVueLanguageServerPath = async () => {
    try {
      const vueLsPath = path.join(Global.Path.bin, "node_modules", "@vue", "language-server", "package.json")
      if (await Bun.file(vueLsPath).exists()) {
        return path.dirname(vueLsPath)
      }
    } catch {}
    return undefined
  }
}
