import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import { z } from "zod"

async function loadProjectConfig(configPath: string): Promise<Config.Info> {
  try {
    const file = Bun.file(configPath)
    const data = await file.json()
    return data
  } catch (error) {
    // If file doesn't exist, return empty config
    return {}
  }
}

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
      .command(McpEnableCommand)
      .command(McpDisableCommand)
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
  add-json [options] <name> <json>               Add an MCP server (stdio or SSE) with a JSON string
  enable [options] <name>                        Enable an MCP server
  disable [options] <name>                       Disable an MCP server`)
  },
})

export const McpAddCommand = cmd({
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
      .option("scope", {
        alias: "s",
        type: "string",
        choices: ["user", "project"] as const,
        default: "project",
        describe: "Configuration scope (user, or project)",
      })
      .option("transport", {
        alias: "t",
        type: "string",
        choices: ["stdio", "sse"] as const,
        default: "stdio",
        describe: "Transport type (stdio, sse)",
      })
      .option("env", {
        alias: "e",
        type: "string",
        array: true,
        describe: "Set environment variables (e.g. -e KEY=value)",
        default: [],
      })
      .option("header", {
        alias: "H",
        type: "string",
        array: true,
        describe: "Set HTTP headers for SSE transport (e.g. -H \"X-Api-Key: abc123\")",
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

    // Parse headers
    const headers: Record<string, string> = {}
    for (const header of args.header) {
      const [key, ...valueParts] = header.split(":")
      if (!key || valueParts.length === 0) {
        UI.error(`Invalid header format: ${header}. Use "Key: Value" format.`)
        return
      }
      headers[key.trim()] = valueParts.join(":").trim()
    }

    // Determine server type based on transport and URL
    const serverType = args.transport === "stdio" ? "local" : "remote"
    const isUrl = args.commandOrUrl.startsWith("http://") || args.commandOrUrl.startsWith("https://")

    // Validate transport constraints
    if (args.transport === "stdio") {
      if (isUrl) {
        UI.error("stdio transport requires a command, not a URL")
        return
      }
      if (Object.keys(headers).length > 0) {
        UI.error("stdio transport doesn't support headers")
        return
      }
    } else {
      // sse transport
      if (!isUrl) {
        UI.error(`${args.transport} transport requires a URL`)
        return
      }
      if (args.args.length > 0) {
        UI.error(`${args.transport} transport doesn't accept additional arguments`)
        return
      }
      if (Object.keys(environment).length > 0) {
        UI.error(`${args.transport} transport doesn't support environment variables`)
        return
      }
    }

    // Create config
    const mcpConfig: Config.Mcp = serverType === "remote" 
      ? {
          type: "remote",
          url: args.commandOrUrl,
          ...(Object.keys(headers).length > 0 && { headers }),
        }
      : {
          type: "local",
          command: [args.commandOrUrl, ...args.args],
          ...(Object.keys(environment).length > 0 && { environment }),
        }

    // Determine config path based on scope
    const configPath = args.scope === "user" 
      ? path.join(Global.Path.config, "config.json")
      : path.join(process.cwd(), "opencode.json")

    // Load current config
    const currentConfig = args.scope === "user" 
      ? await Config.global()
      : await loadProjectConfig(configPath)

    const updatedConfig = {
      ...currentConfig,
      mcp: {
        ...currentConfig.mcp,
        [args.name]: mcpConfig,
      },
    }

    await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
    
    UI.println(`Added MCP server "${args.name}" (${args.transport}) to ${args.scope} config`)
  },
})

