import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { EOL } from "os"
import { VpsConnection } from "../../vps/connection"
import { VpsContext } from "../../vps/context"
import { VpsPty } from "../../vps/pty"
import { Config } from "../../config/config"
import { Locale } from "../../util/locale"

export const VpsCommand = cmd({
  command: "vps",
  describe: "manage VPS connections",
  builder: (yargs: Argv) =>
    yargs
      .command(VpsListCommand)
      .command(VpsConnectCommand)
      .command(VpsDisconnectCommand)
      .command(VpsStatusCommand)
      .command(VpsSwitchCommand)
      .demandCommand(),
  async handler() {},
})

export const VpsListCommand = cmd({
  command: "list",
  describe: "list configured VPS servers",
  builder: (yargs: Argv) => {
    return yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const config = await Config.get()
      const vpsConfigs = config.vps || {}

      if (Object.keys(vpsConfigs).length === 0) {
        console.log(UI.yellow("No VPS configured"))
        console.log()
        console.log(UI.dim("Add VPS to your opencode.json:"))
        console.log(
          UI.dim(`
{
  "vps": {
    "production": {
      "host": "example.com",
      "port": 22,
      "user": "ubuntu",
      "auth": { "type": "key", "keyPath": "~/.ssh/id_rsa" },
      "nickname": "Production Server"
    }
  }
}
`)
        )
        return
      }

      const connections = VpsConnection.list()

      if (args.format === "json") {
        const data = Object.entries(vpsConfigs).map(([key, cfg]) => ({
          key,
          nickname: cfg.nickname || key,
          host: cfg.host,
          port: cfg.port || 22,
          user: cfg.user,
          authType: cfg.auth.type,
          connected: connections.some((c) => c.configKey === key && c.status === "connected"),
        }))
        console.log(JSON.stringify(data, null, 2))
        return
      }

      console.log(UI.bold("Configured VPS:"))
      console.log()

      for (const [key, cfg] of Object.entries(vpsConfigs)) {
        const conn = connections.find((c) => c.configKey === key)
        const status = conn?.status === "connected" ? UI.green("connected") : UI.dim("not connected")

        console.log(`  ${UI.green(key)} ${UI.dim(`(${cfg.nickname || key})`)}`)
        console.log(`    ${UI.dim(`${cfg.user}@${cfg.host}:${cfg.port || 22}`)}`)
        console.log(`    ${UI.dim(`Auth: ${cfg.auth.type}`)} | ${status}`)
        console.log()
      }
    })
  },
})

export const VpsConnectCommand = cmd({
  command: "connect <name>",
  describe: "connect to a VPS",
  builder: (yargs: Argv) => {
    return yargs
      .positional("name", {
        type: "string",
        describe: "VPS configuration name",
      })
      .option("password", {
        type: "string",
        describe: "SSH password (if using password authentication)",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const name = args.name as string
      const config = await Config.get()
      const vpsConfig = config.vps?.[name]

      if (!vpsConfig) {
        console.error(UI.red(`VPS '${name}' not found in configuration`))
        console.error()
        console.error(UI.dim("Available VPS:"))
        for (const key of Object.keys(config.vps || {})) {
          console.error(UI.dim(`  - ${key}`))
        }
        process.exit(1)
      }

      // Check if already connected
      const existing = VpsConnection.getByKey(name)
      if (existing && existing.status === "connected") {
        console.log(UI.green(`Already connected to ${existing.nickname}`))
        return
      }

      console.log(UI.dim(`Connecting to ${vpsConfig.user}@${vpsConfig.host}...`))

      try {
        const info = await VpsConnection.connect(name, vpsConfig, {
          password: args.password as string | undefined,
        })
        console.log(UI.green(`${UI.checkmark} Connected to ${info.nickname}`))
        console.log(UI.dim(`  Connection ID: ${info.id}`))

        // Auto switch context
        VpsContext.switchToVps(info.id, name, info.nickname, vpsConfig.defaultDirectory)
        console.log(UI.dim(`  Switched context to VPS`))
      } catch (error: any) {
        console.error(UI.red(`${UI.cross} Connection failed: ${error.message}`))
        process.exit(1)
      }
    })
  },
})

