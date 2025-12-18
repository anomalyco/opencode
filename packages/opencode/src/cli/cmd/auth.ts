import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import type { Hooks } from "@opencode-ai/plugin"
import { CredentialStore, CredentialsMigrate } from "../../credentials"
import { ProviderAuthRegistry } from "../../provider-auth/registry"

type PluginAuth = NonNullable<Hooks["auth"]>

async function storeOAuthCredential(args: {
  providerId: string
  access: string
  refresh?: string
  expires?: number
  namespace?: string
  label?: string
  extra?: Record<string, unknown>
}) {
  await CredentialsMigrate.migrateIfNeeded()
  const config = await Config.get()
  const namespace = (args.namespace ?? config.provider?.[args.providerId]?.auth?.namespace ?? "default").trim() || "default"
  const existingOauth = (await CredentialStore.findByProvider(args.providerId, namespace)).filter((r) => r.meta.kind === "oauth")
  const existingLabels = new Set(existingOauth.map((r) => r.meta.label ?? ""))
  const labelBase = args.label?.split("\n")[0]?.trim() || undefined

  const label = (() => {
    if (labelBase) {
      if (!existingLabels.has(labelBase)) return labelBase
      let n = 2
      while (existingLabels.has(`${labelBase}-${n}`)) n++
      return `${labelBase}-${n}`
    }

    const hasDefault = existingLabels.has("default")
    return hasDefault ? `${args.providerId}-${new Date().toISOString()}` : "default"
  })()

  await CredentialStore.put({
    providerId: args.providerId,
    namespace,
    kind: "oauth",
    label,
    secret: {
      accessToken: args.access,
      refreshToken: args.refresh || undefined,
      expiresAt: args.expires || undefined,
      extra: args.extra,
    },
  })
}

async function storeApiCredential(args: { providerId: string; apiKey: string }) {
  await CredentialsMigrate.migrateIfNeeded()
  await CredentialStore.upsertSingleton({
    providerId: args.providerId,
    namespace: "default",
    kind: "api",
    label: "default",
    secret: { apiKey: args.apiKey },
  })
}

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

  let namespace: string | undefined
  let label: string | undefined
  if (method.type === "oauth") {
    const config = await Config.get()
    const defaultNs = config.provider?.[provider]?.auth?.namespace ?? "default"
    const rawNamespace = await prompts.text({
      message: "Namespace (optional)",
      placeholder: defaultNs,
    })
    if (prompts.isCancel(rawNamespace)) throw new UI.CancelledError()
    namespace = rawNamespace.split("\n")[0]?.trim() || defaultNs

    const rawLabel = await prompts.text({
      message: "Account label (optional)",
      placeholder: "default",
    })
    if (prompts.isCancel(rawLabel)) throw new UI.CancelledError()
    label = rawLabel.split("\n")[0]?.trim() || undefined
  }

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
	          await storeOAuthCredential({
	            providerId: saveProvider,
	            refresh,
	            access,
	            expires,
              namespace,
              label,
	            extra: extraFields,
	          })
	        }
		        if ("key" in result) {
		          await storeApiCredential({ providerId: saveProvider, apiKey: result.key })
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
	          await storeOAuthCredential({
	            providerId: saveProvider,
	            refresh,
	            access,
	            expires,
              namespace,
              label,
	            extra: extraFields,
	          })
		        }
		        if ("key" in result) {
		          await storeApiCredential({ providerId: saveProvider, apiKey: result.key })
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
	        await storeApiCredential({ providerId: saveProvider, apiKey: result.key })
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
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "credentials")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    await CredentialsMigrate.migrateIfNeeded()
    const { records, errors } = await CredentialStore.listAll()
    const database = await ModelsDev.get()

    const sorted = [...records].sort((a, b) => {
      if (a.meta.providerId !== b.meta.providerId) return a.meta.providerId.localeCompare(b.meta.providerId)
      if (a.meta.namespace !== b.meta.namespace) return a.meta.namespace.localeCompare(b.meta.namespace)
      return a.meta.createdAt - b.meta.createdAt
    })
    for (const record of sorted) {
      const name = database[record.meta.providerId]?.name || record.meta.providerId
      const label = record.meta.label
        ? `${record.meta.namespace}/${record.meta.label}`
        : `${record.meta.namespace}/${record.meta.id}`
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${record.meta.kind} ${label}`)
    }

    if (errors.length > 0) {
      prompts.log.warn(`${errors.length} credential file(s) could not be read/validated.`)
    }

    prompts.outro(`${records.length} credential record` + (records.length === 1 ? "" : "s"))

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
	          await CredentialsMigrate.migrateIfNeeded()
	          await CredentialStore.upsertSingleton({
	            providerId: args.url,
	            namespace: "default",
	            kind: "wellknown",
	            label: "default",
	            secret: { envKey: wellknown.auth.env, token: token.trim() },
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

	        const core = ProviderAuthRegistry.getAuthHook(provider)
	        if (core) {
	          const handled = await handlePluginAuth({ auth: core as any }, provider)
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

	          const core = ProviderAuthRegistry.getAuthHook(provider)
	          if (core) {
	            const handled = await handlePluginAuth({ auth: core as any }, provider)
	            if (handled) return
	          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
          )
          prompts.outro("Done")
          return
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
	        await storeApiCredential({ providerId: provider, apiKey: key })

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
    await CredentialsMigrate.migrateIfNeeded()
    const { records } = await CredentialStore.listAll()
    const providers = Array.from(new Set(records.map((r) => r.meta.providerId)))
    prompts.intro("Remove credential")
    if (providers.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: providers.map((key) => {
        const name = database[key]?.name || key
        const count = records.filter((r) => r.meta.providerId === key).length
        return {
          label: `${name} ${UI.Style.TEXT_DIM}(${count})`,
          value: key,
        }
      }),
    })
	    if (prompts.isCancel(providerID)) throw new UI.CancelledError()

      const matches = records
        .filter((r) => r.meta.providerId === providerID)
        .sort((a, b) => {
          if (a.meta.namespace !== b.meta.namespace) return a.meta.namespace.localeCompare(b.meta.namespace)
          if ((a.meta.label ?? "") !== (b.meta.label ?? "")) return (a.meta.label ?? "").localeCompare(b.meta.label ?? "")
          return a.meta.createdAt - b.meta.createdAt
        })

      if (matches.length === 0) {
        prompts.log.error("No credentials found for provider")
        prompts.outro("Done")
        return
      }

      const selected = await prompts.multiselect({
        message: "Select credential(s) to remove",
        options: matches.map((r) => {
          const label = r.meta.label ? `${r.meta.namespace}/${r.meta.label}` : `${r.meta.namespace}/${r.meta.id}`
          return {
            label,
            value: r.meta.id,
            hint: r.meta.kind,
          }
        }),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      await Promise.all(selected.map((id) => CredentialStore.remove(id)))
      prompts.outro("Logout successful")
	  },
	})
