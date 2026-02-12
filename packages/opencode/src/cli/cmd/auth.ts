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
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.add(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.add(saveProvider, {
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
          await Auth.add(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.add(saveProvider, {
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
        await Auth.add(saveProvider, {
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

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .command(AuthUseCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers and accounts",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = await Auth.all()
    const database = await ModelsDev.get()

    // Group by provider
    for (const [providerID, providerData] of Object.entries(results)) {
      const name = database[providerID]?.name || providerID
      
      // Show provider name
      prompts.log.info(`${UI.Style.TEXT_BOLD}${name}`)
      
      // Show all accounts for this provider
      if (providerData.accounts) {
        for (const [accountId, info] of Object.entries(providerData.accounts)) {
          const isActive = accountId === providerData.activeAccount
          const isDisabled = "disabled" in info && info.disabled
          const marker = isActive ? " ✓" : (isDisabled ? " (disabled)" : "")
          const label = accountId === "default" ? "default" : accountId
          prompts.log.info(`  ${label}${marker} ${UI.Style.TEXT_DIM}(${info.type})`)
        }
      }
    }

    prompts.outro(`${Object.keys(results).length} providers`)

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
        
        // Check if provider already has accounts - offer options
        const existingProviders = await Auth.all()
        
        if (args.url) {
          // Well-known auth
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
          await Auth.add(args.url, {
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

        // Check if this provider already has accounts
        const hasExistingAccounts = existingProviders[provider] && 
          Object.keys(existingProviders[provider].accounts || {}).length > 0

        if (hasExistingAccounts) {
          // Ask what to do: add another, switch, or manage
          const action = await prompts.select({
            message: "This provider already has accounts. What would you like to do?",
            options: [
              { label: "Add another account", value: "add" },
              { label: "Switch active account", value: "switch" },
              { label: "Manage accounts (enable/disable)", value: "manage" },
            ],
          })
          if (prompts.isCancel(action)) throw new UI.CancelledError()
          
          if (action === "switch") {
            const accounts = await Auth.list(provider)
            const currentActive = await Auth.getActiveAccount(provider)
            const selected = await prompts.select({
              message: "Select active account",
              options: accounts.map(acc => ({
                label: acc === "default" ? "default" : acc,
                value: acc,
              })),
            })
            if (prompts.isCancel(selected)) throw new UI.CancelledError()
            await Auth.use(provider, selected)
            prompts.log.success(`Switched to ${selected}`)
            prompts.outro("Done")
            return
          }
          
          if (action === "manage") {
            const accounts = await Auth.list(provider)
            const selected = await prompts.select({
              message: "Select account to toggle",
              options: [
                ...accounts.map(acc => ({
                  label: acc === "default" ? "default" : acc,
                  value: acc,
                })),
              ],
            })
            if (prompts.isCancel(selected)) throw new UI.CancelledError()
            
            const currentAccounts = await Auth.getAccounts(provider)
            const isDisabled = currentAccounts[selected]?.disabled ?? false
            
            await Auth.setEnabled(provider, selected, isDisabled)
            prompts.log.success(isDisabled ? "Account enabled" : "Account disabled")
            prompts.outro("Done")
            return
          }
          // If "add", continue to authentication
        }

        const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider)
          if (handled) return
        }

        if (provider === "other") {
          provider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/)) ? undefined : "a-z, 0-9 and hyphens only",
          })
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          provider = provider.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()

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
        
        // Ask for email (optional, for identification)
        const email = await prompts.text({
          message: "Account name/email (optional, for identification)",
          placeholder: "e.g., work, personal, user@gmail.com",
        })
        
        const info: Auth.Info = {
          type: "api",
          key,
        }
        
        if (email && !prompts.isCancel(email)) {
          (info as any).email = email.trim()
        }
        
        await Auth.add(provider, info)
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
    const credentials = await Auth.all()
    const providers = Object.keys(credentials)
    
    prompts.intro("Remove credential")
    if (providers.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    
    const database = await ModelsDev.get()
    
    // Show provider selection with account count
    const providerID = await prompts.select({
      message: "Select provider",
      options: providers.map(key => {
        const accountCount = Object.keys(credentials[key].accounts || {}).length
        return {
          label: (database[key]?.name || key) + UI.Style.TEXT_DIM + ` (${accountCount} account${accountCount !== 1 ? "s" : ""})`,
          value: key,
        }
      }),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    
    // Show account selection
    const accounts = await Auth.list(providerID)
    if (accounts.length > 1) {
      const accountToRemove = await prompts.select({
        message: "Select account to remove",
        options: [
          { label: "All accounts", value: "all" },
          ...accounts.map(acc => ({
            label: acc === "default" ? "default" : acc,
            value: acc,
          })),
        ],
      })
      if (prompts.isCancel(accountToRemove)) throw new UI.CancelledError()
      
      await Auth.remove(providerID, accountToRemove)
    } else {
      await Auth.remove(providerID)
    }
    
    prompts.outro("Logout successful")
  },
})

export const AuthUseCommand = cmd({
  command: "use",
  describe: "switch between accounts for a provider",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider id",
        type: "string",
      })
      .positional("account", {
        describe: "account name or email",
        type: "string",
      }),
  async handler(args) {
    if (!args.provider || !args.account) {
      // Interactive mode
      const credentials = await Auth.all()
      const providers = Object.keys(credentials)
      
      if (providers.length === 0) {
        prompts.log.error("No providers found")
        return
      }
      
      const database = await ModelsDev.get()
      
      const providerID = await prompts.select({
        message: "Select provider",
        options: providers.map(key => ({
          label: database[key]?.name || key,
          value: key,
        })),
      })
      if (prompts.isCancel(providerID)) throw new UI.CancelledError()
      
      const accounts = await Auth.list(providerID)
      if (accounts.length === 0) {
        prompts.log.error("No accounts found for this provider")
        return
      }
      
      const account = await prompts.select({
        message: "Select account",
        options: accounts.map(acc => ({
          label: acc === "default" ? "default" : acc,
          value: acc,
        })),
      })
      if (prompts.isCancel(account)) throw new UI.CancelledError()
      
      try {
        await Auth.use(providerID, account)
        prompts.log.success(`Switched to ${account}`)
      } catch (error) {
        prompts.log.error(String(error))
      }
      prompts.outro("Done")
      return
    }
    
    // Direct mode
    try {
      await Auth.use(args.provider, args.account)
      prompts.log.success(`Switched to ${args.account} for ${args.provider}`)
    } catch (error) {
      prompts.log.error(String(error))
    }
    prompts.outro("Done")
  },
})
