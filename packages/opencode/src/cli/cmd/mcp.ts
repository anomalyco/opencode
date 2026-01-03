import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { McpOAuthProvider } from "../../mcp/oauth-provider"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Installation } from "../../installation"
import { t } from "../../i18n"
import path from "path"
import { Global } from "../../global"

function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓"
    case "expired":
      return "⚠"
    case "not_authenticated":
      return "○"
  }
}

function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return t("mcp.status_authenticated")
    case "expired":
      return t("mcp.status_expired")
    case "not_authenticated":
      return t("mcp.status_not_authenticated")
  }
}

type McpEntry = NonNullable<Config.Info["mcp"]>[string]

type McpConfigured = Config.Mcp
function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

type McpRemote = Extract<McpConfigured, { type: "remote" }>
function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
}

export const McpCommand = cmd({
  command: "mcp",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpDebugCommand)
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
        prompts.intro(t("mcp.servers"))

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const statuses = await MCP.status()

        const servers = Object.entries(mcpServers).filter((entry): entry is [string, McpConfigured] =>
          isMcpConfigured(entry[1]),
        )

        if (servers.length === 0) {
          prompts.log.warn(t("mcp.no_servers"))
          prompts.outro(t("mcp.add_servers_hint"))
          return
        }

        for (const [name, serverConfig] of servers) {
          const status = statuses[name]
          const hasOAuth = isMcpRemote(serverConfig) && !!serverConfig.oauth
          const hasStoredTokens = await MCP.hasStoredTokens(name)

          let statusIcon: string
          let statusText: string
          let hint = ""

          if (!status) {
            statusIcon = "○"
            statusText = t("mcp.status_not_init")
          } else if (status.status === "connected") {
            statusIcon = "✓"
            statusText = t("mcp.status_connected")
            if (hasOAuth && hasStoredTokens) {
              hint = " (OAuth)"
            }
          } else if (status.status === "disabled") {
            statusIcon = "○"
            statusText = t("mcp.status_disabled")
          } else if (status.status === "needs_auth") {
            statusIcon = "⚠"
            statusText = t("mcp.status_needs_auth")
          } else if (status.status === "needs_client_registration") {
            statusIcon = "✗"
            statusText = t("mcp.status_needs_client_reg")
            hint = "\n    " + status.error
          } else {
            statusIcon = "✗"
            statusText = t("mcp.status_failed")
            hint = "\n    " + status.error
          }

          const typeHint = serverConfig.type === "remote" ? serverConfig.url : serverConfig.command.join(" ")
          prompts.log.info(
            `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
          )
        }

        prompts.outro(t("mcp.server_count", { count: String(servers.length) }))
      },
    })
  },
})

export const McpAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "name of the MCP server",
        type: "string",
      })
      .command(McpAuthListCommand),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro(t("mcp.oauth_auth"))

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-capable servers (remote servers with oauth not explicitly disabled)
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        if (oauthServers.length === 0) {
          prompts.log.warn(t("mcp.no_oauth_servers"))
          prompts.log.info(t("mcp.oauth_remote_info"))
          prompts.log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }`)
          prompts.outro(t("upgrade.done"))
          return
        }

        let serverName = args.name
        if (!serverName) {
          // Build options with auth status
          const options = await Promise.all(
            oauthServers.map(async ([name, cfg]) => {
              const authStatus = await MCP.getAuthStatus(name)
              const icon = getAuthStatusIcon(authStatus)
              const statusText = getAuthStatusText(authStatus)
              const url = cfg.url
              return {
                label: `${icon} ${name} (${statusText})`,
                value: name,
                hint: url,
              }
            }),
          )

          const selected = await prompts.select({
            message: t("mcp.select_server_auth"),
            options,
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(t("mcp.server_not_found", { name: serverName }))
          prompts.outro(t("upgrade.done"))
          return
        }

        if (!isMcpRemote(serverConfig) || serverConfig.oauth === false) {
          prompts.log.error(t("mcp.server_not_oauth", { name: serverName }))
          prompts.outro(t("upgrade.done"))
          return
        }

        // Check if already authenticated
        const authStatus = await MCP.getAuthStatus(serverName)
        if (authStatus === "authenticated") {
          const confirm = await prompts.confirm({
            message: t("mcp.already_authenticated", { name: serverName }),
          })
          if (prompts.isCancel(confirm) || !confirm) {
            prompts.outro(t("mcp.cancelled"))
            return
          }
        } else if (authStatus === "expired") {
          prompts.log.warn(t("mcp.expired_credentials", { name: serverName }))
        }

        const spinner = prompts.spinner()
        spinner.start(t("mcp.starting_oauth"))

        try {
          const status = await MCP.authenticate(serverName)

          if (status.status === "connected") {
            spinner.stop(t("mcp.auth_successful"))
          } else if (status.status === "needs_client_registration") {
            spinner.stop(t("mcp.auth_failed"), 1)
            prompts.log.error(status.error)
            prompts.log.info(t("mcp.add_client_id_hint"))
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
            spinner.stop(t("mcp.auth_failed"), 1)
            prompts.log.error(status.error)
          } else {
            spinner.stop(t("mcp.unexpected_status", { status: status.status }), 1)
          }
        } catch (error) {
          spinner.stop(t("mcp.auth_failed"), 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }

        prompts.outro(t("upgrade.done"))
      },
    })
  },
})

