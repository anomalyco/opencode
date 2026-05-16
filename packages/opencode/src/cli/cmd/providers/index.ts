import { Auth } from "../../../auth"
import { cmd } from "../cmd"
import { effectCmd, fail } from "../../effect-cmd"
import { UI } from "../../ui"
import * as Prompt from "../../effect/prompt"
import { ModelsDev } from "@opencode-ai/core/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import { Plugin } from "@/plugin"
import { Process } from "@/util/process"
import { text } from "node:stream/consumers"
import { Effect, Option } from "effect"
import { cliTry, handlePluginAuth, resolvePluginProviders } from "./plugin-auth"
import { AuthBrowserCommand } from "./browser-cmds"
import { AuthRenameCommand } from "./account-cmds"

export { resolvePluginProviders } from "./plugin-auth"

const promptValue = <Value>(value: Option.Option<Value>) => {
  if (Option.isNone(value)) return Effect.die(new UI.CancelledError())
  return Effect.succeed(value.value)
}

export const ProvidersCommand = cmd({
  command: "providers",
  aliases: ["auth"],
  describe: "manage AI providers and credentials",
  builder: (yargs) =>
    yargs
      .command(ProvidersListCommand)
      .command(ProvidersLoginCommand)
      .command(ProvidersLogoutCommand)
      .command(AuthBrowserCommand)
      .command(AuthRenameCommand)
      .demandCommand(),
  async handler() {},
})

export const ProvidersListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers and credentials",
  instance: false,
  handler: Effect.fn("Cli.providers.list")(function* (_args) {
    const authSvc = yield* Auth.Service
    const modelsDev = yield* ModelsDev.Service

    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    yield* Prompt.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(yield* Effect.orDie(authSvc.all()))
    const database = yield* modelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      if (result.type === "oauth") {
        const accounts = yield* Effect.promise(() => Auth.OAuthPool.list(providerID, "default"))
        const { activeID } = yield* Effect.promise(() => Auth.OAuthPool.snapshot(providerID, "default"))
        if (accounts.length <= 1) {
          yield* Prompt.log.info(`${name} ${UI.Style.TEXT_DIM}oauth · ${accounts[0]?.label ?? "default"}`)
        } else {
          yield* Prompt.log.info(`${name} ${UI.Style.TEXT_DIM}oauth · ${accounts.length} accounts`)
          for (const account of accounts) {
            const marker = account.id === activeID ? " ✓ active" : ""
            yield* Prompt.log.info(`  ${UI.Style.TEXT_DIM}${account.label ?? account.id.slice(0, 8)}${marker}`)
          }
        }
      } else {
        yield* Prompt.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
      }
    }

    yield* Prompt.outro(`${results.length} credentials`)

    const activeEnvVars: Array<{ provider: string; envVar: string }> = []
    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) activeEnvVars.push({ provider: provider.name || providerID, envVar })
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      yield* Prompt.intro("Environment")
      for (const { provider, envVar } of activeEnvVars) {
        yield* Prompt.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }
      yield* Prompt.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  }),
})

