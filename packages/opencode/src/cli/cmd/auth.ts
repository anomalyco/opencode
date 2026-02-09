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
import { fetchCodexUsage } from "../../plugin/codex"

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

  // Check for existing Codex accounts if this is an OpenAI OAuth login
  const isCodexOAuth = provider === "openai" && method.type === "oauth"
  let shouldReplaceAll = false

  if (isCodexOAuth) {
    const existingAccounts = await Auth.getCodexAccounts()
    if (existingAccounts.length > 0) {
      const emails = existingAccounts.map((a) => a.email).join(", ")
      const action = await prompts.select({
        message: `Found ${existingAccounts.length} existing ChatGPT account(s): ${emails}`,
        options: [
          { label: "Add new account", value: "add" },
          { label: "Replace all accounts", value: "replace" },
        ],
      })
      if (prompts.isCancel(action)) throw new UI.CancelledError()
      shouldReplaceAll = action === "replace"
      if (shouldReplaceAll) {
        await Auth.remove("codex")
      }
    }
  }

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

        // Special handling for Codex multi-account
        if (isCodexOAuth && "refresh" in result) {
          const email = (result as any).email || (result as any).accountId || "unknown"
          await Auth.setCodexAccount({
            email,
            refresh: result.refresh,
            access: result.access,
            expires: result.expires,
            accountId: (result as any).accountId,
          })
          spinner.stop(`Login successful (${email})`)
        } else if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
          spinner.stop("Login successful")
        } else if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
          spinner.stop("Login successful")
        }
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

        // Special handling for Codex multi-account
        if (isCodexOAuth && "refresh" in result) {
          const email = (result as any).email || (result as any).accountId || "unknown"
          await Auth.setCodexAccount({
            email,
            refresh: result.refresh,
            access: result.access,
            expires: result.expires,
            accountId: (result as any).accountId,
          })
          prompts.log.success(`Login successful (${email})`)
        } else if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
          prompts.log.success("Login successful")
        } else if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
          prompts.log.success("Login successful")
        }
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

export const AuthSwitchCommand = cmd({
  command: "switch",
  describe: "switch active OpenAI OAuth account",
  async handler() {
    UI.empty()
    prompts.intro("Switch account")

    const codexAccounts = await Auth.getCodexAccounts()
    if (codexAccounts.length === 0) {
      prompts.log.error("No ChatGPT accounts found")
      prompts.outro("Done")
      return
    }

    const codexAuth = await Auth.getCodexAuth()
    const activeIndex = codexAuth?.activeIndex ?? 0

    const selected = await prompts.select({
      message: "Select active ChatGPT account",
      options: codexAccounts.map((account, index) => {
        const isActive = index === activeIndex
        const status = account.rateLimit?.limited ? " [rate limited]" : ""
        return {
          label: `ChatGPT (${account.email})${status}` + (isActive ? " *" : ""),
          value: index.toString(),
        }
      }),
    })
    if (prompts.isCancel(selected)) throw new UI.CancelledError()

    const nextIndex = Number.parseInt(selected, 10)
    if (!Number.isNaN(nextIndex)) {
      await Auth.setActiveCodexIndex(nextIndex)
    }

    prompts.outro("Active account updated")
  },
})

