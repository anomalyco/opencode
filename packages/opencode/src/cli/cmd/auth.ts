import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import type { Hooks } from "@opencode-ai/plugin"

type PluginAuth = NonNullable<Hooks["auth"]>

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string): Promise<boolean> {
  let index = 0
  if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
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

  // Handle prompts for all auth types
  await Bun.sleep(10)
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.condition && !prompt.condition(inputs)) {
        continue
      }
      if (prompt.type === "select") {
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      } else {
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

  if (method.type === "oauth") {
    const authorize = await method.authorize(inputs)

    if (authorize.url) {
      prompts.log.info("Go to: " + authorize.url)
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          await Auth.addOAuth(saveProvider, {
            refresh: result.refresh,
            access: result.access,
            expires: result.expires,
            accountId: result.accountId,
            enterpriseUrl: result.enterpriseUrl,
          })
        }
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        spinner.stop("Login successful")
      }
    }

    if (authorize.method === "code") {
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
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          await Auth.addOAuth(saveProvider, {
            refresh: result.refresh,
            access: result.access,
            expires: result.expires,
            accountId: result.accountId,
            enterpriseUrl: result.enterpriseUrl,
          })
        }
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

  if (method.type === "api") {
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
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

  return false
}

export const AuthUsageCommand = cmd({
  command: "usage",
  describe: "show rate limit usage for providers",
  async handler() {
    UI.empty()
    prompts.intro("Usage")
    const all = await Auth.all()
    const database = await ModelsDev.get()
    const sorted = Object.entries(all).sort((a, b) => {
      const nameA = database[a[0]]?.name || a[0]
      const nameB = database[b[0]]?.name || b[0]
      return nameA.localeCompare(nameB)
    })

    let hasOAuth = false
    for (const [providerID, info] of sorted) {
      if (info.type !== "oauth") continue
      hasOAuth = true

      const name = database[providerID]?.name || providerID
      const accounts = await Auth.OAuthPool.getUsage(providerID)

      prompts.log.step(`${name} (${accounts.length} account${accounts.length !== 1 ? "s" : ""})`)

      for (const account of accounts) {
        const label = account.label || "default"
        const status = account.isActive ? `${UI.Style.TEXT_SUCCESS}active` : UI.Style.TEXT_DIM + "inactive"
        prompts.log.info(`  Account: ${label} - ${status}`)

        if (account.health.cooldownUntil && account.health.cooldownUntil > Date.now()) {
          const remaining = Math.ceil((account.health.cooldownUntil - Date.now()) / 1000)
          prompts.log.warn(`    In cooldown for ${remaining}s`)
        }

        prompts.log.info(
          `    ${account.health.successCount} successful, ${account.health.failureCount} failed requests`,
        )

        if (providerID === "anthropic") {
          const usage = await Auth.OAuthPool.fetchAnthropicUsage(providerID, "default", account.id)
          if (usage) {
            const parts: string[] = []
            if (usage.fiveHour) parts.push(`5h: ${usage.fiveHour.utilization}%`)
            if (usage.sevenDay) parts.push(`7d: ${usage.sevenDay.utilization}%`)
            if (usage.sevenDaySonnet) parts.push(`7d-sonnet: ${usage.sevenDaySonnet.utilization}%`)
            if (parts.length > 0) {
              prompts.log.info(`    Rate Limits: ${parts.join(", ")}`)
            }
          }
        }
      }
    }

    if (!hasOAuth) {
      prompts.log.warn("No OAuth providers configured")
    }

    prompts.outro("")
  },
})