export const ProvidersLoginCommand = effectCmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs
      .positional("url", { describe: "opencode auth provider", type: "string" })
      .option("provider", { alias: ["p"], describe: "provider id or name to log in to", type: "string" })
      .option("method", { alias: ["m"], describe: "login method label", type: "string" }),
  handler: Effect.fn("Cli.providers.login")(function* (args) {
    const authSvc = yield* Auth.Service

    UI.empty()
    yield* Prompt.intro("Add credential")

    if (args.url) {
      const url = args.url.replace(/\/+$/, "")
      const wellknown = (yield* cliTry(`Failed to load auth provider metadata from ${url}: `, () =>
        fetch(`${url}/.well-known/opencode`).then((x) => x.json()),
      )) as { auth: { command: string[]; env: string } }
      yield* Prompt.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
      const abort = new AbortController()
      const proc = Process.spawn(wellknown.auth.command, { stdout: "pipe", stderr: "inherit", abort: abort.signal })
      if (!proc.stdout) {
        yield* Prompt.log.error("Failed")
        yield* Prompt.outro("Done")
        return
      }
      const [exit, token] = yield* cliTry("Failed to run auth provider command: ", () =>
        Promise.all([proc.exited, text(proc.stdout!)]),
      ).pipe(Effect.ensuring(Effect.sync(() => abort.abort())))
      if (exit !== 0) {
        yield* Prompt.log.error("Failed")
        yield* Prompt.outro("Done")
        return
      }
      yield* Effect.orDie(authSvc.set(url, { type: "wellknown", key: wellknown.auth.env, token: token.trim() }))
      yield* Prompt.log.success("Logged into " + url)
      yield* Prompt.outro("Done")
      return
    }

    const cfgSvc = yield* Config.Service
    const pluginSvc = yield* Plugin.Service
    const modelsDev = yield* ModelsDev.Service
    yield* Effect.ignore(modelsDev.refresh(true))

    const config = yield* cfgSvc.get()
    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

    const allProviders = yield* modelsDev.get()
    const providers: Record<string, (typeof allProviders)[string]> = {}
    for (const [key, value] of Object.entries(allProviders)) {
      if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) providers[key] = value
    }
    const hooks = yield* pluginSvc.list()

    const priority: Record<string, number> = {
      opencode: 0, openai: 1, "github-copilot": 2, google: 3, anthropic: 4, openrouter: 5, vercel: 6,
    }
    const pluginProviders = resolvePluginProviders({
      hooks,
      existingProviders: providers,
      disabled,
      enabled,
      providerNames: Object.fromEntries(Object.entries(config.provider ?? {}).map(([id, p]) => [id, p.name])),
    })
    const options = [
      ...pipe(
        providers,
        values(),
        sortBy((x) => priority[x.id] ?? 99, (x) => x.name ?? x.id),
        map((x) => ({
          label: x.name,
          value: x.id,
          hint: { opencode: "recommended", openai: "ChatGPT Plus/Pro or API key" }[x.id],
        })),
      ),
      ...pluginProviders.map((x) => ({ label: x.name, value: x.id, hint: "plugin" })),
    ]

    let provider: string
    if (args.provider) {
      const input = args.provider
      const match = options.find((x) => x.value === input) ?? options.find((x) => x.label.toLowerCase() === input.toLowerCase())
      if (!match) return yield* fail(`Unknown provider "${input}"`)
      provider = match.value
    } else {
      provider = yield* promptValue(
        yield* Prompt.autocomplete({
          message: "Select provider",
          maxItems: 8,
          options: [...options, { value: "other", label: "Other" }],
        }),
      )
    }

    const plugin = hooks.findLast((x) => x.auth?.provider === provider)
    if (plugin && plugin.auth) {
      const handled = yield* handlePluginAuth({ auth: plugin.auth! }, provider, args.method)
      if (handled) return
    }

    if (provider === "other") {
      provider = (yield* promptValue(
        yield* Prompt.text({
          message: "Enter provider id",
          validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
        }),
      )).replace(/^@ai-sdk\//, "")

      const customPlugin = hooks.findLast((x) => x.auth?.provider === provider)
      if (customPlugin && customPlugin.auth) {
        const handled = yield* handlePluginAuth({ auth: customPlugin.auth! }, provider, args.method)
        if (handled) return
      }

      yield* Prompt.log.warn(
        `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
      )
    }

    if (provider === "amazon-bedrock") {
      yield* Prompt.log.info(
        "Amazon Bedrock authentication priority:\n" +
          "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
          "  2. AWS credential chain (profile, access keys, IAM roles, EKS IRSA)\n\n" +
          "Configure via opencode.json options (profile, region, endpoint) or\n" +
          "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_WEB_IDENTITY_TOKEN_FILE).",
      )
    }
    if (provider === "opencode") yield* Prompt.log.info("Create an api key at https://opencode.ai/auth")
    if (provider === "vercel") yield* Prompt.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
    if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
      yield* Prompt.log.info(
        "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://opencode.ai/docs/providers/#cloudflare-ai-gateway",
      )
    }

    const key = yield* Prompt.password({
      message: "Enter your API key",
      validate: (x) => (x && x.length > 0 ? undefined : "Required"),
    })
    const apiKey = yield* promptValue(key)
    yield* Effect.orDie(authSvc.set(provider, { type: "api", key: apiKey }))
    yield* Prompt.outro("Done")
  }),
})

export const ProvidersLogoutCommand = effectCmd({
  command: "logout",
  describe: "log out from a configured provider",
  instance: false,
  handler: Effect.fn("Cli.providers.logout")(function* (_args) {
    const authSvc = yield* Auth.Service
    const modelsDev = yield* ModelsDev.Service

    UI.empty()
    const credentials: Array<[string, Auth.Info]> = Object.entries(yield* Effect.orDie(authSvc.all()))
    yield* Prompt.intro("Remove credential")
    if (credentials.length === 0) {
      yield* Prompt.log.error("No credentials found")
      return
    }
    const database = yield* modelsDev.get()
    const selected = yield* Prompt.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    yield* Effect.orDie(authSvc.remove(yield* promptValue(selected)))
    yield* Prompt.outro("Logout successful")
  }),
})
