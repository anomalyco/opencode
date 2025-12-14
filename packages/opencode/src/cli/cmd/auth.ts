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
 * Prompt for profile name if provider already has a default profile.
 * Returns undefined for default profile, or the profile name.
 */
async function promptForProfile(provider: string): Promise<string | undefined> {
  const hasDefault = await Auth.hasDefault(provider)
  if (!hasDefault) return undefined

  const profiles = await Auth.profiles(provider)
  const existingNames = profiles.map((p) => p.profile ?? "default").join(", ")
  prompts.log.info(`Existing profiles: ${existingNames}`)

  const profileName = await prompts.text({
    message: "Enter profile name (leave empty for default)",
    placeholder: "e.g. work, personal",
    validate: (x) => {
      if (!x || x.length === 0) return undefined
      if (!Auth.validateProfileName(x)) return "Only letters, numbers, hyphens, and underscores allowed"
      return undefined
    },
  })
  if (prompts.isCancel(profileName)) throw new UI.CancelledError()
  return profileName || undefined
}

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string, profile?: string): Promise<boolean> {
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
  await new Promise((resolve) => setTimeout(resolve, 10))
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
          await Auth.set(
            saveProvider,
            {
              type: "oauth",
              refresh,
              access,
              expires,
              ...extraFields,
            },
            profile,
          )
        }
        if ("key" in result) {
          await Auth.set(
            saveProvider,
            {
              type: "api",
              key: result.key,
            },
            profile,
          )
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
          await Auth.set(
            saveProvider,
            {
              type: "oauth",
              refresh,
              access,
              expires,
              ...extraFields,
            },
            profile,
          )
        }
        if ("key" in result) {
          await Auth.set(
            saveProvider,
            {
              type: "api",
              key: result.key,
            },
            profile,
          )
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
        await Auth.set(
          saveProvider,
          {
            type: "api",
            key: result.key,
          },
          profile,
        )
        prompts.log.success("Login successful")
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}

export const AuthSetDefaultCommand = cmd({
  command: "set-default",
  describe: "set a profile as the default for a provider",
  async handler() {
    UI.empty()
    prompts.intro("Set default profile")
    const credentials = await Auth.all().then((x) => Object.entries(x))
    const database = await ModelsDev.get()

    // Group by provider, only show providers with multiple profiles (including at least one named)
    const grouped: Record<string, Array<{ profile?: string; key: string }>> = {}
    for (const [key] of credentials) {
      const parsed = Auth.parseKey(key)
      if (!grouped[parsed.providerID]) grouped[parsed.providerID] = []
      grouped[parsed.providerID].push({ profile: parsed.profile, key })
    }

    // Filter to providers with named profiles
    const eligibleProviders = Object.entries(grouped).filter(([, profiles]) =>
      profiles.some((p) => p.profile !== undefined),
    )

    if (eligibleProviders.length === 0) {
      prompts.log.error("No providers with multiple profiles found")
      prompts.outro("Done")
      return
    }

    // Select provider
    const providerID = await prompts.select({
      message: "Select provider",
      options: eligibleProviders.map(([id, profiles]) => {
        const name = database[id]?.name || id
        const count = profiles.length
        return {
          label: `${name} ${UI.Style.TEXT_DIM}(${count} profiles)`,
          value: id,
        }
      }),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()

    // Get named profiles for this provider
    const namedProfiles = grouped[providerID].filter((p) => p.profile !== undefined)
    if (namedProfiles.length === 0) {
      prompts.log.error("No named profiles found for this provider")
      prompts.outro("Done")
      return
    }

    // Select profile to promote
    const profile = await prompts.select({
      message: "Select profile to set as default",
      options: namedProfiles.map((p) => ({
        label: p.profile!,
        value: p.profile!,
      })),
    })
    if (prompts.isCancel(profile)) throw new UI.CancelledError()

    await Auth.setDefault(providerID, profile)
    prompts.log.success(`Profile "${profile}" is now the default for ${database[providerID]?.name || providerID}`)
    prompts.outro("Done")
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
      .command(AuthSetDefaultCommand)
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

    // Group by provider
    const grouped: Record<string, Array<{ profile?: string; type: string }>> = {}
    for (const [key, result] of results) {
      const parsed = Auth.parseKey(key)
      if (!grouped[parsed.providerID]) grouped[parsed.providerID] = []
      grouped[parsed.providerID].push({ profile: parsed.profile, type: result.type })
    }

    for (const [providerID, profiles] of Object.entries(grouped)) {
      const name = database[providerID]?.name || providerID
      for (const p of profiles) {
        const profileLabel = p.profile ? `:${p.profile}` : " (default)"
        prompts.log.info(`${name}${profileLabel} ${UI.Style.TEXT_DIM}${p.type}`)
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

        if (provider === "other") {
          provider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          provider = provider.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
          )
          prompts.outro("Done")
          return
        }

        // Prompt for profile name if provider already has credentials
        const profile = await promptForProfile(provider)

        const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider, profile)
          if (handled) return
        }

        if (provider === "opencode") {
          prompts.log.info("Create an api key at https://opencode.ai/auth")
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(
          provider,
          {
            type: "api",
            key,
          },
          profile,
        )

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
    const selection = await prompts.select({
      message: "Select credential",
      options: credentials.map(([key, value]) => {
        const parsed = Auth.parseKey(key)
        const providerName = database[parsed.providerID]?.name || parsed.providerID
        const profileLabel = parsed.profile ? `:${parsed.profile}` : " (default)"
        return {
          label: providerName + profileLabel + UI.Style.TEXT_DIM + " " + value.type,
          value: key,
        }
      }),
    })
    if (prompts.isCancel(selection)) throw new UI.CancelledError()
    const parsed = Auth.parseKey(selection)
    await Auth.remove(parsed.providerID, parsed.profile)
    prompts.outro("Logout successful")
  },
})
