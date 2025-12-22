import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import path from "path"
import os from "os"
import { Global } from "../../global"

async function findMcpConfigFile(serverName: string): Promise<string | null> {
  const configFiles = [
    path.join(Instance.directory, "opencode.json"),
    path.join(Instance.directory, "opencode.jsonc"),
    ...(await Filesystem.findUp("opencode.json", Instance.directory, Instance.worktree)),
    ...(await Filesystem.findUp("opencode.jsonc", Instance.directory, Instance.worktree)),
    ...(
      await Array.fromAsync(
        Filesystem.up({
          targets: [".opencode"],
          start: Instance.directory,
          stop: Instance.worktree,
        }),
      )
    ).flatMap((dir) => [path.join(dir, "opencode.json"), path.join(dir, "opencode.jsonc")]),
    path.join(Global.Path.config, "opencode.json"),
    path.join(Global.Path.config, "opencode.jsonc"),
  ]

  for (const configPath of configFiles) {
    try {
      const fileConfig = await Bun.file(configPath).json()
      if (fileConfig.mcp?.[serverName]) return configPath
    } catch {}
  }

  return null
}

async function getTargetConfigFile(): Promise<string> {
  const localConfig = path.join(Instance.directory, "opencode.json")
  if (!(await Bun.file(localConfig).exists())) {
    await Bun.write(localConfig, JSON.stringify({ mcp: {} }, null, 2))
  }
  return localConfig
}

