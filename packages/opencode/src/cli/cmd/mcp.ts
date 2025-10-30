import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import path from "path"
import fs from "fs/promises"

// Helper functions for parsing arguments
function parseHeaders(headers?: string[]): Record<string, string> | undefined {
  if (!headers || headers.length === 0) return undefined

  return headers.reduce(
    (acc, header) => {
      const [key, ...valueParts] = header.split(":")
      if (key && valueParts.length > 0) {
        acc[key.trim()] = valueParts.join(":").trim()
      }
      return acc
    },
    {} as Record<string, string>,
  )
}

function parseEnvironment(env?: string[]): Record<string, string> | undefined {
  if (!env || env.length === 0) return undefined

  return env.reduce(
    (acc, envVar) => {
      const [key, ...valueParts] = envVar.split("=")
      if (key && valueParts.length > 0) {
        acc[key] = valueParts.join("=")
      }
      return acc
    },
    {} as Record<string, string>,
  )
}

async function saveConfig(config: any) {
  // Determine the config file path
  const configDir = Instance.directory
  const configPath = path.join(configDir, "opencode.jsonc")

  // Ensure the config directory exists
  await fs.mkdir(configDir, { recursive: true })

  // Write the updated config
  const configContent = JSON.stringify(config, null, 2)
  await Bun.write(configPath, configContent)
}

export const McpAddUserCommand = cmd({
  command: "user <name> <url>",
  describe: "add a remote MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "MCP server name", type: "string" })
      .positional("url", { describe: "MCP server URL", type: "string" })
      .option("headers", { alias: "H", type: "string", array: true, describe: "Headers in format 'Key: Value'" })
      .option("enabled", { type: "boolean", default: true, describe: "Enable server on startup" }),
  async handler(argv: any) {
    const { name, url, headers, enabled } = argv

    // Validate URL format
    if (!url || !URL.canParse(url)) {
      throw new Error(`Invalid URL: ${url}`)
    }

    UI.empty()
    prompts.intro("Add Remote MCP Server")

    // Test connectivity
    const client = new Client({
      name: "opencode",
      version: "1.0.0",
    })
    const transport = new StreamableHTTPClientTransport(new URL(url))

    try {
      await client.connect(transport)
      prompts.log.success(`Successfully connected to ${name}`)
    } catch (error: any) {
      prompts.log.warn(`Warning: Could not connect to ${name}: ${error.message}`)
      const proceed = await prompts.confirm({
        message: "Continue adding server anyway?",
        initialValue: false,
      })
      if (prompts.isCancel(proceed) || !proceed) {
        throw new UI.CancelledError()
      }
    }

    // Load current config and update with new MCP server
    const currentConfig = await Config.get()
    const mcpConfig = currentConfig.mcp || {}
    const newMcpConfig: any = {
      ...mcpConfig,
    }
    newMcpConfig[name as string] = {
      type: "remote" as const,
      url,
      headers: parseHeaders(headers),
      enabled,
    }

    const remoteConfig = {
      ...currentConfig,
      mcp: newMcpConfig,
    }

    // Save the updated config
    await saveConfig(remoteConfig)

    prompts.log.info(`Remote MCP server "${name}" added successfully`)
    prompts.log.info(`Configuration saved to opencode.jsonc`)
    prompts.outro("MCP server added successfully")
  },
})

export const McpAddLocalCommand = cmd({
  command: "local <name> [command..]",
  describe: "add a local MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "MCP server name", type: "string" })
      .positional("command", { describe: "Command to run", type: "string", array: true, default: [] })
      .option("env", {
        alias: "e",
        type: "string",
        array: true,
        describe: "Environment variables in format 'KEY=VALUE'",
      })
      .option("enabled", { type: "boolean", default: true, describe: "Enable server on startup" }),
  async handler(argv: any) {
    const { name, command, env, enabled } = argv

    if (!command || command.length === 0) {
      throw new Error("Command is required. Provide the command to run after the server name.")
    }

    UI.empty()
    prompts.intro("Add Local MCP Server")

    // Load current config and update with new MCP server
    const currentConfig = await Config.get()
    const mcpConfig = currentConfig.mcp || {}
    const newMcpConfig: any = {
      ...mcpConfig,
    }
    newMcpConfig[name as string] = {
      type: "local" as const,
      command,
      environment: parseEnvironment(env),
      enabled,
    }

    const localConfig = {
      ...currentConfig,
      mcp: newMcpConfig,
    }

    // Save the updated config
    await saveConfig(localConfig)

    prompts.log.info(`Local MCP server "${name}" added successfully`)
    prompts.log.info(`Configuration saved to opencode.jsonc`)
    prompts.outro("MCP server added successfully")
  },
})

