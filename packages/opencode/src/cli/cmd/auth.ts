import { Auth } from "../../auth"
import { AuthBrowser } from "../../auth/browser"
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
import { Process } from "../../util/process"
import { text } from "node:stream/consumers"
import { setTimeout as sleep } from "node:timers/promises"

type PluginAuth = NonNullable<Hooks["auth"]>

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string, methodName?: string): Promise<boolean> {
  let index = 0
  if (methodName) {
    const match = plugin.auth.methods.findIndex((x) => x.label.toLowerCase() === methodName.toLowerCase())
    if (match === -1) {
      prompts.log.error(
        `Unknown method "${methodName}" for ${provider}. Available: ${plugin.auth.methods.map((x) => x.label).join(", ")}`,
      )
      process.exit(1)
    }
    index = match
  } else if (plugin.auth.methods.length > 1) {
    const selected = await prompts.select({
      message: "Login method",
      options: [
        ...plugin.auth.methods.map((x, index) => ({
          label: x.label,
          value: index.toString(),
        })),
      ],
    })
    if (prompts.isCancel(selected)) throw new UI.CancelledError()
    index = parseInt(selected)
  }
  const method = plugin.auth.methods[index]

  // Handle prompts for all auth types
  await sleep(10)
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
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
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
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
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

/**
 * Build a deduplicated list of plugin-registered auth providers that are not
 * already present in models.dev, respecting enabled/disabled provider lists.
 * Pure function with no side effects; safe to test without mocking.
 */
export function resolvePluginProviders(input: {
  hooks: Hooks[]
  existingProviders: Record<string, unknown>
  disabled: Set<string>
  enabled?: Set<string>
  providerNames: Record<string, string | undefined>
}): Array<{ id: string; name: string }> {
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []

  for (const hook of input.hooks) {
    if (!hook.auth) continue
    const id = hook.auth.provider
    if (seen.has(id)) continue
    seen.add(id)
    if (Object.hasOwn(input.existingProviders, id)) continue
    if (input.disabled.has(id)) continue
    if (input.enabled && !input.enabled.has(id)) continue
    result.push({
      id,
      name: input.providerNames[id] ?? id,
    })
  }

  return result
}

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .command(AuthBrowserCommand)
      .command(AuthRenameCommand)
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
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
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
    yargs
      .positional("url", {
        describe: "opencode auth provider",
        type: "string",
      })
      .option("provider", {
        alias: ["p"],
        describe: "provider id or name to log in to (skips provider selection)",
        type: "string",
      })
      .option("method", {
        alias: ["m"],
        describe: "login method label (skips method selection)",
        type: "string",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        if (args.url) {
          const url = args.url.replace(/\/+$/, "")
          const wellknown = await fetch(`${url}/.well-known/opencode`).then((x) => x.json() as any)
          prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
          const proc = Process.spawn(wellknown.auth.command, {
            stdout: "pipe",
          })
          if (!proc.stdout) {
            prompts.log.error("Failed")
            prompts.outro("Done")
            return
          }
          const [exit, token] = await Promise.all([proc.exited, text(proc.stdout)])
          if (exit !== 0) {
            prompts.log.error("Failed")
            prompts.outro("Done")
            return
          }
          await Auth.set(url, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: token.trim(),
          })
          prompts.log.success("Logged into " + url)
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
        const pluginProviders = resolvePluginProviders({
          hooks: await Plugin.list(),
          existingProviders: providers,
          disabled,
          enabled,
          providerNames: Object.fromEntries(Object.entries(config.provider ?? {}).map(([id, p]) => [id, p.name])),
        })
        const options = [
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
          ...pluginProviders.map((x) => ({
            label: x.name,
            value: x.id,
            hint: "plugin",
          })),
        ]

        let provider: string
        if (args.provider) {
          const input = args.provider
          const byID = options.find((x) => x.value === input)
          const byName = options.find((x) => x.label.toLowerCase() === input.toLowerCase())
          const match = byID ?? byName
          if (!match) {
            prompts.log.error(`Unknown provider "${input}"`)
            process.exit(1)
          }
          provider = match.value
        } else {
          const selected = await prompts.autocomplete({
            message: "Select provider",
            maxItems: 8,
            options: [
              ...options,
              {
                value: "other",
                label: "Other",
              },
            ],
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          provider = selected as string
        }

        const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider, args.method)
          if (handled) return
        }

        if (provider === "other") {
          const custom = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(custom)) throw new UI.CancelledError()
          provider = custom.replace(/^@ai-sdk\//, "")

          // Check if a plugin provides auth for this custom provider
          const customPlugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider, args.method)
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
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})

// Browser session commands for auto-relogin
export const AuthBrowserCommand = cmd({
  command: "browser",
  describe: "manage browser sessions for auto-relogin",
  builder: (yargs) =>
    yargs
      .command(AuthBrowserListCommand)
      .command(AuthBrowserSetupCommand)
      .command(AuthBrowserRefreshCommand)
      .command(AuthBrowserRemoveCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthBrowserListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list browser sessions",
  async handler() {
    UI.empty()
    prompts.intro("Browser Sessions")
    const sessions = await AuthBrowser.listAll()
    const accounts = await Auth.OAuthPool.list("anthropic", "default")
    const accountMap = new Map(accounts.map((a) => [a.id, a]))

    if (sessions.length === 0) {
      prompts.log.warn("No browser sessions configured")
      prompts.outro("Use 'opencode auth browser setup' to configure one")
      return
    }

    for (const session of sessions) {
      const account = accountMap.get(session.recordId)
      const name = account?.label || `Account ${session.recordId.slice(0, 8)}`
      const status = session.isConfigured ? UI.Style.TEXT_SUCCESS + "configured" : UI.Style.TEXT_DIM + "not configured"
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}(${session.recordId})${UI.Style.TEXT_NORMAL} - ${status}`)
    }

    prompts.outro(`${sessions.length} session(s)`)
  },
})

export const AuthBrowserSetupCommand = cmd({
  command: "setup [recordId]",
  describe: "setup or rebind a browser session",
  builder: (yargs) =>
    yargs.positional("recordId", {
      describe: "account record ID (will prompt if not provided)",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Browser Session Setup")

    let recordId = args.recordId
    if (!recordId) {
      const accounts = await Auth.OAuthPool.list("anthropic", "default")
      if (accounts.length === 0) {
        prompts.log.error("No OAuth accounts found. Add an account first with 'opencode auth login'")
        return
      }
      const selected = await prompts.select({
        message: "Select account",
        options: accounts.map((a, i) => ({
          label: a.label || `Account ${i + 1}`,
          value: a.id,
          hint: a.id.slice(0, 8),
        })),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      recordId = selected
    }

    const spinner = prompts.spinner()
    spinner.start("Opening browser...")

    try {
      const tokens = await AuthBrowser.setup(recordId, (msg) => {
        spinner.message(msg)
      })

      // Update the auth store with new tokens
      await Auth.OAuthPool.updateRecord("anthropic", recordId, "default", {
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
      })

      spinner.stop("Browser session configured successfully!")
      prompts.outro("Done")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      spinner.stop(`Setup failed: ${message}`, 1)
    }
  },
})

export const AuthBrowserRefreshCommand = cmd({
  command: "refresh [recordId]",
  aliases: ["test"],
  describe: "test/refresh tokens via browser session",
  builder: (yargs) =>
    yargs.positional("recordId", {
      describe: "account record ID (will prompt if not provided)",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Browser Session Refresh")

    let recordId = args.recordId
    if (!recordId) {
      const sessions = await AuthBrowser.listAll()
      const configured = sessions.filter((s) => s.isConfigured)
      if (configured.length === 0) {
        prompts.log.error("No configured browser sessions. Run 'opencode auth browser setup' first.")
        return
      }
      const accounts = await Auth.OAuthPool.list("anthropic", "default")
      const accountMap = new Map(accounts.map((a) => [a.id, a]))

      const selected = await prompts.select({
        message: "Select session to refresh",
        options: configured.map((s) => {
          const account = accountMap.get(s.recordId)
          return {
            label: account?.label || `Account ${s.recordId.slice(0, 8)}`,
            value: s.recordId,
          }
        }),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      recordId = selected
    }

    const spinner = prompts.spinner()
    spinner.start("Refreshing tokens...")

    try {
      const tokens = await AuthBrowser.refresh(recordId)

      // Update the auth store with new tokens
      await Auth.OAuthPool.updateRecord("anthropic", recordId, "default", {
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
      })

      spinner.stop("Tokens refreshed successfully!")
      prompts.outro("Done")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      spinner.stop(`Refresh failed: ${message}`, 1)
    }
  },
})

export const AuthBrowserRemoveCommand = cmd({
  command: "remove [recordId]",
  aliases: ["rm"],
  describe: "remove a browser session",
  builder: (yargs) =>
    yargs.positional("recordId", {
      describe: "account record ID (will prompt if not provided)",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Remove Browser Session")

    let recordId = args.recordId
    if (!recordId) {
      const sessions = await AuthBrowser.listAll()
      if (sessions.length === 0) {
        prompts.log.error("No browser sessions found")
        return
      }
      const accounts = await Auth.OAuthPool.list("anthropic", "default")
      const accountMap = new Map(accounts.map((a) => [a.id, a]))

      const selected = await prompts.select({
        message: "Select session to remove",
        options: sessions.map((s) => {
          const account = accountMap.get(s.recordId)
          return {
            label: account?.label || `Account ${s.recordId.slice(0, 8)}`,
            value: s.recordId,
            hint: s.isConfigured ? "configured" : "not configured",
          }
        }),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      recordId = selected
    }

    await AuthBrowser.remove(recordId)
    prompts.log.success("Browser session removed")
    prompts.outro("Done")
  },
})

// Rename account command
export const AuthRenameCommand = cmd({
  command: "rename [recordId] [name]",
  describe: "rename an OAuth account",
  builder: (yargs) =>
    yargs
      .positional("recordId", {
        describe: "account record ID (will prompt if not provided)",
        type: "string",
      })
      .positional("name", {
        describe: "new name for the account",
        type: "string",
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Rename Account")

    let recordId = args.recordId
    if (!recordId) {
      const accounts = await Auth.OAuthPool.list("anthropic", "default")
      if (accounts.length === 0) {
        prompts.log.error("No OAuth accounts found")
        return
      }
      const selected = await prompts.select({
        message: "Select account to rename",
        options: accounts.map((a, i) => ({
          label: a.label || `Account ${i + 1}`,
          value: a.id,
          hint: a.id.slice(0, 8),
        })),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      recordId = selected
    }

    let name = args.name
    if (!name) {
      const input = await prompts.text({
        message: "Enter new name",
        validate: (x) => (x && x.length > 0 ? undefined : "Name is required"),
      })
      if (prompts.isCancel(input)) throw new UI.CancelledError()
      name = input
    }

    const success = await Auth.OAuthPool.updateRecord("anthropic", recordId, "default", { label: name })
    if (success) {
      prompts.log.success(`Account renamed to "${name}"`)
    } else {
      prompts.log.error("Failed to rename account")
    }
    prompts.outro("Done")
  },
})
