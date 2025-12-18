import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { McpJson, transformMcpJson } from "../../config/mcp-json"
import { parse as parseJsonc } from "jsonc-parser"
import path from "path"
import { Global } from "../../global"

export const McpCommand = cmd({
  command: "mcp",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpImportCommand)
      .demandCommand(),
  async handler() {},
})

export const McpListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Servers")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const statuses = await MCP.status()

        if (Object.keys(mcpServers).length === 0) {
          prompts.log.warn("No MCP servers configured")
          prompts.outro("Add servers with: opencode mcp add")
          return
        }

        for (const [name, serverConfig] of Object.entries(mcpServers)) {
          const status = statuses[name]
          const hasOAuth = serverConfig.type === "remote" && !!serverConfig.oauth
          const hasStoredTokens = await MCP.hasStoredTokens(name)

          let statusIcon: string
          let statusText: string
          let hint = ""

          if (!status) {
            statusIcon = "○"
            statusText = "not initialized"
          } else if (status.status === "connected") {
            statusIcon = "✓"
            statusText = "connected"
            if (hasOAuth && hasStoredTokens) {
              hint = " (OAuth)"
            }
          } else if (status.status === "disabled") {
            statusIcon = "○"
            statusText = "disabled"
          } else if (status.status === "needs_auth") {
            statusIcon = "⚠"
            statusText = "needs authentication"
          } else if (status.status === "needs_client_registration") {
            statusIcon = "✗"
            statusText = "needs client registration"
            hint = "\n    " + status.error
          } else {
            statusIcon = "✗"
            statusText = "failed"
            hint = "\n    " + status.error
          }

          const typeHint = serverConfig.type === "remote" ? serverConfig.url : serverConfig.command.join(" ")
          prompts.log.info(
            `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
          )
        }

        prompts.outro(`${Object.keys(mcpServers).length} server(s)`)
      },
    })
  },
})

export const McpAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Authentication")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-enabled servers (OAuth is enabled by default for remote servers unless oauth: false)
        const oauthServers = Object.entries(mcpServers).filter(
          ([_, cfg]) => cfg.type === "remote" && cfg.oauth !== false,
        )

        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-enabled MCP servers configured")
          prompts.log.info("Add OAuth config to a remote MCP server in opencode.json:")
          prompts.log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "oauth": {
        "scope": "tools:read"
      }
    }
  }`)
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = await prompts.select({
            message: "Select MCP server to authenticate",
            options: oauthServers.map(([name, cfg]) => ({
              label: name,
              value: name,
              hint: cfg.type === "remote" ? cfg.url : undefined,
            })),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        if (serverConfig.type !== "remote" || !serverConfig.oauth) {
          prompts.log.error(`MCP server ${serverName} does not have OAuth configured`)
          prompts.outro("Done")
          return
        }

        // Check if already authenticated
        const hasTokens = await MCP.hasStoredTokens(serverName)
        if (hasTokens) {
          const confirm = await prompts.confirm({
            message: `${serverName} already has stored credentials. Re-authenticate?`,
          })
          if (prompts.isCancel(confirm) || !confirm) {
            prompts.outro("Cancelled")
            return
          }
        }

        const spinner = prompts.spinner()
        spinner.start("Starting OAuth flow...")

        try {
          const status = await MCP.authenticate(serverName)

          if (status.status === "connected") {
            spinner.stop("Authentication successful!")
          } else if (status.status === "needs_client_registration") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
            prompts.log.info("Add clientId to your MCP server config:")
            prompts.log.info(`
  "mcp": {
    "${serverName}": {
      "type": "remote",
      "url": "${serverConfig.url}",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`)
          } else if (status.status === "failed") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
          } else {
            spinner.stop("Unexpected status: " + status.status, 1)
          }
        } catch (error) {
          spinner.stop("Authentication failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpLogoutCommand = cmd({
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Logout")

        const authPath = path.join(Global.Path.data, "mcp-auth.json")
        const credentials = await McpAuth.all()
        const serverNames = Object.keys(credentials)

        if (serverNames.length === 0) {
          prompts.log.warn("No MCP OAuth credentials stored")
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = await prompts.select({
            message: "Select MCP server to logout",
            options: serverNames.map((name) => {
              const entry = credentials[name]
              const hasTokens = !!entry.tokens
              const hasClient = !!entry.clientInfo
              let hint = ""
              if (hasTokens && hasClient) hint = "tokens + client"
              else if (hasTokens) hint = "tokens"
              else if (hasClient) hint = "client registration"
              return {
                label: name,
                value: name,
                hint,
              }
            }),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        if (!credentials[serverName]) {
          prompts.log.error(`No credentials found for: ${serverName}`)
          prompts.outro("Done")
          return
        }

        await MCP.removeAuth(serverName)
        prompts.log.success(`Removed OAuth credentials for ${serverName}`)
        prompts.outro("Done")
      },
    })
  },
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

      prompts.log.info(`Local MCP server "${name}" configured with command: ${command}`)
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

      const useOAuth = await prompts.confirm({
        message: "Does this server require OAuth authentication?",
        initialValue: false,
      })
      if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()

      if (useOAuth) {
        const hasClientId = await prompts.confirm({
          message: "Do you have a pre-registered client ID?",
          initialValue: false,
        })
        if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()

        if (hasClientId) {
          const clientId = await prompts.text({
            message: "Enter client ID",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(clientId)) throw new UI.CancelledError()

          const hasSecret = await prompts.confirm({
            message: "Do you have a client secret?",
            initialValue: false,
          })
          if (prompts.isCancel(hasSecret)) throw new UI.CancelledError()

          let clientSecret: string | undefined
          if (hasSecret) {
            const secret = await prompts.password({
              message: "Enter client secret",
            })
            if (prompts.isCancel(secret)) throw new UI.CancelledError()
            clientSecret = secret
          }

          prompts.log.info(`Remote MCP server "${name}" configured with OAuth (client ID: ${clientId})`)
          prompts.log.info("Add this to your opencode.json:")
          prompts.log.info(`
  "mcp": {
    "${name}": {
      "type": "remote",
      "url": "${url}",
      "oauth": {
        "clientId": "${clientId}"${clientSecret ? `,\n        "clientSecret": "${clientSecret}"` : ""}
      }
    }
  }`)
        } else {
          prompts.log.info(`Remote MCP server "${name}" configured with OAuth (dynamic registration)`)
          prompts.log.info("Add this to your opencode.json:")
          prompts.log.info(`
  "mcp": {
    "${name}": {
      "type": "remote",
      "url": "${url}",
      "oauth": {}
    }
  }`)
        }
      } else {
        const client = new Client({
          name: "opencode",
          version: "1.0.0",
        })
        const transport = new StreamableHTTPClientTransport(new URL(url))
        await client.connect(transport)
        prompts.log.info(`Remote MCP server "${name}" configured with URL: ${url}`)
      }
    }

    prompts.outro("MCP server added successfully")
  },
})