export const McpCommand = cmd({
  command: "mcp",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpEnableCommand)
      .command(McpDisableCommand)
      .command(McpToggleCommand)
      .command(McpInfoCommand)
      .command(McpRemoveCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpCompletionCommand)
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

          const configFile = await findMcpConfigFile(name)
          const configLocation = configFile
            ? configFile.startsWith(Global.Path.config)
              ? "global"
              : path.relative(Instance.directory, configFile) || "local"
            : "unknown"

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
          const locationHint = ` [${configLocation}]`
          prompts.log.info(
            `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${locationHint}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
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

        // Get OAuth-enabled servers
        const oauthServers = Object.entries(mcpServers).filter(([_, cfg]) => cfg.type === "remote" && !!cfg.oauth)

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

export const McpEnableCommand = cmd({
  command: "enable <name>",
  describe: "enable an MCP server",
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
        prompts.intro("Enable MCP Server")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        if (!mcpServers[args.name]) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        const configPath = await getTargetConfigFile()

        const fileConfig = await Bun.file(configPath)
          .json()
          .catch(() => ({}))

        if (!fileConfig.mcp) fileConfig.mcp = {}
        if (!fileConfig.mcp[args.name]) {
          fileConfig.mcp[args.name] = mcpServers[args.name]
        }

        fileConfig.mcp[args.name].enabled = true

        await Bun.write(configPath, JSON.stringify(fileConfig, null, 2))
        await Instance.dispose()

        const location = configPath.startsWith(Global.Path.config)
          ? "global"
          : path.relative(Instance.directory, configPath) || "local"
        prompts.log.success(`Enabled MCP: ${args.name} [${location}]`)
        prompts.outro("Done")
      },
    })
  },
})

export const McpDisableCommand = cmd({
  command: "disable <name>",
  describe: "disable an MCP server",
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
        prompts.intro("Disable MCP Server")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        if (!mcpServers[args.name]) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        // Always write to nearest config file (current directory)
        const configPath = await getTargetConfigFile()

        const fileConfig = await Bun.file(configPath)
          .json()
          .catch(() => ({}))

        if (!fileConfig.mcp) fileConfig.mcp = {}
        if (!fileConfig.mcp[args.name]) {
          fileConfig.mcp[args.name] = mcpServers[args.name]
        }

        fileConfig.mcp[args.name].enabled = false

        await Bun.write(configPath, JSON.stringify(fileConfig, null, 2))
        await Instance.dispose()

        const location = configPath.startsWith(Global.Path.config)
          ? "global"
          : path.relative(Instance.directory, configPath) || "local"
        prompts.log.success(`Disabled MCP: ${args.name} [${location}]`)
        prompts.outro("Done")
      },
    })
  },
})

export const McpToggleCommand = cmd({
  command: "toggle <name>",
  describe: "toggle MCP server enabled/disabled state",
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
        prompts.intro("Toggle MCP Server")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        if (!mcpServers[args.name]) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        const currentEnabled = mcpServers[args.name].enabled ?? true
        const newState = !currentEnabled

        const configPath = await getTargetConfigFile()

        const fileConfig = await Bun.file(configPath)
          .json()
          .catch(() => ({}))

        if (!fileConfig.mcp) fileConfig.mcp = {}
        if (!fileConfig.mcp[args.name]) {
          fileConfig.mcp[args.name] = mcpServers[args.name]
        }

        fileConfig.mcp[args.name].enabled = newState

        await Bun.write(configPath, JSON.stringify(fileConfig, null, 2))
        await Instance.dispose()

        const location = configPath.startsWith(Global.Path.config)
          ? "global"
          : path.relative(Instance.directory, configPath) || "local"
        prompts.log.success(`${newState ? "Enabled" : "Disabled"} MCP: ${args.name} [${location}]`)
        prompts.outro("Done")
      },
    })
  },
})

export const McpInfoCommand = cmd({
  command: "info <name>",
  describe: "show details about an MCP server",
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
        prompts.intro(`MCP Server: ${args.name}`)

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        if (!mcpServers[args.name]) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        const serverConfig = mcpServers[args.name]
        const enabled = serverConfig.enabled ?? true
        const statuses = await MCP.status()
        const status = statuses[args.name]

        const configPath = await findMcpConfigFile(args.name)
        const configLocation = configPath
          ? configPath.startsWith(Global.Path.config)
            ? "global"
            : path.relative(Instance.directory, configPath) || "local"
          : "unknown"

        prompts.log.info(`${UI.Style.TEXT_DIM}Enabled:${UI.Style.TEXT_NORMAL}  ${enabled ? "✓ Yes" : "✗ No"}`)
        prompts.log.info(`${UI.Style.TEXT_DIM}Type:${UI.Style.TEXT_NORMAL}     ${serverConfig.type}`)
        prompts.log.info(`${UI.Style.TEXT_DIM}Config:${UI.Style.TEXT_NORMAL}   ${configLocation}`)

        if (serverConfig.type === "local") {
          prompts.log.info(`${UI.Style.TEXT_DIM}Command:${UI.Style.TEXT_NORMAL}  ${serverConfig.command.join(" ")}`)
          if (serverConfig.environment) {
            prompts.log.info(`${UI.Style.TEXT_DIM}Environment:`)
            Object.entries(serverConfig.environment).forEach(([key, value]) => {
              prompts.log.info(`  ${key}=${value}`)
            })
          }
        } else if (serverConfig.type === "remote") {
          prompts.log.info(`${UI.Style.TEXT_DIM}URL:${UI.Style.TEXT_NORMAL}      ${serverConfig.url}`)
          if (serverConfig.oauth) {
            prompts.log.info(
              `${UI.Style.TEXT_DIM}OAuth:${UI.Style.TEXT_NORMAL}    ${serverConfig.oauth ? "✓ Configured" : "✗ Not configured"}`,
            )
            const hasStoredTokens = await MCP.hasStoredTokens(args.name)
            if (hasStoredTokens) {
              prompts.log.info(`${UI.Style.TEXT_DIM}Auth:${UI.Style.TEXT_NORMAL}     ✓ Authenticated`)
            }
          }
        }

        if (status) {
          let statusText = status.status
          if (status.status === "failed" && status.error) {
            statusText += `: ${status.error}`
          }
          prompts.log.info(`${UI.Style.TEXT_DIM}Status:${UI.Style.TEXT_NORMAL}  ${statusText}`)
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpRemoveCommand = cmd({
  command: "remove <name>",
  describe: "remove an MCP server",
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
        prompts.intro("Remove MCP Server")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        if (!mcpServers[args.name]) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        const configPath = await findMcpConfigFile(args.name)
        if (!configPath) {
          prompts.log.error(`Could not find config file for MCP: ${args.name}`)
          prompts.outro("Done")
          return
        }

        const location = configPath.startsWith(Global.Path.config)
          ? "global"
          : path.relative(Instance.directory, configPath) || "local"

        const confirm = await prompts.confirm({
          message: `Remove '${args.name}' from ${location} config?`,
          initialValue: false,
        })

        if (prompts.isCancel(confirm) || !confirm) {
          prompts.outro("Cancelled")
          return
        }

        const fileConfig = await Bun.file(configPath)
          .json()
          .catch(() => ({}))

        if (fileConfig.mcp && fileConfig.mcp[args.name]) {
          delete fileConfig.mcp[args.name]
          await Bun.write(configPath, JSON.stringify(fileConfig, null, 2))
          await Instance.dispose()
          prompts.log.success(`Removed MCP: ${args.name} [${location}]`)
        } else {
          prompts.log.error(`MCP '${args.name}' not found in ${configPath}`)
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add MCP server")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        const name = await prompts.text({
          message: "Enter MCP server name",
          validate: (x) => {
            if (!x || x.length === 0) return "Required"
            if (mcpServers[x]) return `MCP server '${x}' already exists`
            return undefined
          },
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

        const configPath = await getTargetConfigFile()
        const fileConfig = await Bun.file(configPath)
          .json()
          .catch(() => ({}))

        if (!fileConfig.mcp) fileConfig.mcp = {}

        if (type === "local") {
          const commandStr = await prompts.text({
            message: "Enter command to run",
            placeholder: "e.g., npx @modelcontextprotocol/server-filesystem",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(commandStr)) throw new UI.CancelledError()

          fileConfig.mcp[name] = {
            type: "local",
            command: commandStr.split(" "),
            enabled: true,
          }

          await Bun.write(configPath, JSON.stringify(fileConfig, null, 2))
          await Instance.dispose()

          prompts.log.success(`Added local MCP server: ${name}`)
          prompts.log.info(`Command: ${commandStr}`)
          prompts.outro("Done")
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

          const mcpConfig: any = {
            type: "remote",
            url,
            enabled: true,
          }

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

              mcpConfig.oauth = { clientId }

              if (hasSecret) {
                const secret = await prompts.password({
                  message: "Enter client secret",
                })
                if (prompts.isCancel(secret)) throw new UI.CancelledError()
                mcpConfig.oauth.clientSecret = secret
              }
            } else {
              mcpConfig.oauth = {}
            }
          } else {
            const client = new Client({
              name: "opencode",
              version: "1.0.0",
            })
            const transport = new StreamableHTTPClientTransport(new URL(url))
            await client.connect(transport)
          }

          fileConfig.mcp[name] = mcpConfig

          await Bun.write(configPath, JSON.stringify(fileConfig, null, 2))
          await Instance.dispose()

          prompts.log.success(`Added remote MCP server: ${name}`)
          prompts.log.info(`URL: ${url}`)
          if (mcpConfig.oauth) {
            prompts.log.info("OAuth: Configured")
          }
          prompts.outro("Done")
        }
      },
    })
  },
})

export const McpCompletionCommand = cmd({
  command: "completion [shell]",
  describe: "generate shell completion script",
  builder: (yargs) =>
    yargs.positional("shell", {
      describe: "shell type (bash, zsh, fish)",
      type: "string",
      choices: ["bash", "zsh", "fish"],
    }),
  async handler(args) {
    const shell =
      args.shell ||
      (() => {
        const shellEnv = process.env.SHELL || ""
        if (shellEnv.includes("bash")) return "bash"
        if (shellEnv.includes("zsh")) return "zsh"
        if (shellEnv.includes("fish")) return "fish"
        return "bash"
      })()

    const bashCompletion = `_opencode_mcp_complete() {
    local cur prev tools actions
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # Get MCP tools from config
    local config_file
    if [[ -f "opencode.json" ]]; then
        config_file="opencode.json"
    elif [[ -f "$HOME/.config/opencode/opencode.json" ]]; then
        config_file="$HOME/.config/opencode/opencode.json"
    fi

    if [[ -n "$config_file" ]] && command -v jq &> /dev/null; then
        tools=$(jq -r '.mcp | keys[]' "$config_file" 2>/dev/null)
    fi

    actions="add list enable disable toggle info remove auth logout completion"

    if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "$actions" -- "$cur") )
    elif [[ $COMP_CWORD -eq 3 ]]; then
        case "$prev" in
            enable|disable|toggle|info|remove|auth|logout)
                COMPREPLY=( $(compgen -W "$tools" -- "$cur") )
                ;;
            completion)
                COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
                ;;
        esac
    fi
}

