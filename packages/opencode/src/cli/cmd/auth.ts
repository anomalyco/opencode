/**
 * ============================================================================
 * 文件名：auth.ts
 * 所属包：packages/opencode/src/cli/cmd
 * ============================================================================
 *
 * 文件作用：
 * 认证管理命令模块。提供用户登录、登出和列出凭证的 CLI 命令。
 *
 * 主要功能：
 * - AuthLoginCommand：登录到提供商
 * - AuthLogoutCommand：从提供商登出
 * - AuthListCommand：列出所有凭证
 * - AuthCommand：认证管理命令组
 * - handlePluginAuth()：处理插件认证流程
 *
 * 依赖关系：
 * - ../../auth：认证管理
 * - ./cmd：命令包装
 * - @clack/prompts：交互式提示
 * - ../ui：UI 工具
 * - ../../provider/models：模型数据库
 * - remeda：数据处理工具
 * - path：路径处理
 * - os：操作系统信息
 * - ../../config/config：配置管理
 * - ../../global：全局配置
 * - ../../plugin：插件管理
 * - ../../project/instance：实例管理
 * - @opencode-ai/plugin：插件类型
 *
 * 导出内容：
 * - AuthCommand：认证命令组
 * - AuthLoginCommand：登录命令
 * - AuthLogoutCommand：登出命令
 * - AuthListCommand：列出命令
 * - handlePluginAuth()：插件认证处理函数
 *
 * 认证类型：
 * - oauth：OAuth 认证（支持 auto 和 code 两种方法）
 * - api：API Key 认证
 * - wellknown：well-known 配置认证
 *
 * 环境变量：
 * - 自动检测并显示已设置的环境变量凭证
 *
 * 特殊提供商处理：
 * - amazon-bedrock：AWS 凭证链
 * - opencode：OpenCode API Key
 * - vercel：Vercel API Gateway
 * - cloudflare：Cloudflare AI Gateway
 *
 * @package opencode
 * @module cli/cmd/auth
 */

// 导入认证管理
import { Auth } from "../../auth"

// 导入命令包装
import { cmd } from "./cmd"

// 导入交互式提示库
import * as prompts from "@clack/prompts"

// 导入 UI 工具
import { UI } from "../ui"

// 导入模型开发数据库
import { ModelsDev } from "../../provider/models"

// 导入数据处理工具
import { map, pipe, sortBy, values } from "remeda"

// 导入路径处理
import path from "path"

// 导入操作系统信息
import os from "os"

// 导入配置管理
import { Config } from "../../config/config"

// 导入全局配置
import { Global } from "../../global"

// 导入插件管理
import { Plugin } from "../../plugin"

// 导入实例管理
import { Instance } from "../../project/instance"

// 导入插件类型
import type { Hooks } from "@opencode-ai/plugin"

/**
 * 插件认证类型
 *
 * 从插件 Hooks 类型中提取 auth 类型。
 */
type PluginAuth = NonNullable<Hooks["auth"]>

/**
 * 处理基于插件的认证流程
 *
 * 处理插件提供的认证方法，支持 OAuth 和 API Key 两种类型。
 *
 * @param plugin - 包含认证配置的插件对象
 * @param provider - 提供商 ID
 * @returns Promise，解析为 true 如果已处理认证，false 表示应该回退到默认处理
 *
 * 认证流程：
 * 1. 如果有多个认证方法，让用户选择
 * 2. 收集所有必需的输入（prompts）
 * 3. 执行认证（OAuth 或 API Key）
 * 4. 保存凭证
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string): Promise<boolean> {
  let index = 0
  // 如果有多个认证方法，让用户选择
  if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
        // 将每个方法映射为选项
        ...plugin.auth.methods.map((x, index) => ({
          label: x.label,
          value: index.toString(),
        })),
      ],
    })
    if (prompts.isCancel(method)) throw new UI.CancelledError()
    index = parseInt(method)
  }
  const method = plugin.auth.methods[index]

  // 处理所有认证类型的输入提示
  await Bun.sleep(10)
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    // 遍历所有提示
    for (const prompt of method.prompts) {
      // 检查条件，如果条件不满足则跳过
      if (prompt.condition && !prompt.condition(inputs)) {
        continue
      }
      if (prompt.type === "select") {
        // 下拉选择提示
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      } else {
        // 文本输入提示
        const value = await prompts.text({
          message: prompt.message,
          placeholder: prompt.placeholder,
          validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      }
    }
  }

  // 处理 OAuth 认证类型
  if (method.type === "oauth") {
    // 获取授权配置
    const authorize = await method.authorize(inputs)

    // 如果有 URL，显示给用户
    if (authorize.url) {
      prompts.log.info("Go to: " + authorize.url)
    }

    // 处理自动授权方法（如 PKCE）
    if (authorize.method === "auto") {
      // 如果有说明，显示给用户
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      // 显示加载动画，等待授权完成
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
      }
      if (result.type === "success") {
        // 确定要保存的提供商 ID
        const saveProvider = result.provider ?? provider
        // 如果有 refresh token，保存 OAuth 凭证
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        // 如果有 API key，保存 API 凭证
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        spinner.stop("Login successful")
      }
    }

    // 处理授权码方法（如设备码流）
    if (authorize.method === "code") {
      // 让用户粘贴授权码
      const code = await prompts.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) throw new UI.CancelledError()
      const result = await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        // 确定要保存的提供商 ID
        const saveProvider = result.provider ?? provider
        // 如果有 refresh token，保存 OAuth 凭证
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        // 如果有 API key，保存 API 凭证
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        prompts.log.success("Login successful")
      }
    }

    prompts.outro("Done")
    return true
  }

  // 处理 API Key 认证类型
  if (method.type === "api") {
    // 如果有自定义授权流程
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        // 确定要保存的提供商 ID
        const saveProvider = result.provider ?? provider
        await Auth.set(saveProvider, {
          type: "api",
          key: result.key,
        })
        prompts.log.success("Login successful")
      }
      prompts.outro("Done")
      return true
    }
  }

  // 返回 false 表示应该回退到默认处理
  return false
}

/**
 * 认证命令组
 *
 * 管理凭证的父命令。
 */
