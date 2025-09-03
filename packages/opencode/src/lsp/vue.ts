import { LSPClient } from "./client"
import { LSPServer } from "./server"
import { Log } from "../util/log"
import path from "path"
import { Global } from "../global"

const log = Log.create({ service: "lsp.vue" })

// Cache Vue project detection to avoid repeated file system scans
const vueProjectCache = new Map<string, boolean>()

export namespace VueIntegration {
  /**
   * Detects if a project contains Vue files (with caching)
   */
  export async function hasVueFiles(root: string): Promise<boolean> {
    // Check cache first
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

      // Cache the result
      vueProjectCache.set(root, hasVue)
      return hasVue
    } catch {
      vueProjectCache.set(root, false)
      return false
    }
  }

  /**
   * Gets the path to the Vue language server if available
   */
  export async function getVueLanguageServerPath(): Promise<string | undefined> {
    try {
      const vueLsPath = path.join(Global.Path.bin, "node_modules", "@vue", "language-server", "package.json")
      if (await Bun.file(vueLsPath).exists()) {
        return path.dirname(vueLsPath)
      }
    } catch {}
    return undefined
  }

  /**
   * Sets up Vue TypeScript integration by creating and bridging TypeScript and Vue language servers
   */
  export async function setupVueTypeScriptBridge(
    allClients: LSPClient.Info[],
    currentClients: LSPClient.Info[],
    getState: () => Promise<{ broken: Set<string>, clients: LSPClient.Info[] }>
  ): Promise<void> {
    const vueClient = currentClients.find(c => c.serverID === "vue")
    if (!vueClient) return

    // Find or create TypeScript client for the same root
    let tsClient = allClients.find(c => c.serverID === "typescript" && c.root === vueClient.root)

    if (!tsClient) {
      // Try to create TypeScript client for Vue integration
      const tsServer = LSPServer.Typescript
      const root = vueClient.root
      const s = await getState()
      if (!s.broken.has(root + tsServer.id)) {
        const handle = await tsServer.spawn(root)
        if (handle) {
          tsClient = await LSPClient.create({
            serverID: "typescript",
            server: handle,
            root,
          }).catch(async (err) => {
            (await getState()).broken.add(root + tsServer.id)
            handle.process.kill()
            log.error("Failed to create TypeScript client for Vue integration", { error: err })
            return undefined
          })
          if (tsClient) {
            const s = await getState()
            s.clients.push(tsClient)
            currentClients.push(tsClient)
          }
        }
      }
    }

    if (tsClient) {
      setupTsServerBridge(vueClient, tsClient)
    }
  }

  /**
   * Sets up the bridge between Vue language server and TypeScript language server
   */
  function setupTsServerBridge(vueClient: LSPClient.Info, tsClient: LSPClient.Info) {
    log.info("Setting up Vue/TypeScript tsserver bridge", {
      vueRoot: vueClient.root,
      tsRoot: tsClient.root
    })

    // Bridge tsserver requests from Vue LS to TypeScript LS
    vueClient.connection.onNotification(
      "tsserver/request",
      async ([id, command, payload]: [number, string, unknown]) => {
        try {
          log.info("Bridging tsserver request", { id, command })
          const result = await tsClient.connection.sendRequest("workspace/executeCommand", {
            command: "typescript.tsserverRequest",
            arguments: [command, payload]
          } as never)
          const body = (result as any)?.body ?? result
          vueClient.connection.sendNotification("tsserver/response", [id, body])
        } catch (error) {
          log.error("Error bridging tsserver request", { id, command, error })
          // Send error response back to Vue LS
          vueClient.connection.sendNotification("tsserver/response", [id, { error: error?.toString() }])
        }
      }
    )
  }

  /**
   * Creates TypeScript server configuration with Vue integration enabled
   * This should only be called when Vue files are confirmed to exist in the project
   */
  export async function createVueEnabledTypeScriptConfig(root: string): Promise<Record<string, any>> {
    const tsserver = await Bun.resolve("typescript/lib/tsserver.js", process.cwd()).catch(() => undefined)

    // Start with standard TypeScript configuration
    const initialization: Record<string, any> = {
      tsserver: {
        path: tsserver,
      },
    }

    // Add Vue TypeScript plugin integration
    const vueLsPath = await getVueLanguageServerPath()
    if (vueLsPath) {
      log.info("Enabling Vue TypeScript plugin integration", { root, vueLsPath })
      initialization["plugins"] = [{
        name: "@vue/typescript-plugin",
        location: path.dirname(vueLsPath),
        languages: ["vue"]
      }]
    } else {
      log.warn("Vue language server not found - Vue features will be limited", { root })
    }

    return initialization
  }
}