complete -F _opencode_mcp_complete opencode`

    const zshCompletion = `#compdef opencode

_opencode_mcp() {
    local -a actions tools
    actions=(
        'add:add an MCP server'
        'list:list MCP servers and their status'
        'enable:enable an MCP server'
        'disable:disable an MCP server'
        'toggle:toggle MCP server enabled/disabled state'
        'info:show details about an MCP server'
        'remove:remove an MCP server'
        'auth:authenticate with an OAuth-enabled MCP server'
        'logout:remove OAuth credentials for an MCP server'
        'completion:generate shell completion script'
    )

    # Get MCP tools from config
    local config_file
    if [[ -f "opencode.json" ]]; then
        config_file="opencode.json"
    elif [[ -f "$HOME/.config/opencode/opencode.json" ]]; then
        config_file="$HOME/.config/opencode/opencode.json"
    fi

    if [[ -n "$config_file" ]] && command -v jq &> /dev/null; then
        tools=($(jq -r '.mcp | keys[]' "$config_file" 2>/dev/null))
    fi

    case $CURRENT in
        3)
            _describe 'mcp command' actions
            ;;
        4)
            case $words[3] in
                enable|disable|toggle|info|remove|auth|logout)
                    _describe 'mcp server' tools
                    ;;
                completion)
                    _values 'shell' bash zsh fish
                    ;;
            esac
            ;;
    esac
}

