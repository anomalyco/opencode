import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import fs from "node:fs/promises"
import path from "node:path"

async function loadConfig(): Promise<any> {
  const configPath = path.join(process.cwd(), ".opencode.json")
  try {
    const content = await fs.readFile(configPath, "utf-8")
    return JSON.parse(content)
  } catch {
    try {
      // Fallback for older configs
      const oldPath = path.join(process.cwd(), ".opencode/opencode.json")
      const content = await fs.readFile(oldPath, "utf-8")
      return JSON.parse(content)
    } catch {
      return {}
    }
  }
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // Set API URL for IM integration to use the correct port
    process.env.OPENCODE_API_URL = `http://${server.hostname === "0.0.0.0" ? "127.0.0.1" : server.hostname}:${server.port}`

    // Wait for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const config = await loadConfig()
    const imEnabled = config.im?.enabled ?? true

    let imManager: any = null

    if (imEnabled && config.im?.type && config.im?.type !== "disabled") {
      try {
        const imPath = process.env.OPENCODE_IM_PATH || "@opencode-ai/im-integration/manager"
        console.log("📱 Loading IM integration from:", imPath)

        const imManagerModule = await import(imPath)
        const { IMManager } = imManagerModule
        imManager = new IMManager()

        console.log("📱 Calling IMManager.initialize()...")
        await imManager.initialize()
        console.log("📱 Calling IMManager.start()...")
        await imManager.start()
        console.log("🚀 IM integration initialized")
      } catch (error) {
        console.warn("⚠️  IM integration failed to initialize:", (error as Error).message)
        console.log("   Continuing without IM support...")
      }
    } else {
      console.log("ℹ️  IM integration is disabled in config")
    }

    await new Promise(() => { })

    try {
      if (imManager) await imManager.stop()
    } catch { }

    await server.stop()
  },
})
