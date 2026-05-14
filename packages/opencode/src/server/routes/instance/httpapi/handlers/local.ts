import { Config } from "@/config/config"
import { scanLlamaSwap } from "@/local/mdns"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

function normalizeBaseURL(url: string) {
  return url.replace(/\/+$/, "").toLowerCase()
}

function providerIDFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export const localHandlers = HttpApiBuilder.group(InstanceHttpApi, "local", (handlers) =>
  Effect.gen(function* () {
    const configSvc = yield* Config.Service

    const scan = Effect.fn("LocalHttpApi.scan")(function* () {
      const global = yield* configSvc.getGlobal()

      // Build a lookup: normalized baseURL → config provider ID
      const configuredByURL = new Map<string, string>()
      for (const [id, p] of Object.entries(global.provider ?? {})) {
        const base = normalizeBaseURL(String(p.options?.baseURL ?? ""))
        if (base) configuredByURL.set(base, id)
      }

      const discovered = yield* Effect.promise(() => scanLlamaSwap(4000))

      return discovered.map((svc) => ({
        id: providerIDFromName(svc.name),
        name: svc.name,
        host: svc.host,
        port: svc.port,
        baseURL: svc.baseURL,
        models: [...svc.models],
        configuredProviderID: configuredByURL.get(normalizeBaseURL(svc.baseURL)),
      }))
    })

    const connect = Effect.fn("LocalHttpApi.connect")(function* (ctx) {
      const { id, name, baseURL } = ctx.payload
      const global = yield* configSvc.getGlobal()
      const providers = { ...(global.provider ?? {}) }
      // Reuse existing key if same baseURL already configured (e.g. written by sync-opencode)
      const normalised = normalizeBaseURL(baseURL)
      const existingKey = Object.entries(providers).find(
        ([, p]) => normalizeBaseURL(String((p as { options?: { baseURL?: string } }).options?.baseURL ?? "")) === normalised,
      )?.[0]
      const key = existingKey ?? id
      providers[key] = {
        npm: "@ai-sdk/openai-compatible",
        name,
        options: { baseURL },
      }
      yield* configSvc.updateGlobal({ ...global, provider: providers })
      return key
    })

    const disconnect = Effect.fn("LocalHttpApi.disconnect")(function* (ctx) {
      const { providerID } = ctx.pathParams
      const global = yield* configSvc.getGlobal()
      const providers = { ...(global.provider ?? {}) }
      delete providers[providerID]
      yield* configSvc.updateGlobal({ ...global, provider: providers })
      return providerID
    })

    return handlers.handle("scan", scan).handle("connect", connect).handle("disconnect", disconnect)
  }),
)
