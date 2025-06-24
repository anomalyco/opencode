import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import { z } from "zod"

export const McpCommand = cmd({
  command: "mcp [command]",
  describe: "Configure and manage MCP servers",
  builder: (yargs) => {
    const configured = yargs
      .command(McpAddCommand)
      .command(McpRemoveCommand)
      .command(McpListCommand)
      .command(McpGetCommand)
      .command(McpAddJsonCommand)
      .help()
    
    return configured
  },
  handler: () => {
    // Show help if no subcommand provided
    console.log(`Usage: opencode mcp [options] [command]

Configure and manage MCP servers

Options:
  -h, --help                                     Display help for command

Commands:
  add [options] <name> <commandOrUrl> [args...]  Add a server
  remove [options] <name>                        Remove an MCP server
  list                                           List configured MCP servers
  get <name>                                     Get details about an MCP server
  add-json [options] <name> <json>               Add an MCP server (stdio or SSE) with a JSON string`)
  },
})

const McpAddCommand = cmd({
  command: "add <name> <commandOrUrl> [args...]",
  describe: "Add a server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name of the MCP server",
        demandOption: true,
      })
      .positional("commandOrUrl", {
        type: "string",
        describe: "Command to run (for stdio) or URL (for SSE)",
        demandOption: true,
      })
      .positional("args", {
        type: "string",
        array: true,
        describe: "Additional arguments for stdio command",
        default: [],
      })
      .option("type", {
        type: "string",
        choices: ["local", "remote"] as const,
        describe: "Type of MCP server (auto-detected if not specified)",
      })
      .option("env", {
        type: "string",
        array: true,
        describe: "Environment variables in KEY=VALUE format",
        default: [],
      }),
  handler: async (args) => {
    // Parse environment variables
    const environment: Record<string, string> = {}
    for (const envVar of args.env) {
      const [key, ...valueParts] = envVar.split("=")
      if (!key || valueParts.length === 0) {
        UI.error(`Invalid environment variable format: ${envVar}. Use KEY=VALUE format.`)
        return
      }
      environment[key] = valueParts.join("=")
    }

    // Auto-detect type if not specified
    const isRemote = args.commandOrUrl.startsWith("http://") || args.commandOrUrl.startsWith("https://")
    const serverType = args.type || (isRemote ? "remote" : "local")

    // Validate remote server constraints
    if (serverType === "remote") {
      if (args.args.length > 0) {
        UI.error("Remote MCP servers don't accept additional arguments")
        return
      }
      if (Object.keys(environment).length > 0) {
        UI.error("Remote MCP servers don't support environment variables")
        return
      }
    }

    // Create config
    const mcpConfig: Config.Mcp = serverType === "remote" 
      ? {
          type: "remote",
          url: args.commandOrUrl,
        }
      : {
          type: "local",
          command: [args.commandOrUrl, ...args.args],
          ...(Object.keys(environment).length > 0 && { environment }),
        }

    const configPath = path.join(Global.Path.config, "config.json")
    const currentConfig = await Config.global()

    const updatedConfig = {
      ...currentConfig,
      mcp: {
        ...currentConfig.mcp,
        [args.name]: mcpConfig,
      },
    }

    await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
    
    UI.println(`Added MCP server "${args.name}" (${serverType})`)
  },
})

const McpRemoveCommand = cmd({
  command: "remove <name>",
  describe: "Remove an MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name of the MCP server to remove",
        demandOption: true,
      }),
  handler: async (args) => {
    const configPath = path.join(Global.Path.config, "config.json")
    const currentConfig = await Config.global()

    if (!currentConfig.mcp || !currentConfig.mcp[args.name]) {
      UI.error(`MCP server "${args.name}" not found`)
      return
    }

    const { [args.name]: removed, ...remainingMcp } = currentConfig.mcp
    const updatedConfig = {
      ...currentConfig,
      mcp: Object.keys(remainingMcp).length > 0 ? remainingMcp : undefined,
    }

    await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
    
    UI.println(`Removed MCP server "${args.name}"`)
  },
})

const McpListCommand = cmd({
  command: "list",
  describe: "List configured MCP servers",
  handler: async () => {
    const config = await Config.global()
    
    if (!config.mcp || Object.keys(config.mcp).length === 0) {
      UI.println("No MCP servers configured")
      return
    }

    UI.println("Configured MCP servers:")
    UI.empty()
    
    for (const [name, mcpConfig] of Object.entries(config.mcp)) {
      UI.println(`  ${name} (${mcpConfig.type})`)
      if (mcpConfig.type === "local") {
        UI.println(`    Command: ${mcpConfig.command.join(" ")}`)
        if (mcpConfig.environment && Object.keys(mcpConfig.environment).length > 0) {
          UI.println(`    Environment:`)
          for (const [key, value] of Object.entries(mcpConfig.environment)) {
            UI.println(`      ${key}=${value}`)
          }
        }
      } else {
        UI.println(`    URL: ${mcpConfig.url}`)
      }
      UI.empty()
    }
  },
})

const McpGetCommand = cmd({
  command: "get <name>",
  describe: "Get details about an MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name of the MCP server",
        demandOption: true,
      }),
  handler: async (args) => {
    const config = await Config.global()
    
    if (!config.mcp || !config.mcp[args.name]) {
      UI.error(`MCP server "${args.name}" not found`)
      return
    }

    const mcpConfig = config.mcp[args.name]
    UI.println(`MCP Server: ${args.name}`)
    UI.println(`Type: ${mcpConfig.type}`)
    
    if (mcpConfig.type === "local") {
      UI.println(`Command: ${mcpConfig.command.join(" ")}`)
      if (mcpConfig.environment && Object.keys(mcpConfig.environment).length > 0) {
        UI.println(`Environment variables:`)
        for (const [key, value] of Object.entries(mcpConfig.environment)) {
          UI.println(`  ${key}=${value}`)
        }
      }
    } else {
      UI.println(`URL: ${mcpConfig.url}`)
    }
  },
})

const McpAddJsonCommand = cmd({
  command: "add-json <name> <json>",
  describe: "Add an MCP server (stdio or SSE) with a JSON string",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name of the MCP server",
        demandOption: true,
      })
      .positional("json", {
        type: "string",
        describe: "JSON configuration for the MCP server",
        demandOption: true,
      }),
  handler: async (args) => {
    try {
      const jsonConfig = JSON.parse(args.json)
      const mcpConfig = Config.Mcp.parse(jsonConfig)

      const configPath = path.join(Global.Path.config, "config.json")
      const currentConfig = await Config.global()

      const updatedConfig = {
        ...currentConfig,
        mcp: {
          ...currentConfig.mcp,
          [args.name]: mcpConfig,
        },
      }

      await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
      
      UI.println(`Added MCP server "${args.name}" (${mcpConfig.type})`)
    } catch (error) {
      if (error instanceof SyntaxError) {
        UI.error(`Invalid JSON: ${error.message}`)
        return
      }
      if (error instanceof z.ZodError) {
        UI.error(`Invalid MCP configuration:`)
        for (const issue of error.issues) {
          UI.error(`  ${issue.path.join(".")}: ${issue.message}`)
        }
        return
      }
      UI.error(`Failed to add MCP server: ${error}`)
    }
  },
})