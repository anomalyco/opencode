/**
 * ============================================================================
 * 文件名：mcp.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * MCP (Model Context Protocol) 管理命令模块。提供 MCP 服务器的管理功能。
 *
 * 主要功能：
 * - McpCommand：MCP 命令组
 * - McpAddCommand：添加 MCP 服务器
 * - McpListCommand：列出 MCP 服务器
 * - McpAuthCommand：OAuth 认证
 * - McpAuthListCommand：列出 OAuth 状态
 * - McpLogoutCommand：登出 OAuth
 * - McpDebugCommand：调试 OAuth 连接
 *
 * 依赖关系：
 * - ./cmd：命令包装
 * - @modelcontextprotocol/sdk/client：MCP SDK 客户端
 * - @modelcontextprotocol/sdk/client/streamableHttp：HTTP 传输
 * - @modelcontextprotocol/sdk/client/auth：认证
 * - @clack/prompts：交互式提示
 * - ../ui：UI 工具
 * - ../../mcp：MCP 集成
 * - ../../mcp/auth：MCP 认证
 * - ../../mcp/oauth-provider：OAuth 提供商
 * - ../../config/config：配置管理
 * - ../../project/instance：实例管理
 * - ../../installation：安装信息
 * - path：路径处理
 * - ../../global：全局配置
 * - jsonc-parser：JSONC 解析（保留注释）
 *
 * 导出内容：
 * - McpCommand：MCP 命令组
 * - McpAddCommand：添加命令
 * - McpListCommand：列出命令
 * - McpAuthCommand：认证命令
 * - McpAuthListCommand：认证列表命令
 * - McpLogoutCommand：登出命令
 * - McpDebugCommand：调试命令
 *
 * 支持的 MCP 服务器类型：
 * - local：本地命令（type: "local", command: string[]）
 * - remote：远程 URL（type: "remote", url: string）
 *
 * OAuth 认证状态：
 * - authenticated：已认证
 * - expired：已过期
 * - not_authenticated：未认证
 *
 * 服务器状态：
 * - connected：已连接
 * - disabled：已禁用
 * - needs_auth：需要认证
 * - needs_client_registration：需要客户端注册
 * - failed：失败
 *
 * @package opencode
 * @module cli/cmd/mcp
 */

// 导入命令包装
import { cmd } from "./cmd"

// 导入 MCP SDK 客户端
import { Client } from "@modelcontextprotocol/sdk/client/index.js"

// 导入 HTTP 传输
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

// 导入未授权错误
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"

// 导入交互式提示库
import * as prompts from "@clack/prompts"

// 导入 UI 工具
import { UI } from "../ui"

// 导入 MCP 集成
import { MCP } from "../../mcp"

// 导入 MCP 认证
import { McpAuth } from "../../mcp/auth"

// 导入 MCP OAuth 提供商
import { McpOAuthProvider } from "../../mcp/oauth-provider"

// 导入配置管理
import { Config } from "../../config/config"

// 导入实例管理
import { Instance } from "../../project/instance"

// 导入安装信息
import { Installation } from "../../installation"

// 导入路径处理
import path from "path"

// 导入全局配置
import { Global } from "../../global"

// 导入 JSONC 解析器
import { modify, applyEdits } from "jsonc-parser"

/**
 * 获取认证状态图标
 *
 * @param status - 认证状态
 * @returns 状态图标字符
 */
function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓" // 已认证
    case "expired":
      return "⚠" // 已过期
    case "not_authenticated":
      return "○" // 未认证
  }
}

/**
 * 获取认证状态文本
 *
 * @param status - 认证状态
 * @returns 状态文本
 */
function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "authenticated"
    case "expired":
      return "expired"
    case "not_authenticated":
      return "not authenticated"
  }
}

/**
 * MCP 条目类型
 */
type McpEntry = NonNullable<Config.Info["mcp"]>[string]

/**
 * 已配置的 MCP 类型
 */
type McpConfigured = Config.Mcp

/**
 * 类型守卫：检查是否为已配置的 MCP
 *
 * @param config - MCP 配置条目
 * @returns 是否为已配置的 MCP
 */
function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

/**
 * 远程 MCP 类型
 */
type McpRemote = Extract<McpConfigured, { type: "remote" }>

/**
 * 类型守卫：检查是否为远程 MCP
 *
 * @param config - MCP 配置条目
 * @returns 是否为远程 MCP
 */
function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
}

/**
 * MCP 命令组
 *
 * 管理 MCP 服务器的父命令。
 */
export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
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

