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
import { t } from "../../i18n"
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
      message: t("auth.login_method"),
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
      prompts.log.info(t("auth.go_to", { url: authorize.url }))
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start(t("auth.waiting_for_auth"))
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop(t("auth.failed_to_authorize"), 1)
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
        spinner.stop(t("auth.login_successful"))
      }
    }

    if (authorize.method === "code") {
      const code = await prompts.text({
        message: t("auth.paste_code"),
        validate: (x) => (x && x.length > 0 ? undefined : t("auth.required")),
      })
      if (prompts.isCancel(code)) throw new UI.CancelledError()
      const result = await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error(t("auth.failed_to_authorize"))
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
        prompts.log.success(t("auth.login_successful"))
      }
    }

    prompts.outro(t("upgrade.done"))
    return true
  }

  if (method.type === "api") {
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error(t("auth.failed_to_authorize"))
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        await Auth.set(saveProvider, {
          type: "api",
          key: result.key,
        })
        prompts.log.success(t("auth.login_successful"))
      }
      prompts.outro(t("upgrade.done"))
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
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`${t("auth.credentials")} ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(t("auth.credentials_count", { count: String(results.length) }))

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
      prompts.intro(t("auth.environment"))

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(
        activeEnvVars.length === 1
          ? t("auth.env_var_count", { count: String(activeEnvVars.length) })
          : t("auth.env_vars_count", { count: String(activeEnvVars.length) }),
      )
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
        prompts.intro(t("auth.add_credential"))
        if (args.url) {
          const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json() as any)
          prompts.log.info(t("auth.running_command", { command: wellknown.auth.command.join(" ") }))
          const proc = Bun.spawn({
            cmd: wellknown.auth.command,
            stdout: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            prompts.log.error(t("auth.failed"))
            prompts.outro(t("upgrade.done"))
            return
          }
          const token = await new Response(proc.stdout).text()
          await Auth.set(args.url, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: token.trim(),
          })
          prompts.log.success(t("auth.logged_into", { url: args.url }))
          prompts.outro(t("upgrade.done"))
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
          message: t("auth.select_provider"),
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
                  opencode: t("auth.recommended"),
                  anthropic: t("auth.claude_max_or_api"),
                }[x.id],
              })),
            ),
            {
              value: "other",
              label: t("auth.other"),
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
            message: t("auth.enter_provider_id"),
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : t("auth.provider_id_format")),
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

          prompts.log.warn(t("auth.custom_provider_warning", { provider }))
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(t("auth.bedrock_info"))
          prompts.outro(t("upgrade.done"))
          return
        }

        if (provider === "opencode") {
          prompts.log.info(t("auth.opencode_info"))
        }

        if (provider === "vercel") {
          prompts.log.info(t("auth.vercel_info"))
        }

        if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
          prompts.log.info(t("auth.cloudflare_info"))
        }

        const key = await prompts.password({
          message: t("auth.enter_api_key"),
          validate: (x) => (x && x.length > 0 ? undefined : t("auth.required")),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(provider, {
          type: "api",
          key,
        })

        prompts.outro(t("upgrade.done"))
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
    prompts.intro(t("auth.remove_credential"))
    if (credentials.length === 0) {
      prompts.log.error(t("auth.no_credentials"))
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: t("auth.select_provider"),
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro(t("auth.logout_successful"))
  },
})
