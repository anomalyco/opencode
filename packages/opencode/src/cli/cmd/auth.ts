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
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string, profileID?: string): Promise<boolean> {
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
        const pid = profileID || "default"
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.addProfile(saveProvider, pid, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
          await Auth.setActiveProfile(saveProvider, pid)
        }
        if ("key" in result) {
          await Auth.addProfile(saveProvider, pid, {
            type: "api",
            key: result.key,
          })
          await Auth.setActiveProfile(saveProvider, pid)
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
        const pid = profileID || "default"
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.addProfile(saveProvider, pid, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
          await Auth.setActiveProfile(saveProvider, pid)
        }
        if ("key" in result) {
          await Auth.addProfile(saveProvider, pid, {
            type: "api",
            key: result.key,
          })
          await Auth.setActiveProfile(saveProvider, pid)
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
        const pid = profileID || "default"
        await Auth.addProfile(saveProvider, pid, {
          type: "api",
          key: result.key,
        })
        await Auth.setActiveProfile(saveProvider, pid)
        prompts.log.success(`Login successful (profile: ${pid})`)
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}

// Profile management commands
export const AuthProfileCommand = cmd({
  command: "profile",
  describe: "manage account profiles",
  builder: (yargs) =>
    yargs
      .command(AuthProfileCreateCommand)
      .command(AuthProfileUseCommand)
      .command(AuthProfileListCommand)
      .command(AuthProfileRemoveCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthProfileCreateCommand = cmd({
  command: "create <provider>",
  describe: "create a new profile for a provider",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider name",
        type: "string",
      })
      .option("profile", {
        alias: "p",
        type: "string",
        describe: "profile name (will prompt if not provided)",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        // Check for migration first
        await checkAndInformMigration()

        const providerID = args.provider

        // Validate provider exists
        const database = await ModelsDev.get()
        if (!database[providerID]) {
          prompts.log.error(`Provider "${providerID}" not found`)
          prompts.log.info("Available providers: " + Object.keys(database).join(", "))
          return
        }

        // Get profile name
        const existingProfiles = await Auth.listProfiles(providerID)
        const profileName = await prompts.text({
          message: "Enter profile name:",
          placeholder: "personal",
          validate: (name) => {
            if (!name || !name.trim()) return "Profile name cannot be empty"
            if (name.length > 50) return "Profile name too long (max 50 characters)"
            if (name.includes("/") || name.includes("\\")) return "Profile name cannot contain slashes"
            if (existingProfiles[name.trim()]) {
              return `Profile "${name.trim()}" already exists for ${providerID}`
            }
            return undefined
          },
        })
        if (prompts.isCancel(profileName)) throw new UI.CancelledError()

        const finalProfileName = profileName.trim()

        prompts.log.info(`Creating profile "${finalProfileName}" for ${database[providerID]?.name || providerID}`)

        // Check for plugin-based auth
        const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === providerID))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, providerID, finalProfileName)
          if (handled) return
        }

        // Fallback to API key prompt
        if (providerID === "opencode") {
          prompts.log.info("Create an api key at https://opencode.ai/auth")
        }

        const key = await prompts.password({
          message: `Enter your ${database[providerID]?.name || providerID} API key:`,
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()

        const existing = await Auth.listProfiles(providerID)
        if (existing[finalProfileName]) {
          const overwrite = await prompts.confirm({
            message: `Profile "${finalProfileName}" already exists for ${database[providerID]?.name || providerID}. Overwrite?`,
          })
          if (prompts.isCancel(overwrite) || !overwrite) throw new UI.CancelledError()
        }

        await Auth.addProfile(providerID, finalProfileName, {
          type: "api",
          key,
        })
        await Auth.setActiveProfile(providerID, finalProfileName)

        prompts.log.success(`Profile "${finalProfileName}" created for ${database[providerID]?.name || providerID}`)
        prompts.outro("Done")
      },
    })
  },
})

export const AuthProfileUseCommand = cmd({
  command: "use <provider>",
  describe: "switch active profile for a provider",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider name",
        type: "string",
      })
      .option("profile", {
        alias: "p",
        type: "string",
        describe: "profile name to activate (will prompt if not provided)",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        // Check for migration first
        await checkAndInformMigration()

        const providerID = args.provider

        // Get existing profiles
        const profiles = await Auth.listProfiles(providerID)
        const profileNames = Object.keys(profiles)

        if (profileNames.length === 0) {
          prompts.log.error(`No profiles found for provider "${providerID}"`)
          prompts.log.info(`Try: opencode auth profile create ${providerID}`)
          return
        }

        let targetProfile = args.profile
        if (!targetProfile) {
          // Prompt for profile selection
          const database = await ModelsDev.get()
          targetProfile = await prompts.select({
            message: `Select profile for ${database[providerID]?.name || providerID}:`,
            options: profileNames.map((name) => ({
              label: name,
              value: name,
            })),
          })
          if (prompts.isCancel(targetProfile)) throw new UI.CancelledError()
        }

        if (!profiles[targetProfile]) {
          prompts.log.error(`Profile "${targetProfile}" not found for provider "${providerID}"`)
          prompts.log.info(`Available profiles: ${profileNames.join(", ")}`)
          return
        }

        await Auth.setActiveProfile(providerID, targetProfile)
        prompts.log.success(`Switched to profile "${targetProfile}" for ${providerID}`)
        prompts.outro("Done")
      },
    })
  },
})