export const VpsDisconnectCommand = cmd({
  command: "disconnect <name>",
  describe: "disconnect from a VPS",
  builder: (yargs: Argv) => {
    return yargs.positional("name", {
      type: "string",
      describe: "VPS configuration name or connection ID",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const name = args.name as string

      const connections = VpsConnection.list()
      let connection = connections.find((c) => c.configKey === name)

      // Try by ID if not found by config key
      if (!connection) {
        connection = connections.find((c) => c.id === name)
      }

      if (!connection) {
        console.error(UI.red(`No active connection to '${name}'`))
        process.exit(1)
      }

      VpsConnection.disconnect(connection.id)
      console.log(UI.green(`${UI.checkmark} Disconnected from ${connection.nickname}`))

      // Switch back to local if we were on this VPS
      const context = VpsContext.getCurrent()
      if (context.type === "vps" && context.vpsId === connection.id) {
        VpsContext.switchToLocal()
        console.log(UI.dim(`  Switched context to local`))
      }
    })
  },
})

export const VpsStatusCommand = cmd({
  command: "status",
  describe: "show active VPS connections and current context",
  builder: (yargs: Argv) => {
    return yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const context = VpsContext.getCurrent()
      const connections = VpsConnection.list()

      if (args.format === "json") {
        console.log(
          JSON.stringify(
            {
              context,
              connections,
            },
            null,
            2
          )
        )
        return
      }

      console.log(UI.bold("Current Context:"))
      if (context.type === "local") {
        console.log(`  ${UI.green("local")}`)
      } else {
        const vpsInfo = VpsConnection.get(context.vpsId!)
        console.log(`  ${UI.blue(context.nickname || context.configKey || "VPS")}`)
        if (vpsInfo) {
          console.log(`    ${UI.dim(`${vpsInfo.user}@${vpsInfo.host}`)}`)
        }
        if (context.directory) {
          console.log(`    ${UI.dim(`Directory: ${context.directory}`)}`)
        }
      }
      console.log()

      if (connections.length === 0) {
        console.log(UI.yellow("No active VPS connections"))
        return
      }

      console.log(UI.bold("Active Connections:"))
      console.log()

      for (const conn of connections) {
        const statusColor = conn.status === "connected" ? UI.green : UI.red
        const statusIcon = conn.status === "connected" ? UI.checkmark : UI.cross
        const isCurrentContext = context.type === "vps" && context.vpsId === conn.id

        console.log(`  ${statusColor(`${statusIcon} ${conn.nickname}`)} ${UI.dim(`(${conn.configKey})`)}`)
        console.log(`    ${UI.dim(`${conn.user}@${conn.host}:${conn.port}`)}`)
        console.log(`    ${UI.dim(`Status: ${conn.status}`)}`)
        if (conn.connectedAt) {
          const duration = Math.floor((Date.now() - conn.connectedAt) / 1000)
          console.log(`    ${UI.dim(`Connected: ${duration}s ago`)}`)
        }
        if (conn.lastError) {
          console.log(`    ${UI.red(`Error: ${conn.lastError}`)}`)
        }
        if (isCurrentContext) {
          console.log(`    ${UI.blue(`[Current Context]`)}`)
        }
        console.log()
      }
    })
  },
})

export const VpsSwitchCommand = cmd({
  command: "switch <target>",
  describe: "switch context to local or a VPS",
  builder: (yargs: Argv) => {
    return yargs.positional("target", {
      type: "string",
      describe: "Target context: 'local' or VPS configuration name",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const target = args.target as string

      if (target === "local") {
        VpsContext.switchToLocal()
        console.log(UI.green(`${UI.checkmark} Switched to local context`))
        return
      }

      // Try to find connected VPS by config key
      let connection = VpsConnection.getByKey(target)

      // If not connected, try to connect
      if (!connection || connection.status !== "connected") {
        const config = await Config.get()
        const vpsConfig = config.vps?.[target]

        if (!vpsConfig) {
          console.error(UI.red(`VPS '${target}' not found in configuration`))
          process.exit(1)
        }

        console.log(UI.dim(`Connecting to ${vpsConfig.user}@${vpsConfig.host}...`))

        try {
          connection = await VpsConnection.connect(target, vpsConfig)
          console.log(UI.green(`${UI.checkmark} Connected to ${connection.nickname}`))
        } catch (error: any) {
          console.error(UI.red(`${UI.cross} Connection failed: ${error.message}`))
          process.exit(1)
        }
      }

      VpsContext.switchToVps(connection.id, target, connection.nickname, connection.defaultDirectory)
      console.log(UI.green(`${UI.checkmark} Switched to ${connection.nickname}`))
    })
  },
})