export const McpCommand = cmd({
  command: "mcp",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand) // Existing interactive command
      .command(McpAddUserCommand) // New remote command
      .command(McpAddLocalCommand) // New local command
      .demandCommand(),
  async handler() {},
})

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    UI.empty()
    prompts.intro("Add MCP server")

    const name = await prompts.text({
      message: "Enter MCP server name",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(name)) throw new UI.CancelledError()

    const type = await prompts.select({
      message: "Select MCP server type",
      options: [
        {
          label: "Local",
          value: "local",
          hint: "Run a local command",
        },
        {
          label: "Remote",
          value: "remote",
          hint: "Connect to a remote URL",
        },
      ],
    })
    if (prompts.isCancel(type)) throw new UI.CancelledError()

    if (type === "local") {
      const command = await prompts.text({
        message: "Enter command to run",
        placeholder: "e.g., opencode x @modelcontextprotocol/server-filesystem",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(command)) throw new UI.CancelledError()

      // Load current config and update with new MCP server
      const currentConfig = await Config.get()
      const mcpConfig = currentConfig.mcp || {}
      const newMcpConfig: any = {
        ...mcpConfig,
      }
      newMcpConfig[name as string] = {
        type: "local" as const,
        command: [command],
        enabled: true,
      }

      const interactiveLocalConfig = {
        ...currentConfig,
        mcp: newMcpConfig,
      }

      // Save the updated config
      await saveConfig(interactiveLocalConfig)

      prompts.log.info(`Local MCP server "${name}" configured with command: ${command}`)
      prompts.log.info(`Configuration saved to opencode.jsonc`)
      prompts.outro("MCP server added successfully")
      return
    }

    if (type === "remote") {
      const url = await prompts.text({
        message: "Enter MCP server URL",
        placeholder: "e.g., https://example.com/mcp",
        validate: (x) => {
          if (!x) return "Required"
          if (x.length === 0) return "Required"
          const isValid = URL.canParse(x)
          return isValid ? undefined : "Invalid URL"
        },
      })
      if (prompts.isCancel(url)) throw new UI.CancelledError()

      const client = new Client({
        name: "opencode",
        version: "1.0.0",
      })
      const transport = new StreamableHTTPClientTransport(new URL(url))

      try {
        await client.connect(transport)
        prompts.log.success(`Successfully connected to ${url}`)
      } catch (error: any) {
        prompts.log.warn(`Warning: Could not connect to ${url}: ${error.message}`)
        const proceed = await prompts.confirm({
          message: "Continue adding server anyway?",
          initialValue: false,
        })
        if (prompts.isCancel(proceed) || !proceed) {
          throw new UI.CancelledError()
        }
      }

      // Load current config and update with new MCP server
      const currentConfig = await Config.get()
      const mcpConfig = currentConfig.mcp || {}
      const newMcpConfig: any = {
        ...mcpConfig,
      }
      newMcpConfig[name as string] = {
        type: "remote" as const,
        url,
        enabled: true,
      }

      const interactiveRemoteConfig = {
        ...currentConfig,
        mcp: newMcpConfig,
      }

      // Save the updated config
      await saveConfig(interactiveRemoteConfig)

      prompts.log.info(`Remote MCP server "${name}" configured with URL: ${url}`)
      prompts.log.info(`Configuration saved to opencode.jsonc`)
    }

    prompts.outro("MCP server added successfully")
  },
})