/**
 * Import MCP servers from a base64-encoded mcp.json string.
 *
 * This command allows importing MCP server configurations that use the
 * Claude/Cursor mcp.json format. The input should be base64-encoded JSON
 * with the following structure:
 *
 * {
 *   "mcpServers": {
 *     "server-name": {
 *       "command": "npx",           // For local servers
 *       "args": ["-y", "mcp-server"],
 *       "env": { "API_KEY": "..." }
 *     },
 *     "remote-server": {
 *       "url": "https://example.com/mcp",  // For remote servers
 *       "headers": { "Authorization": "Bearer ..." }
 *     }
 *   }
 * }
 *
 * Example usage:
 *   echo '{"mcpServers":{"my-server":{"url":"https://mcp.example.com"}}}' | base64
 *   opencode mcp import <base64-output>
 */
export const McpImportCommand = cmd({
  command: "import <data>",
  describe: "import MCP servers from a base64-encoded mcp.json string",
  builder: (yargs) =>
    yargs.positional("data", {
      describe: "base64-encoded mcp.json content",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Import MCP Servers")

        // Decode base64
        let decoded: string
        try {
          decoded = Buffer.from(args.data, "base64").toString("utf-8")
        } catch {
          prompts.log.error("Invalid base64 encoding")
          prompts.outro("Import failed")
          return
        }

        // Parse JSON
        let data: unknown
        try {
          data = parseJsonc(decoded, [], { allowTrailingComma: true })
        } catch {
          prompts.log.error("Invalid JSON")
          prompts.outro("Import failed")
          return
        }

        // Validate against mcp.json schema
        const parsed = McpJson.safeParse(data)
        if (!parsed.success) {
          prompts.log.error("Invalid mcp.json format:")
          for (const issue of parsed.error.issues) {
            prompts.log.error(`  ${issue.path.join(".")}: ${issue.message}`)
          }
          prompts.outro("Import failed")
          return
        }

        if (!parsed.data.mcpServers || Object.keys(parsed.data.mcpServers).length === 0) {
          prompts.log.warn("No MCP servers found in the provided data")
          prompts.outro("Import cancelled")
          return
        }

        // Transform to OpenCode format
        const servers = transformMcpJson(parsed.data)
        const serverNames = Object.keys(servers)

        // Show preview
        prompts.log.info(`Found ${serverNames.length} MCP server(s):`)
        for (const [name, config] of Object.entries(servers)) {
          const typeHint = config.type === "remote" ? config.url : config.command.join(" ")
          prompts.log.info(`  - ${name} (${config.type}): ${typeHint}`)
        }

        // Confirm import
        const confirm = await prompts.confirm({
          message: "Import these servers?",
        })
        if (prompts.isCancel(confirm) || !confirm) {
          prompts.outro("Import cancelled")
          return
        }

        // Ask for location
        const location = await prompts.select({
          message: "Where do you want to save the configuration?",
          options: [
            {
              label: "Project",
              value: "project",
              hint: path.join(Instance.directory, "opencode.json"),
            },
            {
              label: "Global",
              value: "global",
              hint: path.join(Global.Path.config, "opencode.json"),
            },
          ],
        })
        if (prompts.isCancel(location)) {
          prompts.outro("Import cancelled")
          return
        }

        const configPath =
          location === "project"
            ? path.join(Instance.directory, "opencode.json")
            : path.join(Global.Path.config, "opencode.json")

        // Load existing config or create new one
        let existingConfig: Config.Info = {}
        const existingText = await Bun.file(configPath)
          .text()
          .catch(() => null)

        if (existingText) {
          try {
            existingConfig = parseJsonc(existingText, [], { allowTrailingComma: true }) as Config.Info
          } catch {
            prompts.log.warn("Could not parse existing config, will create new one")
          }
        }

        // Check for conflicts
        const existingMcp = existingConfig.mcp ?? {}
        const conflicts = serverNames.filter((name) => name in existingMcp)

        if (conflicts.length > 0) {
          prompts.log.warn(`The following servers already exist: ${conflicts.join(", ")}`)
          const overwrite = await prompts.confirm({
            message: "Overwrite existing servers?",
            initialValue: false,
          })
          if (prompts.isCancel(overwrite)) {
            prompts.outro("Import cancelled")
            return
          }
          if (!overwrite) {
            // Remove conflicting servers from import
            for (const name of conflicts) {
              delete servers[name]
            }
            if (Object.keys(servers).length === 0) {
              prompts.log.warn("No new servers to import after removing conflicts")
              prompts.outro("Import cancelled")
              return
            }
          }
        }

        // Merge and write
        existingConfig.$schema = existingConfig.$schema ?? "https://opencode.ai/config.json"
        existingConfig.mcp = { ...existingMcp, ...servers }

        await Bun.write(configPath, JSON.stringify(existingConfig, null, 2))

        prompts.log.success(`Imported ${Object.keys(servers).length} server(s) to ${configPath}`)
        prompts.outro("Import complete")
      },
    })
  },
})