export const McpRemoveCommand = cmd({
  command: "remove <name>",
  describe: "Remove an MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name of the MCP server to remove",
        demandOption: true,
      })
      .option("scope", {
        alias: "s",
        type: "string",
        choices: ["user", "project"] as const,
        default: "project",
        describe: "Configuration scope (user, or project)",
      }),
  handler: async (args) => {
    // Determine config path based on scope
    const configPath = args.scope === "user" 
      ? path.join(Global.Path.config, "config.json")
      : path.join(process.cwd(), "opencode.json")

    // Load current config
    const currentConfig = args.scope === "user" 
      ? await Config.global()
      : await loadProjectConfig(configPath)

    if (!currentConfig.mcp || !currentConfig.mcp[args.name]) {
      UI.error(`MCP server "${args.name}" not found in ${args.scope} config`)
      return
    }

    const { [args.name]: removed, ...remainingMcp } = currentConfig.mcp
    const updatedConfig = {
      ...currentConfig,
      mcp: Object.keys(remainingMcp).length > 0 ? remainingMcp : undefined,
    }

    await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
    
    UI.println(`Removed MCP server "${args.name}" from ${args.scope} config`)
  },
})

export const McpListCommand = cmd({
  command: "list",
  describe: "List configured MCP servers",
  handler: async () => {
    const globalConfig = await Config.global()
    const projectConfigPath = path.join(process.cwd(), "opencode.json")
    const projectConfig = await loadProjectConfig(projectConfigPath)
    
    const hasGlobalServers = globalConfig.mcp && Object.keys(globalConfig.mcp).length > 0
    const hasProjectServers = projectConfig.mcp && Object.keys(projectConfig.mcp).length > 0
    
    if (!hasGlobalServers && !hasProjectServers) {
      UI.println("No MCP servers configured")
      return
    }

    // Display global servers
    if (hasGlobalServers) {
      UI.println("Global MCP servers:")
      UI.empty()
      
      for (const [name, mcpConfig] of Object.entries(globalConfig.mcp!)) {
        const status = mcpConfig.enabled === false ? " (disabled)" : ""
        UI.println(`  ${name} (${mcpConfig.type})${status}`)
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
    }

    // Display project servers
    if (hasProjectServers) {
      UI.println("Project MCP servers:")
      UI.empty()
      
      for (const [name, mcpConfig] of Object.entries(projectConfig.mcp!)) {
        const status = mcpConfig.enabled === false ? " (disabled)" : ""
        UI.println(`  ${name} (${mcpConfig.type})${status}`)
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
    }
  },
})

export const McpGetCommand = cmd({
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
    const globalConfig = await Config.global()
    const projectConfigPath = path.join(process.cwd(), "opencode.json")
    const projectConfig = await loadProjectConfig(projectConfigPath)

    let foundConfig: Config.Mcp | null = null
    let foundScope: string | null = null

    // Check project config first (takes priority)
    if (projectConfig.mcp && projectConfig.mcp[args.name]) {
      foundConfig = projectConfig.mcp[args.name]
      foundScope = "project"
    }
    // Then check global config
    else if (globalConfig.mcp && globalConfig.mcp[args.name]) {
      foundConfig = globalConfig.mcp[args.name]
      foundScope = "user"
    }

    if (!foundConfig || !foundScope) {
      UI.error(`MCP server "${args.name}" not found`)
      return
    }

    UI.println(`MCP Server: ${args.name}`)
    UI.println(`Scope: ${foundScope}`)
    UI.println(`Type: ${foundConfig.type}`)
    UI.println(`Enabled: ${foundConfig.enabled !== false ? "true" : "false"}`)
    
    if (foundConfig.type === "local") {
      UI.println(`Command: ${foundConfig.command.join(" ")}`)
      if (foundConfig.environment && Object.keys(foundConfig.environment).length > 0) {
        UI.println(`Environment variables:`)
        for (const [key, value] of Object.entries(foundConfig.environment)) {
          UI.println(`  ${key}=${value}`)
        }
      }
    } else {
      UI.println(`URL: ${foundConfig.url}`)
      if (foundConfig.headers && Object.keys(foundConfig.headers).length > 0) {
        UI.println(`Headers:`)
        for (const [key, value] of Object.entries(foundConfig.headers)) {
          UI.println(`  ${key}: ${value}`)
        }
      }
    }
  },
})

export const McpAddJsonCommand = cmd({
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
      })
      .option("scope", {
        alias: "s",
        type: "string",
        choices: ["user", "project"] as const,
        default: "project",
        describe: "Configuration scope (user, or project)",
      }),
  handler: async (args) => {
    try {
      const jsonConfig = JSON.parse(args.json)
      
      // Infer type and transform to match schema
      let mcpConfig
      if ('command' in jsonConfig) {
        // Transform stdio transport format
        const { type, command, args, env, ...rest } = jsonConfig
        
        // Build command array
        const commandArray = Array.isArray(command) ? command : [command]
        if (args && Array.isArray(args)) {
          commandArray.push(...args)
        }
        
        mcpConfig = Config.Mcp.parse({
          type: 'local',
          command: commandArray,
          ...(env && { environment: env }),
          ...rest
        })
      } else if ('url' in jsonConfig) {
        // Transform sse transport format
        const { type, ...rest } = jsonConfig
        mcpConfig = Config.Mcp.parse({
          type: 'remote',
          ...rest
        })
      } else {
        UI.error("Invalid MCP configuration: Unable to determine transport type from JSON. Must include either 'command' for stdio or 'url' for sse.")
        return
      }

      // Determine config path based on scope
      const configPath = args.scope === "user" 
        ? path.join(Global.Path.config, "config.json")
        : path.join(process.cwd(), "opencode.json")

      // Load current config
      const currentConfig = args.scope === "user" 
        ? await Config.global()
        : await loadProjectConfig(configPath)

      const updatedConfig = {
        ...currentConfig,
        mcp: {
          ...currentConfig.mcp,
          [args.name]: mcpConfig,
        },
      }

      await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
      
      UI.println(`Added MCP server "${args.name}" (${mcpConfig.type}) to ${args.scope} config`)
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

export const McpEnableCommand = cmd({
  command: "enable <name>",
  describe: "Enable an MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name of the MCP server to enable",
        demandOption: true,
      })
      .option("scope", {
        alias: "s",
        type: "string",
        choices: ["user", "project"] as const,
        default: "project",
        describe: "Configuration scope (user, or project)",
      }),
  handler: async (args) => {
    // Determine config path based on scope
    const configPath = args.scope === "user" 
      ? path.join(Global.Path.config, "config.json")
      : path.join(process.cwd(), "opencode.json")

    // Load current config
    const currentConfig = args.scope === "user" 
      ? await Config.global()
      : await loadProjectConfig(configPath)

    if (!currentConfig.mcp || !currentConfig.mcp[args.name]) {
      UI.error(`MCP server "${args.name}" not found in ${args.scope} config`)
      return
    }

    const updatedConfig = {
      ...currentConfig,
      mcp: {
        ...currentConfig.mcp,
        [args.name]: {
          ...currentConfig.mcp[args.name],
          enabled: true,
        },
      },
    }

    await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
    
    UI.println(`Enabled MCP server "${args.name}" in ${args.scope} config`)
  },
})

export const McpDisableCommand = cmd({
  command: "disable <name>",
  describe: "Disable an MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name of the MCP server to disable",
        demandOption: true,
      })
      .option("scope", {
        alias: "s",
        type: "string",
        choices: ["user", "project"] as const,
        default: "project",
        describe: "Configuration scope (user, or project)",
      }),
  handler: async (args) => {
    // Determine config path based on scope
    const configPath = args.scope === "user" 
      ? path.join(Global.Path.config, "config.json")
      : path.join(process.cwd(), "opencode.json")

    // Load current config
    const currentConfig = args.scope === "user" 
      ? await Config.global()
      : await loadProjectConfig(configPath)

    if (!currentConfig.mcp || !currentConfig.mcp[args.name]) {
      UI.error(`MCP server "${args.name}" not found in ${args.scope} config`)
      return
    }

    const updatedConfig = {
      ...currentConfig,
      mcp: {
        ...currentConfig.mcp,
        [args.name]: {
          ...currentConfig.mcp[args.name],
          enabled: false,
        },
      },
    }

    await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))
    
    UI.println(`Disabled MCP server "${args.name}" in ${args.scope} config`)
  },
})