_opencode_mcp "$@"`

    const fishCompletion = `# opencode mcp completion

# Subcommands
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "add" -d "add an MCP server"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "list" -d "list MCP servers and their status"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "enable" -d "enable an MCP server"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "disable" -d "disable an MCP server"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "toggle" -d "toggle MCP server enabled/disabled state"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "info" -d "show details about an MCP server"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "remove" -d "remove an MCP server"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "auth" -d "authenticate with an OAuth-enabled MCP server"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "logout" -d "remove OAuth credentials"
complete -c opencode -n "__fish_seen_subcommand_from mcp" -a "completion" -d "generate shell completion script"

# Dynamic MCP server names
function __opencode_mcp_servers
    set -l config_file
    if test -f opencode.json
        set config_file opencode.json
    else if test -f ~/.config/opencode/opencode.json
        set config_file ~/.config/opencode/opencode.json
    end

    if test -n "$config_file"; and command -v jq &> /dev/null
        jq -r '.mcp | keys[]' $config_file 2>/dev/null
    end
end

complete -c opencode -n "__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from enable disable toggle info remove auth logout" -a "(__opencode_mcp_servers)"
complete -c opencode -n "__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from completion" -a "bash zsh fish"`

    const completions: Record<string, string> = {
      bash: bashCompletion,
      zsh: zshCompletion,
      fish: fishCompletion,
    }

    console.log(completions[shell])

    if (!args.shell) {
      console.log("\n# To install, add this to your shell config:")
      if (shell === "bash") {
        console.log("# For bash: Add to ~/.bashrc")
        console.log(`# eval "$(opencode mcp completion bash)"`)
      } else if (shell === "zsh") {
        console.log("# For zsh: Add to ~/.zshrc")
        console.log(`# eval "$(opencode mcp completion zsh)"`)
      } else if (shell === "fish") {
        console.log("# For fish: Save to ~/.config/fish/completions/opencode-mcp.fish")
        console.log(`# opencode mcp completion fish > ~/.config/fish/completions/opencode-mcp.fish`)
      }
    }
  },
})
