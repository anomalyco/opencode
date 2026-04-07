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
import { Process } from "../../util/process"
import { text } from "node:stream/consumers"

type PluginAuth = NonNullable<Hooks["auth"]>

async function handlePluginAuth(
  plugin: { auth: PluginAuth },
  provider: string,
  methodName?: string,
  profile?: string,
): Promise<boolean> {
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

  await new Promise((r) => setTimeout(r, 10))
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.when) {
        const value = inputs[prompt.when.key]
        if (value === undefined) continue
        const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
        if (!matches) continue
      }
      if (prompt.condition && !prompt.condition(inputs)) continue
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
        const key = profile ? `${saveProvider}:${profile}` : `${saveProvider}:default`
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(key, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.set(key, {
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
        const key = profile ? `${saveProvider}:${profile}` : `${saveProvider}:default`
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(key, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.set(key, {
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
        const key = profile ? `${saveProvider}:${profile}` : `${saveProvider}:default`
        await Auth.set(key, {
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

export const ProvidersCommand = cmd({
  command: "providers",
  aliases: ["auth"],
  describe: "manage AI providers and credentials",
  builder: (yargs) =>
    yargs.command(ProvidersListCommand).command(ProvidersLoginCommand).command(ProvidersLogoutCommand).demandCommand(),
  async handler() {},
})

export const ProvidersListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers and credentials",
  async handler(_args) {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    const byProvider: Record<string, Array<{ profile: string; type: string }>> = {}
    for (const [compositeKey, result] of results) {
      const lastColon = compositeKey.lastIndexOf(":")
      const baseProvider = lastColon === -1 ? compositeKey : compositeKey.slice(0, lastColon)
      const profile = lastColon === -1 ? "default" : compositeKey.slice(lastColon + 1)
      if (!byProvider[baseProvider]) byProvider[baseProvider] = []
      byProvider[baseProvider]!.push({ profile, type: result.type })
    }

    for (const [baseProvider, credentials] of Object.entries(byProvider)) {
      const name = database[baseProvider]?.name || baseProvider
      if (credentials.length === 1) {
        prompts.log.info(`${name}:${credentials[0]!.profile} ${UI.Style.TEXT_DIM}(${credentials[0]!.type})`)
      } else {
        prompts.log.info(name)
        for (const cred of credentials) {
          prompts.log.info(`  ${cred.profile} ${UI.Style.TEXT_DIM}(${cred.type})`)
        }
      }
    }

    prompts.outro(`${results.length} credentials`)

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

export const ProvidersLoginCommand = cmd({
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
      })
      .option("profile", {
        describe: "profile name for this provider (skips interactive prompt)",
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
        await ModelsDev.refresh(true).catch(() => {})

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
          openai: 1,
          "github-copilot": 2,
          google: 3,
          anthropic: 4,
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

        // Prompt for profile name (unless --profile was provided)
        let profile = args.profile
        if (!profile) {
          const validateProfile = (input: string | undefined) => {
            if (!input) return "Required"
            if (input.length > 20) return "Max 20 characters"
            if (!/^[a-zA-Z0-9_-]+$/.test(input)) return "Letters, numbers, hyphens, underscores only"
            return undefined
          }
          const input = await prompts.text({
            message: "Profile name",
            validate: validateProfile,
          })
          if (prompts.isCancel(input)) throw new UI.CancelledError()
          profile = input.toLowerCase()
        } else {
          // Validate provided profile name
          if (profile.length > 20) {
            prompts.log.error("Profile name must be max 20 characters")
            process.exit(1)
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
            prompts.log.error("Profile name can only contain letters, numbers, hyphens, and underscores")
            process.exit(1)
          }
          profile = profile.toLowerCase()
        }

        const normalizedKey = `${provider}:${profile}`
        const existing = await Auth.get(normalizedKey)
        if (existing) {
          const confirmed = await prompts.confirm({
            message: `Profile '${profile}' already exists for ${provider}. Replace?`,
            active: "yes",
            inactive: "no",
          })
          if (prompts.isCancel(confirmed)) throw new UI.CancelledError()
          if (!confirmed) {
            prompts.outro("Cancelled")
            return
          }
        }

        const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider, args.method, profile)
          if (handled) return
        }

        if (provider === "other") {
          const custom = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(custom)) throw new UI.CancelledError()
          provider = custom.replace(/^@ai-sdk\//, "")

          const customPlugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider, args.method, profile)
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
        await Auth.set(normalizedKey, {
          type: "api",
          key,
        })

        prompts.outro("Done")
      },
    })
  },
})

export const ProvidersLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  builder: (yargs) =>
    yargs
      .option("provider", {
        alias: ["p"],
        describe: "provider id or name (skips provider selection)",
        type: "string",
      })
      .option("profile", {
        alias: ["P"],
        describe: "profile name (skips profile selection, requires --provider)",
        type: "string",
      }),
  async handler(args) {
    UI.empty()
    const allCredentials = await Auth.all()
    const credentials = Object.entries(allCredentials)
    prompts.intro("Remove credential")

    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }

    const parseKey = (key: string) => {
      const idx = key.lastIndexOf(":")
      if (idx === -1) return { providerID: key, profile: "default" as const, raw: key }
      return { providerID: key.slice(0, idx), profile: key.slice(idx + 1), raw: key }
    }
    const uniqueProviders = [...new Set(credentials.map(([key]) => parseKey(key).providerID))]

    const database = await ModelsDev.get()

    // Helper to get display name for a provider
    const providerName = (pid: string) => database[pid]?.name || pid

    let selectedProvider: string

    if (args.provider) {
      // Validate provider exists
      const match = uniqueProviders.find(
        (p) => p === args.provider || providerName(p).toLowerCase() === args.provider!.toLowerCase(),
      )
      if (!match) {
        prompts.log.error(`Provider '${args.provider}' not found`)
        return
      }
      selectedProvider = match
    } else {
      // Show provider selection (unique providers only)
      const selected = await prompts.select({
        message: "Select provider",
        options: uniqueProviders.map((p) => ({
          label: providerName(p),
          value: p,
        })),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      selectedProvider = selected
    }

    // Get all profiles for selected provider
    const providerCredentials = credentials
      .map(([key, value]) => ({ ...parseKey(key), value }))
      .filter((item) => item.providerID === selectedProvider)
    const profiles = [...new Set(providerCredentials.map((item) => item.profile))]

    const removeProfile = async (providerID: string, profile: string) => {
      if (profile === "default") {
        const bare = providerID
        const legacy = `${providerID}:default`
        if (bare in allCredentials) await Auth.remove(bare)
        if (legacy in allCredentials) await Auth.remove(legacy)
        return
      }
      await Auth.remove(`${providerID}:${profile}`)
    }

    // If --profile given, use it directly
    if (args.profile) {
      const requested = args.profile.toLowerCase()
      if (!profiles.includes(requested)) {
        prompts.log.error(`Profile '${args.profile}' not found for ${providerName(selectedProvider)}`)
        return
      }
      await removeProfile(selectedProvider, requested)
      prompts.outro("Logout successful")
      return
    }

    // If only one profile, skip selection
    if (profiles.length === 1) {
      await removeProfile(selectedProvider, profiles[0]!)
      prompts.outro("Logout successful")
      return
    }

    // Show profile selection
    const selectedProfile = await prompts.select({
      message: "Select profile",
      options: profiles.map((p) => ({
        label: p,
        value: p,
      })),
    })
    if (prompts.isCancel(selectedProfile)) throw new UI.CancelledError()
    await removeProfile(selectedProvider, selectedProfile)
    prompts.outro("Logout successful")
  },
})