export const AuthProfileListCommand = cmd({
  command: "list [provider]",
  aliases: ["ls"],
  describe: "list profiles for a provider (or all providers)",
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        // Check for migration first
        await checkAndInformMigration()

        if (args.provider) {
          // List profiles for specific provider
          const profiles = await Auth.listProfiles(args.provider)
          const profileNames = Object.keys(profiles)

          if (profileNames.length === 0) {
            prompts.log.info(`No profiles found for provider "${args.provider}"`)
            return
          }

          const database = await ModelsDev.get()
          const currentProfile = (await Auth.allWithProfiles())[args.provider]?.currentProfile || "default"

          prompts.intro(`Profiles for ${database[args.provider]?.name || args.provider}:`)

          for (const profileName of profileNames) {
            const auth = profiles[profileName]
            const isActive = profileName === currentProfile
            const indicator = isActive ? "→" : " "
            const prefix = auth.type === "oauth" ? "OAuth" : "API "
            prompts.log.info(
              `${indicator}  ${profileName}: ${prefix}${auth.type === "api" ? "Key" : ""}${auth.type === "oauth" ? "Token" : ""}`,
            )
          }

          prompts.outro(`${profileNames.length} profile${profileNames.length === 1 ? "" : "s"}`)
        } else {
          // List profiles for all providers
          prompts.intro("All profiles:")

          const authData = await Auth.allWithProfiles()
          const providers = Object.entries(authData)
          const database = await ModelsDev.get()

          for (const [providerID, provider] of providers) {
            const providerName = database[providerID]?.name || providerID
            const currentProfile = provider.currentProfile || "default"
            const profiles = Object.keys(provider.profiles)

            prompts.log.info(
              `${providerName} ${UI.Style.TEXT_DIM}(${profiles.length} profile${profiles.length === 1 ? "" : "s"}, active: ${currentProfile})`,
            )

            for (const profileID of profiles) {
              const auth = provider.profiles[profileID]
              const isActive = profileID === currentProfile
              const indicator = isActive ? "→" : " "
              const prefix = auth.type === "oauth" ? "OAuth" : "API "
              prompts.log.info(
                `${indicator}  ${profileID}: ${prefix}${auth.type === "api" ? "Key" : ""}${auth.type === "oauth" ? "Token" : ""}`,
              )
            }
          }

          prompts.outro(`${providers.length} provider${providers.length === 1 ? "" : "s"}`)
        }
      },
    })
  },
})

export const AuthProfileRemoveCommand = cmd({
  command: "remove <provider>",
  describe: "remove a profile from a provider",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider name",
        type: "string",
      })
      .option("profile", {
        alias: "p",
        type: "string",
        describe: "profile name to remove (required)",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        if (!args.profile) {
          prompts.log.error("Profile name is required. Use --profile or -p to specify.")
          prompts.log.info(`Example: opencode auth profile remove ${args.provider} --profile personal`)
          return
        }

        // Check for migration first
        await checkAndInformMigration()

        const profiles = await Auth.listProfiles(args.provider)
        if (!profiles[args.profile]) {
          prompts.log.error(`Profile "${args.profile}" not found for provider "${args.provider}"`)
          const profileNames = Object.keys(profiles)
          if (profileNames.length > 0) {
            prompts.log.info(`Available profiles: ${profileNames.join(", ")}`)
          }
          return
        }

        const database = await ModelsDev.get()
        await Auth.removeProfile(args.provider, args.profile)

        prompts.log.success(`Removed profile "${args.profile}" from ${database[args.provider]?.name || args.provider}`)
        prompts.outro("Done")
      },
    })
  },
})

async function checkAndInformMigration(): Promise<void> {
  const migrated = await Auth.migrate()
  if (migrated) {
    prompts.log.info("Your authentication has been automatically upgraded to support multiple accounts!")
    prompts.log.info("Your existing credentials have been saved as a 'default' profile.")
    prompts.log.info("Try these new commands:")
    prompts.log.info("   opencode auth profile create <provider> <profile-name>")
    prompts.log.info("   opencode auth profile list <provider>")
    prompts.log.info("   opencode auth profile use <provider> <profile-name>")
    prompts.log.info('   opencode run --profile <profile-name> "your prompt"')
    UI.empty()
  }
}