export const AuthSwitchCommand = cmd({
  command: "switch",
  describe: "switch active OAuth account for a provider",
  async handler() {
    UI.empty()
    prompts.intro("Switch Account")
    const all = await Auth.all()
    const database = await ModelsDev.get()

    const oauthProviders = Object.entries(all)
      .filter(([, info]) => info.type === "oauth")
      .sort((a, b) => {
        const nameA = database[a[0]]?.name || a[0]
        const nameB = database[b[0]]?.name || b[0]
        return nameA.localeCompare(nameB)
      })
    if (oauthProviders.length === 0) {
      prompts.log.warn("No OAuth providers configured")
      prompts.outro("")
      return
    }

    const providerID = await prompts.select({
      message: "Select provider",
      options: oauthProviders.map(([id]) => ({
        label: database[id]?.name || id,
        value: id,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()

    const accounts = await Auth.OAuthPool.getUsage(providerID)
    if (accounts.length < 2) {
      prompts.log.warn("Only one account configured for this provider")
      prompts.outro("")
      return
    }

    const accountOptions = []
    for (const account of accounts) {
      const label = account.label || "default"
      const status = account.isActive ? " (active)" : ""
      let hint = `${account.health.successCount} requests`

      if (providerID === "anthropic") {
        const usage = await Auth.OAuthPool.fetchAnthropicUsage(providerID, "default", account.id)
        if (usage?.fiveHour) {
          hint = `5h: ${usage.fiveHour.utilization}%`
        }
      }

      accountOptions.push({
        label: `${label}${status}`,
        value: account.id,
        hint,
      })
    }

    const recordID = await prompts.select({
      message: "Select account to activate",
      options: accountOptions,
    })
    if (prompts.isCancel(recordID)) throw new UI.CancelledError()

    const success = await Auth.OAuthPool.setActive(providerID, "default", recordID)
    if (success) {
      prompts.log.success("Account switched successfully")
    } else {
      prompts.log.error("Failed to switch account")
    }

    prompts.outro("")
  },
})

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .command(AuthUsageCommand)
      .command(AuthSwitchCommand)
      .command(AuthBrowserCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const database = await ModelsDev.get()
    const results = Object.entries(await Auth.all()).sort((a, b) => {
      const nameA = database[a[0]]?.name || a[0]
      const nameB = database[b[0]]?.name || b[0]
      return nameA.localeCompare(nameB)
    })

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      if (result.type === "oauth") {
        const count = await Auth.OAuthPool.list(providerID).then((accounts) => accounts.length)
        prompts.log.info(`${name} ${UI.Style.TEXT_DIM}oauth${count > 1 ? ` (${count} accounts)` : ""}`)
      } else {
        prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
      }
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

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

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars.sort((a, b) => a.provider.localeCompare(b.provider))) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

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
        if (args.url) {
          const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json() as any)
          prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
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
        await ModelsDev.refresh().catch(() => {})

        const config = await Config.get()

        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          for (const [key, value] of Object.entries(x)) {
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          return filtered
        })

        const priority: Record<string, number> = {
          opencode: 0,
          anthropic: 1,
          "github-copilot": 2,
          openai: 3,
          google: 4,
          openrouter: 5,
          vercel: 6,
        }
        let provider = await prompts.autocomplete({
          message: "Select provider",
          maxItems: 8,
          options: [
            ...pipe(
              providers,
              values(),
              sortBy(
                (x) => priority[x.id] ?? 99,
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

        const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider)
          if (handled) return
        }

        if (provider === "other") {
          provider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          provider = provider.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()

          // Check if a plugin provides auth for this custom provider
          const customPlugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider)
            if (handled) return
          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon Bedrock authentication priority:\n" +
              "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
              "  2. AWS credential chain (profile, access keys, IAM roles, EKS IRSA)\n\n" +
              "Configure via opencode.json options (profile, region, endpoint) or\n" +
              "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_WEB_IDENTITY_TOKEN_FILE).",
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

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(provider, {
          type: "api",
          key,
        })

        prompts.outro("Done")
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider or individual account",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()

    const info = credentials.find(([key]) => key === providerID)?.[1]
    if (info?.type === "oauth") {
      const accounts = await Auth.OAuthPool.list(providerID)
      if (accounts.length > 1) {
        const options = [
          { label: "Remove all accounts", value: "__all__", hint: `${accounts.length} accounts` },
          ...accounts.map((account, index) => ({
            label: `Account ${index + 1}${account.label && account.label !== "default" ? ` (${account.label})` : ""}`,
            value: account.id,
            hint: `ID: ${account.id.slice(0, 8)}...`,
          })),
        ]

        const selection = await prompts.select({
          message: "Remove which account?",
          options,
        })
        if (prompts.isCancel(selection)) throw new UI.CancelledError()

        if (selection === "__all__") {
          await Auth.remove(providerID)
          prompts.log.success(`Removed all ${accounts.length} accounts`)
        } else {
          const result = await Auth.OAuthPool.removeRecord(providerID, selection)
          if (result.removed) {
            prompts.log.success(
              `Account removed. ${result.remaining} account${result.remaining !== 1 ? "s" : ""} remaining.`,
            )
          } else {
            prompts.log.error("Failed to remove account")
          }
        }
        prompts.outro("Done")
        return
      }
    }

    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})

export const AuthBrowserCommand = cmd({
  command: "browser <action>",
  describe: "manage browser sessions for auto-relogin",
  builder: (yargs) =>
    yargs.positional("action", {
      describe: "action to perform",
      choices: ["setup", "status", "remove"] as const,
      type: "string",
    }),
  async handler(args) {
    const { AuthBrowser } = await import("../../auth/browser")

    UI.empty()

    if (args.action === "status") {
      prompts.intro("Browser Sessions")

      const accounts = await Auth.OAuthPool.list("anthropic", "default")
      if (accounts.length === 0) {
        prompts.log.info("No Anthropic OAuth accounts configured")
        prompts.outro("Done")
        return
      }

      for (const account of accounts) {
        const session = await AuthBrowser.status(account.id)
        const status = session.isConfigured ? UI.Style.TEXT_SUCCESS + "Active" : UI.Style.TEXT_DIM + "Not configured"
        const lastRefresh = session.lastRefresh ? ` (last refresh: ${formatTimeAgo(session.lastRefresh)})` : ""
        const error = session.lastError ? UI.Style.TEXT_DANGER + ` Error: ${session.lastError}` : ""

        prompts.log.info(`${account.label || account.id}: ${status}${lastRefresh}${error}${UI.Style.TEXT_NORMAL}`)
      }

      prompts.outro("Done")
      return
    }

    if (args.action === "setup") {
      prompts.intro("Setup Browser Session")

      const accounts = await Auth.OAuthPool.list("anthropic", "default")
      if (accounts.length === 0) {
        prompts.log.error("No Anthropic OAuth accounts found. Please login first with 'opencode auth login'")
        prompts.outro("Done")
        return
      }

      let recordID: string
      if (accounts.length === 1) {
        recordID = accounts[0].id
        prompts.log.info(`Setting up browser session for: ${accounts[0].label || accounts[0].id}`)
      } else {
        const selected = await prompts.select({
          message: "Select account to configure",
          options: accounts.map((a) => ({
            label: a.label || a.id,
            value: a.id,
          })),
        })
        if (prompts.isCancel(selected)) throw new UI.CancelledError()
        recordID = selected
      }

      const spinner = prompts.spinner()
      spinner.start("Preparing browser automation...")

      try {
        let browserOpened = false
        const tokens = await AuthBrowser.setup(recordID, (msg) => {
          // Update spinner with progress messages (e.g., during playwright installation)
          if (msg.includes("complete") || msg.includes("Opening")) {
            spinner.stop(msg)
            if (!browserOpened) {
              browserOpened = true
              prompts.log.info("Browser window opened - Please log in to claude.ai")
              prompts.log.warn("Do NOT close the browser window until login is complete!")
              spinner.start("Waiting for login...")
            }
          } else {
            spinner.message(msg)
          }
        })

        spinner.stop("Login successful!")

        // Update the auth store with new tokens
        await Auth.OAuthPool.updateRecord("anthropic", recordID, "default", {
          access: tokens.access,
          refresh: tokens.refresh,
          expires: tokens.expires,
        })

        prompts.log.success("Browser session configured successfully!")
        prompts.log.success("Auto-relogin is now enabled for this account")
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        spinner.stop(`Setup failed: ${message}`, 1)
      }

      prompts.outro("Done")
      return
    }

    if (args.action === "remove") {
      prompts.intro("Remove Browser Session")

      const sessions = await AuthBrowser.listAll()
      const configured = sessions.filter((s) => s.isConfigured)

      if (configured.length === 0) {
        prompts.log.info("No browser sessions configured")
        prompts.outro("Done")
        return
      }

      const accounts = await Auth.OAuthPool.list("anthropic", "default")
      const accountMap = new Map(accounts.map((a) => [a.id, a]))

      const selected = await prompts.select({
        message: "Select session to remove",
        options: configured.map((s) => {
          const account = accountMap.get(s.recordId)
          return {
            label: account?.label || s.recordId,
            value: s.recordId,
          }
        }),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()

      await AuthBrowser.remove(selected)
      prompts.log.success("Browser session removed")
      prompts.outro("Done")
      return
    }

    prompts.log.error(`Unknown action: ${args.action}`)
  },
})

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)

  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