export const McpAuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list OAuth-capable MCP servers and their auth status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro(t("mcp.oauth_status"))

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-capable servers
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        if (oauthServers.length === 0) {
          prompts.log.warn(t("mcp.no_oauth_servers"))
          prompts.outro(t("upgrade.done"))
          return
        }

        for (const [name, serverConfig] of oauthServers) {
          const authStatus = await MCP.getAuthStatus(name)
          const icon = getAuthStatusIcon(authStatus)
          const statusText = getAuthStatusText(authStatus)
          const url = serverConfig.url

          prompts.log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${statusText}\n    ${UI.Style.TEXT_DIM}${url}`)
        }

        prompts.outro(t("mcp.oauth_server_count", { count: String(oauthServers.length) }))
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
        prompts.intro(t("mcp.oauth_logout"))

        const authPath = path.join(Global.Path.data, "mcp-auth.json")
        const credentials = await McpAuth.all()
        const serverNames = Object.keys(credentials)

        if (serverNames.length === 0) {
          prompts.log.warn(t("mcp.no_oauth_credentials"))
          prompts.outro(t("upgrade.done"))
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = await prompts.select({
            message: t("mcp.select_server_logout"),
            options: serverNames.map((name) => {
              const entry = credentials[name]
              const hasTokens = !!entry.tokens
              const hasClient = !!entry.clientInfo
              let hint = ""
              if (hasTokens && hasClient) hint = t("mcp.tokens_and_client")
              else if (hasTokens) hint = t("mcp.tokens")
              else if (hasClient) hint = t("mcp.client_registration")
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
          prompts.log.error(t("mcp.no_credentials_for", { name: serverName }))
          prompts.outro(t("upgrade.done"))
          return
        }

        await MCP.removeAuth(serverName)
        prompts.log.success(t("mcp.removed_credentials", { name: serverName }))
        prompts.outro(t("upgrade.done"))
      },
    })
  },
})

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    UI.empty()
    prompts.intro(t("mcp.add_server"))

    const name = await prompts.text({
      message: t("mcp.enter_server_name"),
      validate: (x) => (x && x.length > 0 ? undefined : t("auth.required")),
    })
    if (prompts.isCancel(name)) throw new UI.CancelledError()

    const type = await prompts.select({
      message: t("mcp.select_server_type"),
      options: [
        {
          label: t("mcp.type_local"),
          value: "local",
          hint: t("mcp.type_local_hint"),
        },
        {
          label: t("mcp.type_remote"),
          value: "remote",
          hint: t("mcp.type_remote_hint"),
        },
      ],
    })
    if (prompts.isCancel(type)) throw new UI.CancelledError()

    if (type === "local") {
      const command = await prompts.text({
        message: t("mcp.enter_command"),
        placeholder: "e.g., opencode x @modelcontextprotocol/server-filesystem",
        validate: (x) => (x && x.length > 0 ? undefined : t("auth.required")),
      })
      if (prompts.isCancel(command)) throw new UI.CancelledError()

      prompts.log.info(t("mcp.local_configured", { name, command }))
      prompts.outro(t("mcp.server_added"))
      return
    }

    if (type === "remote") {
      const url = await prompts.text({
        message: t("mcp.enter_url"),
        placeholder: "e.g., https://example.com/mcp",
        validate: (x) => {
          if (!x) return t("auth.required")
          if (x.length === 0) return t("auth.required")
          const isValid = URL.canParse(x)
          return isValid ? undefined : t("mcp.invalid_url")
        },
      })
      if (prompts.isCancel(url)) throw new UI.CancelledError()

      const useOAuth = await prompts.confirm({
        message: t("mcp.requires_oauth"),
        initialValue: false,
      })
      if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()

      if (useOAuth) {
        const hasClientId = await prompts.confirm({
          message: t("mcp.has_client_id"),
          initialValue: false,
        })
        if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()

        if (hasClientId) {
          const clientId = await prompts.text({
            message: t("mcp.enter_client_id"),
            validate: (x) => (x && x.length > 0 ? undefined : t("auth.required")),
          })
          if (prompts.isCancel(clientId)) throw new UI.CancelledError()

          const hasSecret = await prompts.confirm({
            message: t("mcp.has_client_secret"),
            initialValue: false,
          })
          if (prompts.isCancel(hasSecret)) throw new UI.CancelledError()

          let clientSecret: string | undefined
          if (hasSecret) {
            const secret = await prompts.password({
              message: t("mcp.enter_client_secret"),
            })
            if (prompts.isCancel(secret)) throw new UI.CancelledError()
            clientSecret = secret
          }

          prompts.log.info(t("mcp.remote_configured_oauth", { name, clientId }))
          prompts.log.info(t("mcp.add_to_config"))
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
          prompts.log.info(t("mcp.remote_configured_dynamic", { name }))
          prompts.log.info(t("mcp.add_to_config"))
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
        prompts.log.info(t("mcp.remote_configured_url", { name, url }))
      }
    }

    prompts.outro(t("mcp.server_added"))
  },
})

export const McpDebugCommand = cmd({
  command: "debug <name>",
  describe: "debug OAuth connection for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro(t("mcp.oauth_debug"))

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const serverName = args.name

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(t("mcp.server_not_found", { name: serverName }))
          prompts.outro(t("upgrade.done"))
          return
        }

        if (!isMcpRemote(serverConfig)) {
          prompts.log.error(t("mcp.server_not_remote", { name: serverName }))
          prompts.outro(t("upgrade.done"))
          return
        }

        if (serverConfig.oauth === false) {
          prompts.log.warn(t("mcp.oauth_disabled", { name: serverName }))
          prompts.outro(t("upgrade.done"))
          return
        }

        prompts.log.info(t("mcp.server_label", { name: serverName }))
        prompts.log.info(t("mcp.url_label", { url: serverConfig.url }))

        // Check stored auth status
        const authStatus = await MCP.getAuthStatus(serverName)
        prompts.log.info(
          t("mcp.auth_status_label", { icon: getAuthStatusIcon(authStatus), status: getAuthStatusText(authStatus) }),
        )

        const entry = await McpAuth.get(serverName)
        if (entry?.tokens) {
          prompts.log.info(`  ${t("mcp.access_token", { token: entry.tokens.accessToken.substring(0, 20) })}`)
          if (entry.tokens.expiresAt) {
            const expiresDate = new Date(entry.tokens.expiresAt * 1000)
            const isExpired = entry.tokens.expiresAt < Date.now() / 1000
            prompts.log.info(
              `  ${t("mcp.expires", { date: expiresDate.toISOString() })} ${isExpired ? t("mcp.expired_label") : ""}`,
            )
          }
          if (entry.tokens.refreshToken) {
            prompts.log.info(`  ${t("mcp.refresh_token_present")}`)
          }
        }
        if (entry?.clientInfo) {
          prompts.log.info(`  ${t("mcp.client_id_label", { clientId: entry.clientInfo.clientId })}`)
          if (entry.clientInfo.clientSecretExpiresAt) {
            const expiresDate = new Date(entry.clientInfo.clientSecretExpiresAt * 1000)
            prompts.log.info(`  ${t("mcp.client_secret_expires", { date: expiresDate.toISOString() })}`)
          }
        }

        const spinner = prompts.spinner()
        spinner.start(t("mcp.testing_connection"))

        // Test basic HTTP connectivity first
        try {
          const response = await fetch(serverConfig.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "opencode-debug", version: Installation.VERSION },
              },
              id: 1,
            }),
          })

          spinner.stop(t("mcp.http_response", { status: String(response.status), statusText: response.statusText }))

          // Check for WWW-Authenticate header
          const wwwAuth = response.headers.get("www-authenticate")
          if (wwwAuth) {
            prompts.log.info(t("mcp.www_authenticate", { value: wwwAuth }))
          }

          if (response.status === 401) {
            prompts.log.warn(t("mcp.server_401"))

            // Try to discover OAuth metadata
            const oauthConfig = typeof serverConfig.oauth === "object" ? serverConfig.oauth : undefined
            const authProvider = new McpOAuthProvider(
              serverName,
              serverConfig.url,
              {
                clientId: oauthConfig?.clientId,
                clientSecret: oauthConfig?.clientSecret,
                scope: oauthConfig?.scope,
              },
              {
                onRedirect: async () => {},
              },
            )

            prompts.log.info(t("mcp.testing_oauth"))

            // Try creating transport with auth provider to trigger discovery
            const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
              authProvider,
            })

            try {
              const client = new Client({
                name: "opencode-debug",
                version: Installation.VERSION,
              })
              await client.connect(transport)
              prompts.log.success(t("mcp.connection_successful"))
              await client.close()
            } catch (error) {
              if (error instanceof UnauthorizedError) {
                prompts.log.info(t("mcp.oauth_triggered", { message: error.message }))

                // Check if dynamic registration would be attempted
                const clientInfo = await authProvider.clientInformation()
                if (clientInfo) {
                  prompts.log.info(t("mcp.client_id_available", { clientId: clientInfo.client_id }))
                } else {
                  prompts.log.info(t("mcp.no_client_id"))
                }
              } else {
                prompts.log.error(
                  t("mcp.connection_error", { error: error instanceof Error ? error.message : String(error) }),
                )
              }
            }
          } else if (response.status >= 200 && response.status < 300) {
            prompts.log.success(t("mcp.server_success"))
            const body = await response.text()
            try {
              const json = JSON.parse(body)
              if (json.result?.serverInfo) {
                prompts.log.info(t("mcp.server_info", { info: JSON.stringify(json.result.serverInfo) }))
              }
            } catch {
              // Not JSON, ignore
            }
          } else {
            prompts.log.warn(t("mcp.unexpected_status", { status: String(response.status) }))
            const body = await response.text().catch(() => "")
            if (body) {
              prompts.log.info(`Response body: ${body.substring(0, 500)}`)
            }
          }
        } catch (error) {
          spinner.stop(t("mcp.connection_failed"), 1)
          prompts.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }

        prompts.outro(t("mcp.debug_complete"))
      },
    })
  },
})