function formatResetTime(resetAt: number): string {
  const diff = resetAt - Date.now()
  if (diff <= 0) return "now"
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hours > 24) return `${Math.floor(hours / 24)}d`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatUsageBar(usedPercent: number, width = 10): string {
  const remaining = 100 - usedPercent
  const filled = Math.round((remaining / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

export const AuthUsageCommand = cmd({
  command: "usage",
  describe: "show Codex usage status for all accounts",
  async handler() {
    UI.empty()
    prompts.intro("Codex Usage")

    const accounts = await Auth.getCodexAccounts()
    if (accounts.length === 0) {
      prompts.log.error("No ChatGPT accounts found")
      prompts.outro("Done")
      return
    }

    const codexAuth = await Auth.getCodexAuth()
    const activeIndex = codexAuth?.activeIndex ?? 0

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i]
      const isActive = i === activeIndex
      const activeMarker = isActive ? " *" : ""

      prompts.log.info(`${account.email}${activeMarker}`)

      const spinner = prompts.spinner()
      spinner.start("Fetching usage...")

      try {
        const usage = await fetchCodexUsage(account)
        spinner.stop("")

        const planLabel = usage.planType ? ` (${usage.planType})` : ""
        prompts.log.info(`  Plan: ${usage.planType || "unknown"}${planLabel}`)

        if (usage.primary) {
          const remaining = 100 - usage.primary.usedPercent
          const bar = formatUsageBar(usage.primary.usedPercent)
          const reset = formatResetTime(usage.primary.resetAt)
          prompts.log.info(`  5h limit:  [${bar}] ${remaining}% left, resets in ${reset}`)
        }

        if (usage.secondary) {
          const remaining = 100 - usage.secondary.usedPercent
          const bar = formatUsageBar(usage.secondary.usedPercent)
          const reset = formatResetTime(usage.secondary.resetAt)
          prompts.log.info(`  Weekly:    [${bar}] ${remaining}% left, resets in ${reset}`)
        }

        if (usage.credits) {
          if (usage.credits.unlimited) {
            prompts.log.info("  Credits: unlimited")
          } else if (usage.credits.balance) {
            prompts.log.info(`  Credits: $${usage.credits.balance}`)
          }
        }
      } catch (err) {
        spinner.stop("Failed to fetch usage", 1)
        prompts.log.error(`  Error: ${err instanceof Error ? err.message : String(err)}`)
      }

      if (i < accounts.length - 1) {
        prompts.log.info("")
      }
    }

    prompts.outro(`${accounts.length} account${accounts.length === 1 ? "" : "s"}`)
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
      .command(AuthSwitchCommand)
      .command(AuthUsageCommand)
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
    const codexAccounts = await Auth.getCodexAccounts()
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    let count = 0
    for (const [providerID, result] of results) {
      // Skip codex multi-account - we'll show individual accounts
      if (providerID === "codex" && result.type === "codex-multi") continue

      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
      count++
    }

    // Show individual Codex accounts
    if (codexAccounts.length > 0) {
      const codexAuth = await Auth.getCodexAuth()
      const activeIndex = codexAuth?.activeIndex ?? 0

      for (let i = 0; i < codexAccounts.length; i++) {
        const account = codexAccounts[i]
        const isActive = i === activeIndex
        const status = account.rateLimit?.limited
          ? ` [rate limited until ${new Date(account.rateLimit.resetAt!).toLocaleTimeString()}]`
          : ""
        const activeMarker = isActive ? " *" : ""
        prompts.log.info(`ChatGPT (${account.email})${activeMarker}${status} ${UI.Style.TEXT_DIM}oauth`)
        count++
      }
    }

    prompts.outro(`${count} credential${count === 1 ? "" : "s"}`)

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

      for (const { provider, envVar } of activeEnvVars) {
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

        const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
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
          const customPlugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
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
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    prompts.intro("Remove credential")

    // Build options list with special handling for Codex multi-account
    const codexAccounts = await Auth.getCodexAccounts()
    const database = await ModelsDev.get()
    const credentials = await Auth.all()

    type CredentialOption = { label: string; value: string; isCodexAccount?: boolean; accountId?: string }
    const options: CredentialOption[] = []

    for (const [key, value] of Object.entries(credentials)) {
      // Skip codex entry - we'll list individual accounts instead
      if (key === "codex" && value.type === "codex-multi") continue

      options.push({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })
    }

    // Add individual Codex accounts
    for (const account of codexAccounts) {
      const status = account.rateLimit?.limited ? " [rate limited]" : ""
      options.push({
        label: `ChatGPT (${account.email})${status}` + UI.Style.TEXT_DIM + " (oauth)",
        value: `codex:${account.id}`,
        isCodexAccount: true,
        accountId: account.id,
      })
    }

    if (options.length === 0) {
      prompts.log.error("No credentials found")
      return
    }

    const selected = await prompts.select({
      message: "Select credential to remove",
      options: options.map((o) => ({ label: o.label, value: o.value })),
    })
    if (prompts.isCancel(selected)) throw new UI.CancelledError()

    // Handle Codex account removal
    if (selected.startsWith("codex:")) {
      const accountId = selected.replace("codex:", "")
      await Auth.removeCodexAccount(accountId)
    } else {
      await Auth.remove(selected)
    }

    prompts.outro("Logout successful")
  },
})