/**
 * MCP 列出命令
 *
 * 列出所有 MCP 服务器及其状态。
 */
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

        // 获取配置
        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        // 获取所有服务器状态
        const statuses = await MCP.status()

        // 过滤出已配置的服务器
        const servers = Object.entries(mcpServers).filter((entry): entry is [string, McpConfigured] =>
          isMcpConfigured(entry[1]),
        )

        // 如果没有服务器，显示提示
        if (servers.length === 0) {
          prompts.log.warn("No MCP servers configured")
          prompts.outro("Add servers with: opencode mcp add")
          return
        }

        // 遍历并显示每个服务器
        for (const [name, serverConfig] of servers) {
          const status = statuses[name]
          // 检查是否支持 OAuth
          const hasOAuth = isMcpRemote(serverConfig) && !!serverConfig.oauth
          // 检查是否有存储的令牌
          const hasStoredTokens = await MCP.hasStoredTokens(name)

          let statusIcon: string
          let statusText: string
          let hint = ""

          // 根据状态确定图标和文本
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

          // 构建类型提示（URL 或命令）
          const typeHint = serverConfig.type === "remote" ? serverConfig.url : serverConfig.command.join(" ")
          // 显示服务器信息
          prompts.log.info(
            `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
          )
        }

        prompts.outro(`${servers.length} server(s)`)
      },
    })
  },
})

/**
 * MCP 认证命令
 *
 * 对支持 OAuth 的 MCP 服务器进行认证。
 */
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
        prompts.intro("MCP OAuth Authentication")

        // 获取配置
        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // 获取支持 OAuth 的服务器（远程服务器且 oauth 未显式禁用）
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        // 如果没有 OAuth 服务器，显示提示
        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.log.info("Remote MCP servers support OAuth by default. Add a remote server in opencode.json:")
          prompts.log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }`)
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        // 如果没有指定服务器名，让用户选择
        if (!serverName) {
          // 构建带有认证状态的选项
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
            message: "Select MCP server to authenticate",
            options,
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        // 获取服务器配置
        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        // 验证服务器支持 OAuth
        if (!isMcpRemote(serverConfig) || serverConfig.oauth === false) {
          prompts.log.error(`MCP server ${serverName} is not an OAuth-capable remote server`)
          prompts.outro("Done")
          return
        }

        // 检查是否已认证
        const authStatus = await MCP.getAuthStatus(serverName)
        if (authStatus === "authenticated") {
          const confirm = await prompts.confirm({
            message: `${serverName} already has valid credentials. Re-authenticate?`,
          })
          if (prompts.isCancel(confirm) || !confirm) {
            prompts.outro("Cancelled")
            return
          }
        } else if (authStatus === "expired") {
          prompts.log.warn(`${serverName} has expired credentials. Re-authenticating...`)
        }

        const spinner = prompts.spinner()
        spinner.start("Starting OAuth flow...")

        try {
          // 执行认证
          const status = await MCP.authenticate(serverName)

          // 处理认证结果
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

/**
 * MCP 认证列表命令
 *
 * 列出支持 OAuth 的 MCP 服务器及其认证状态。
 */
export const McpAuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list OAuth-capable MCP servers and their auth status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Status")

        // 获取配置
        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // 获取支持 OAuth 的服务器
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        // 如果没有 OAuth 服务器，显示提示
        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.outro("Done")
          return
        }

        // 遍历并显示每个 OAuth 服务器
        for (const [name, serverConfig] of oauthServers) {
          const authStatus = await MCP.getAuthStatus(name)
          const icon = getAuthStatusIcon(authStatus)
          const statusText = getAuthStatusText(authStatus)
          const url = serverConfig.url

          prompts.log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${statusText}\n    ${UI.Style.TEXT_DIM}${url}`)
        }

        prompts.outro(`${oauthServers.length} OAuth-capable server(s)`)
      },
    })
  },
})

/**
 * MCP 登出命令
 *
 * 移除 MCP 服务器的 OAuth 凭证。
 */
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

        // 获取认证文件路径
        const authPath = path.join(Global.Path.data, "mcp-auth.json")
        // 获取所有凭证
        const credentials = await McpAuth.all()
        const serverNames = Object.keys(credentials)

        // 如果没有凭证，显示提示
        if (serverNames.length === 0) {
          prompts.log.warn("No MCP OAuth credentials stored")
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        // 如果没有指定服务器名，让用户选择
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

        // 检查凭证是否存在
        if (!credentials[serverName]) {
          prompts.log.error(`No credentials found for: ${serverName}`)
          prompts.outro("Done")
          return
        }

        // 移除凭证
        await MCP.removeAuth(serverName)
        prompts.log.success(`Removed OAuth credentials for ${serverName}`)
        prompts.outro("Done")
      },
    })
  },
})

/**
 * 解析配置文件路径
 *
 * 优先使用已存在的配置文件（.jsonc 优于 .json）。
 * 对于非全局配置，也检查 .opencode/ 子目录。
 *
 * @param baseDir - 基础目录
 * @param global - 是否为全局配置
 * @returns 配置文件路径
 */
async function resolveConfigPath(baseDir: string, global = false) {
  // 检查已存在的配置文件（优先 .jsonc 而非 .json，也检查 .opencode/ 子目录）
  const candidates = [
    path.join(baseDir, "opencode.json"),
    path.join(baseDir, "opencode.jsonc"),
  ]

  // 非全局配置时，也检查项目子目录
  if (!global) {
    candidates.push(
      path.join(baseDir, ".opencode", "opencode.json"),
      path.join(baseDir, ".opencode", "opencode.jsonc"),
    )
  }

  // 返回第一个存在的文件
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return candidate
    }
  }

  // 如果都不存在，默认为 opencode.json
  return candidates[0]
}

/**
 * 添加 MCP 配置到文件
 *
 * 使用 jsonc-parser 保留注释。
 *
 * @param name - MCP 服务器名称
 * @param mcpConfig - MCP 配置
 * @param configPath - 配置文件路径
 * @returns 配置文件路径
 */
async function addMcpToConfig(name: string, mcpConfig: Config.Mcp, configPath: string) {
  const file = Bun.file(configPath)

  let text = "{}"
  // 如果文件存在，读取内容
  if (await file.exists()) {
    text = await file.text()
  }

  // 使用 jsonc-parser 修改配置（保留注释）
  const edits = modify(text, ["mcp", name], mcpConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  // 写入文件
  await Bun.write(configPath, result)

  return configPath
}

/**
 * MCP 添加命令
 *
 * 添加一个新的 MCP 服务器配置。
 */
export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add MCP server")

        const project = Instance.project

        // 提前解析配置路径用于提示
        const [projectConfigPath, globalConfigPath] = await Promise.all([
          resolveConfigPath(Instance.worktree),
          resolveConfigPath(Global.Path.config, true),
        ])

        // 确定作用域
        let configPath = globalConfigPath
        if (project.vcs === "git") {
          const scopeResult = await prompts.select({
            message: "Location",
            options: [
              {
                label: "Current project",
                value: projectConfigPath,
                hint: projectConfigPath,
              },
              {
                label: "Global",
                value: globalConfigPath,
                hint: globalConfigPath,
              },
            ],
          })
          if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
          configPath = scopeResult
        }

        // 获取服务器名称
        const name = await prompts.text({
          message: "Enter MCP server name",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(name)) throw new UI.CancelledError()

        // 选择服务器类型
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

        // 处理本地服务器
        if (type === "local") {
          const command = await prompts.text({
            message: "Enter command to run",
            placeholder: "e.g., opencode x @modelcontextprotocol/server-filesystem",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(command)) throw new UI.CancelledError()

          // 构建本地 MCP 配置
          const mcpConfig: Config.Mcp = {
            type: "local",
            command: command.split(" "),
          }

          await addMcpToConfig(name, mcpConfig, configPath)
          prompts.log.success(`MCP server "${name}" added to ${configPath}`)
          prompts.outro("MCP server added successfully")
          return
        }

        // 处理远程服务器
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

          // 询问是否需要 OAuth
          const useOAuth = await prompts.confirm({
            message: "Does this server require OAuth authentication?",
            initialValue: false,
          })
          if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()

          let mcpConfig: Config.Mcp

          // 处理 OAuth 配置
          if (useOAuth) {
            const hasClientId = await prompts.confirm({
              message: "Do you have a pre-registered client ID?",
              initialValue: false,
            })
            if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()

            if (hasClientId) {
              // 获取客户端 ID
              const clientId = await prompts.text({
                message: "Enter client ID",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(clientId)) throw new UI.CancelledError()

              // 询问是否有客户端密钥
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

              // 构建 OAuth 配置
              mcpConfig = {
                type: "remote",
                url,
                oauth: {
                  clientId,
                  ...(clientSecret && { clientSecret }),
                },
              }
            } else {
              // 动态注册
              mcpConfig = {
                type: "remote",
                url,
                oauth: {},
              }
            }
          } else {
            // 无 OAuth
            mcpConfig = {
              type: "remote",
              url,
            }
          }

          await addMcpToConfig(name, mcpConfig, configPath)
          prompts.log.success(`MCP server "${name}" added to ${configPath}`)
        }

        prompts.outro("MCP server added successfully")
      },
    })
  },
})

/**
 * MCP 调试命令
 *
 * 调试 MCP 服务器的 OAuth 连接。
 */
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
        prompts.intro("MCP OAuth Debug")

        // 获取配置
        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const serverName = args.name

        // 获取服务器配置
        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        // 验证是远程服务器
        if (!isMcpRemote(serverConfig)) {
          prompts.log.error(`MCP server ${serverName} is not a remote server`)
          prompts.outro("Done")
          return
        }

        // 检查 OAuth 是否被禁用
        if (serverConfig.oauth === false) {
          prompts.log.warn(`MCP server ${serverName} has OAuth explicitly disabled`)
          prompts.outro("Done")
          return
        }

        // 显示服务器信息
        prompts.log.info(`Server: ${serverName}`)
        prompts.log.info(`URL: ${serverConfig.url}`)

        // 检查存储的认证状态
        const authStatus = await MCP.getAuthStatus(serverName)
        prompts.log.info(`Auth status: ${getAuthStatusIcon(authStatus)} ${getAuthStatusText(authStatus)}`)

        // 显示凭证详情
        const entry = await McpAuth.get(serverName)
        if (entry?.tokens) {
          prompts.log.info(`  Access token: ${entry.tokens.accessToken.substring(0, 20)}...`)
          if (entry.tokens.expiresAt) {
            const expiresDate = new Date(entry.tokens.expiresAt * 1000)
            const isExpired = entry.tokens.expiresAt < Date.now() / 1000
            prompts.log.info(`  Expires: ${expiresDate.toISOString()} ${isExpired ? "(EXPIRED)" : ""}`)
          }
          if (entry.tokens.refreshToken) {
            prompts.log.info(`  Refresh token: present`)
          }
        }
        if (entry?.clientInfo) {
          prompts.log.info(`  Client ID: ${entry.clientInfo.clientId}`)
          if (entry.clientInfo.clientSecretExpiresAt) {
            const expiresDate = new Date(entry.clientInfo.clientSecretExpiresAt * 1000)
            prompts.log.info(`  Client secret expires: ${expiresDate.toISOString()}`)
          }
        }

        const spinner = prompts.spinner()
        spinner.start("Testing connection...")

        // 首先测试基本的 HTTP 连接
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

          spinner.stop(`HTTP response: ${response.status} ${response.statusText}`)

          // 检查 WWW-Authenticate 头
          const wwwAuth = response.headers.get("www-authenticate")
          if (wwwAuth) {
            prompts.log.info(`WWW-Authenticate: ${wwwAuth}`)
          }

          // 处理 401 未授权
          if (response.status === 401) {
            prompts.log.warn("Server returned 401 Unauthorized")

            // 尝试发现 OAuth 元数据
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

            prompts.log.info("Testing OAuth flow (without completing authorization)...")

            // 尝试创建传输以触发发现
            const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
              authProvider,
            })

            try {
              const client = new Client({
                name: "opencode-debug",
                version: Installation.VERSION,
              })
              await client.connect(transport)
              prompts.log.success("Connection successful (already authenticated)")
              await client.close()
            } catch (error) {
              if (error instanceof UnauthorizedError) {
                prompts.log.info(`OAuth flow triggered: ${error.message}`)

                // 检查是否会尝试动态注册
                const clientInfo = await authProvider.clientInformation()
                if (clientInfo) {
                  prompts.log.info(`Client ID available: ${clientInfo.client_id}`)
                } else {
                  prompts.log.info("No client ID - dynamic registration will be attempted")
                }
              } else {
                prompts.log.error(`Connection error: ${error instanceof Error ? error.message : String(error)}`)
              }
            }
          }
          // 处理成功响应（2xx）
          else if (response.status >= 200 && response.status < 300) {
            prompts.log.success("Server responded successfully (no auth required or already authenticated)")
            const body = await response.text()
            try {
              const json = JSON.parse(body)
              if (json.result?.serverInfo) {
                prompts.log.info(`Server info: ${JSON.stringify(json.result.serverInfo)}`)
              }
            } catch {
              // 不是 JSON，忽略
            }
          }
          // 处理其他状态码
          else {
            prompts.log.warn(`Unexpected status: ${response.status}`)
            const body = await response.text().catch(() => "")
            if (body) {
              prompts.log.info(`Response body: ${body.substring(0, 500)}`)
            }
          }
        } catch (error) {
          spinner.stop("Connection failed", 1)
          prompts.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }

        prompts.outro("Debug complete")
      },
    })
  },
})
