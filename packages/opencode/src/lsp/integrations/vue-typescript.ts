import path from "path"
import { LSPClient } from "@/lsp/client"
import { Log } from "@/util/log"
import { Global } from "@/global"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "lsp.vue.bridge" })
const vueClientsBridged = new Set<string>()

export const setupVueTypeScriptBridge = (
  allClients: LSPClient.Info[],
  currentClients: LSPClient.Info[],
  fileExtension: string,
) => {
  if (fileExtension !== ".vue") return

  const vueClient = currentClients.find((client) => client.serverID === "vue")
  if (!vueClient) return

  const tsClient = allClients.find((client) => client.serverID === "typescript" && client.root === vueClient.root)
  if (!tsClient) return

  if (vueClientsBridged.has(vueClient.root)) return
  vueClientsBridged.add(vueClient.root)

  log.info("wiring vue-typescript bridge", { root: path.relative(process.cwd(), vueClient.root) })

  vueClient.connection.onNotification("tsserver/request", async ([id, command, payload]: [number, string, unknown]) => {
    try {
      log.info("tsserver/request", { id, command })
      const result = await tsClient.connection.sendRequest("workspace/executeCommand", {
        command: "typescript.tsserverRequest",
        arguments: [command, payload],
      })
      const body = typeof result === "object" && result !== null && "body" in result ? result.body : result
      await vueClient.connection.sendNotification("tsserver/response", [id, body])
    } catch (error) {
      log.error("tsserver/request bridge error", { id, command, error })
      await vueClient.connection.sendNotification("tsserver/response", [id, { error: error?.toString() }])
    }
  })
}

export const extendTypeScriptInitializationWithVueIntegration = async (initialization: Record<string, any>) => {
  const workspacePluginPkg = await Bun.resolve("@vue/language-server/package.json", Instance.directory).catch(
    () => undefined,
  )
  const globalPluginPkg = await Bun.resolve("@vue/language-server/package.json", Global.Path.bin).catch(() => undefined)
  const pluginPkg = workspacePluginPkg ?? globalPluginPkg

  if (!pluginPkg) {
    return initialization
  }

  return {
    ...initialization,
    plugins: [
      ...(initialization?.plugins ?? []),
      {
        name: "@vue/typescript-plugin",
        location: path.dirname(pluginPkg),
        languages: ["vue"],
      },
    ],
  }
}