export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .command(AuthProfileCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  builder: (yargs) =>
    yargs.option("profiles", {
      alias: "p",
      type: "boolean",
      describe: "show detailed profile information",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        // Check for migration first
        await checkAndInformMigration()

        const authPath = path.join(Global.Path.data, "auth.json")
        const homedir = os.homedir()
        const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
        prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)

        if (args.profiles) {
          // Show detailed profile information
          const authData = await Auth.allWithProfiles()
          const providers = Object.entries(authData)
          const database = await ModelsDev.get()

          for (const [providerID, provider] of providers) {
            const providerName = database[providerID]?.name || providerID
            const currentProfile = provider.currentProfile || "default"
            const profiles = Object.keys(provider.profiles)

            prompts.log.info(
              `${providerName} ${UI.Style.TEXT_DIM}(${profiles.length} profile${profiles.length === 1 ? "" : "s"}, active: ${currentProfile})`,
            )

            for (const profileID of profiles) {
              const auth = provider.profiles[profileID]
              const isActive = profileID === currentProfile
              const indicator = isActive ? "→" : " "
              const prefix = auth.type === "oauth" ? "OAuth" : "API "
              prompts.log.info(
                `${indicator}  ${profileID}: ${prefix}${auth.type === "api" ? "Key" : ""}${auth.type === "oauth" ? "Token" : ""}`,
              )
            }
          }

          prompts.outro(`${providers.length} provider${providers.length === 1 ? "" : "s"}`)
        } else {
          // Show current profile per provider (backward compatible)
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
        }
      },
    })
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
      .option("profile", {
        alias: "p",
        type: "string",
        describe: "profile name for this credential (default: 'default')",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")

        // Check for migration first
        await checkAndInformMigration()
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
          const profileID = args.profile || "default"
          await Auth.addProfile(args.url, profileID, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: token.trim(),
          })
          await Auth.setActiveProfile(args.url, profileID)
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
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider, args.profile)
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
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider, args.profile)
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

        const profileID = args.profile || "default"

        // Prompt for profile name if not provided and this is the first login
        let finalProfileID = profileID
        if (!args.profile) {
          const profileName = await prompts.text({
            message: "Enter profile name (leave empty for 'default'):",
            placeholder: "default",
            validate: (name) => {
              if (!name || name.trim() === "") return undefined
              if (name.length > 50) return "Profile name too long (max 50 characters)"
              if (name.includes("/") || name.includes("\\")) return "Profile name cannot contain slashes"
              return undefined
            },
          })
          if (prompts.isCancel(profileName)) throw new UI.CancelledError()
          finalProfileID = profileName.trim() || "default"
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()

        const existing = await Auth.listProfiles(provider)
        if (existing[finalProfileID]) {
          const overwrite = await prompts.confirm({
            message: `Profile "${finalProfileID}" already exists. Overwrite?`,
          })
          if (prompts.isCancel(overwrite) || !overwrite) throw new UI.CancelledError()
        }

        await Auth.addProfile(provider, finalProfileID, {
          type: "api",
          key,
        })
        await Auth.setActiveProfile(provider, finalProfileID)

        prompts.log.success(`Login successful (profile: ${finalProfileID})`)
        prompts.outro("Done")
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  builder: (yargs) =>
    yargs.option("profile", {
      alias: "p",
      type: "string",
      describe: "specific profile to remove (removes entire provider if not specified)",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        // Check for migration first
        await checkAndInformMigration()

        const authData = await Auth.allWithProfiles()
        const providers = Object.entries(authData)

        prompts.intro("Remove credential")
        if (providers.length === 0) {
          prompts.log.error("No credentials found")
          return
        }

        const database = await ModelsDev.get()

        if (args.profile) {
          // Remove specific profile
          const providerID = await prompts.select({
            message: "Select provider",
            options: providers.map(([key, value]) => ({
              label:
                (database[key]?.name || key) + UI.Style.TEXT_DIM + ` (${Object.keys(value.profiles).length} profiles)`,
              value: key,
            })),
          })
          if (prompts.isCancel(providerID)) throw new UI.CancelledError()

          const profiles = await Auth.listProfiles(providerID)
          if (!profiles[args.profile]) {
            prompts.log.error(`Profile "${args.profile}" not found for provider "${providerID}"`)
            prompts.log.info(`Available profiles: ${Object.keys(profiles).join(", ")}`)
            return
          }

          await Auth.removeProfile(providerID, args.profile)
          prompts.log.success(`Removed profile "${args.profile}" from ${database[providerID]?.name || providerID}`)
        } else {
          // Remove entire provider
          const providerID = await prompts.select({
            message: "Select provider to remove",
            options: providers.map(([key, value]) => {
              const currentProfile = value.currentProfile || "default"
              const profileCount = Object.keys(value.profiles).length
              return {
                label:
                  (database[key]?.name || key) +
                  UI.Style.TEXT_DIM +
                  ` (${profileCount} profile${profileCount === 1 ? "" : "s"}, current: ${currentProfile})`,
                value: key,
              }
            }),
          })
          if (prompts.isCancel(providerID)) throw new UI.CancelledError()

          await Auth.remove(providerID)
          prompts.log.success(`Removed all profiles from ${database[providerID]?.name || providerID}`)
        }

        prompts.outro("Logout successful")
      },
    })
  },
})