export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() {},
})

/**
 * 认证列出命令
 *
 * 列出所有已配置的凭证和活动环境变量。
 */
export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    // 构建认证文件路径
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    // 将主目录替换为 ~ 以显示更友好的路径
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    // 获取所有凭证
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    // 显示每个凭证
    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // 环境变量部分
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    // 查找所有已设置的环境变量凭证
    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    // 如果有活动环境变量，显示它们
    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

/**
 * 认证登录命令
 *
 * 登录到提供商，支持多种认证方式。
 */
export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "opencode auth provider",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        // 如果提供了 URL（well-known 配置）
        if (args.url) {
          // 获取 well-known 配置
          const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json() as any)
          prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
          // 执行认证命令
          const proc = Bun.spawn({
            cmd: wellknown.auth.command,
            stdout: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            prompts.log.error("Failed")
            prompts.outro("Done")
            return
          }
          // 读取命令输出的 token
          const token = await new Response(proc.stdout).text()
          await Auth.set(args.url, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: token.trim(),
          })
          prompts.log.success("Logged into " + args.url)
          prompts.outro("Done")
          return
        }
        // 刷新模型数据库
        await ModelsDev.refresh().catch(() => {})

        // 获取配置
        const config = await Config.get()

        // 获取禁用和启用的提供商列表
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        // 过滤提供商列表
        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          for (const [key, value] of Object.entries(x)) {
            // 只包含未禁用且（如果指定了启用列表）已启用的提供商
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          return filtered
        })

        // 提供商优先级（用于排序）
        const priority: Record<string, number> = {
          opencode: 0,
          anthropic: 1,
          "github-copilot": 2,
          openai: 3,
          google: 4,
          openrouter: 5,
          vercel: 6,
        }
        // 让用户选择提供商
        let provider = await prompts.autocomplete({
          message: "Select provider",
          maxItems: 8,
          options: [
            // 使用 remeda 进行数据转换
            ...pipe(
              providers,
              values(),
              sortBy(
                // 首先按优先级排序
                (x) => priority[x.id] ?? 99,
                // 然后按名称排序
                (x) => x.name ?? x.id,
              ),
              map((x) => ({
                label: x.name,
                value: x.id,
                hint: {
                  opencode: "recommended",
                  anthropic: "Claude Max or API key",
                  openai: "ChatGPT Plus/Pro or API key",
                }[x.id],
              })),
            ),
            {
              value: "other",
              label: "Other",
            },
          ],
        })

        if (prompts.isCancel(provider)) throw new UI.CancelledError()

        // 检查是否有插件提供此提供商的认证
        const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider)
          if (handled) return
        }

        // 处理 "Other" 选项
        if (provider === "other") {
          // 让用户输入自定义提供商 ID
          provider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          // 移除可能的 @ai-sdk/ 前缀
          provider = provider.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()

          // 检查是否有插件提供此自定义提供商的认证
          const customPlugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider)
            if (handled) return
          }

          // 警告用户需要手动配置
          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
          )
        }

        // 特殊提供商的说明信息
        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon Bedrock authentication priority:\n" +
              "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
              "  2. AWS credential chain (profile, access keys, IAM roles)\n\n" +
              "Configure via opencode.json options (profile, region, endpoint) or\n" +
              "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID).",
          )
        }

        if (provider === "opencode") {
          prompts.log.info("Create an api key at https://opencode.ai/auth")
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
          prompts.log.info(
            "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://opencode.ai/docs/providers/#cloudflare-ai-gateway",
          )
        }

        // 让用户输入 API Key
        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        // 保存凭证
        await Auth.set(provider, {
          type: "api",
          key,
        })

        prompts.outro("Done")
      },
    })
  },
})

/**
 * 认证登出命令
 *
 * 从提供商登出并删除凭证。
 */
export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    // 获取所有凭证
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    // 让用户选择要登出的提供商
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    // 删除凭证
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})
