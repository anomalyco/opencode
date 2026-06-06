import { Config } from "@/config/config"
import { probeModelIDs, scanLlamaSwap } from "@/local/mdns"
import { createClient, createConfig } from "@/local/llama-skein/gen/client"
import { LlamaSkeinClient } from "@/local/llama-skein/gen/sdk.gen"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

function normalizeBaseURL(url: string) {
  return url.replace(/\/+$/, "").toLowerCase()
}

function isPrivateBaseURL(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname
    if (host === "localhost") return true
    const parts = host.split(".").map(Number)
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      const [a, b] = parts
      if (a === 127) return true
      if (a === 10) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
    }
    return false
  } catch {
    return false
  }
}

function providerIDFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function canonicalServiceName(name: string) {
  return name
    .replace(/\.local\.?$/i, "")
    .replace(/\.localdomain\.?$/i, "")
    .replace(/-llama-?swap$/i, "")
    .trim()
}

function normalizeControlBaseURL(baseURL: string) {
  return baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")
}

function llamaClient(baseURL: string) {
  return new LlamaSkeinClient({
    client: createClient(createConfig({ baseUrl: normalizeControlBaseURL(baseURL) })),
  })
}

export const localHandlers = HttpApiBuilder.group(InstanceHttpApi, "local", (handlers) =>
  Effect.gen(function* () {
    const configSvc = yield* Config.Service

    const scan = Effect.fn("LocalHttpApi.scan")(function* () {
      const config = yield* configSvc.get()

      // Build lookups: normalized baseURL → config provider ID / name
      const configuredByURL = new Map<string, string>()
      const configuredNameByURL = new Map<string, string>()
      for (const [id, p] of Object.entries(config.provider ?? {})) {
        const base = normalizeBaseURL(String((p as { options?: { baseURL?: string } }).options?.baseURL ?? ""))
        if (base) {
          configuredByURL.set(base, id)
          const name = (p as { name?: string }).name
          if (name) configuredNameByURL.set(base, name)
        }
      }

      // Collect all openai-compatible providers already in the global config so we
      // can include them in scan results even when mDNS / localhost probing misses
      // them. Use the effective config for this directory so project-level local
      // providers appear in /connect without requiring a global duplicate.
      const configuredEntries: Array<{ id: string; name: string; baseURL: string }> = []
      for (const [id, p] of Object.entries(config.provider ?? {})) {
        const baseURL = normalizeBaseURL(String((p as { options?: { baseURL?: string } }).options?.baseURL ?? ""))
        if (baseURL && isPrivateBaseURL(baseURL) && (p as { npm?: string }).npm === "@ai-sdk/openai-compatible") {
          configuredEntries.push({ id, name: (p as { name?: string }).name ?? id, baseURL })
        }
      }

      const discovered = yield* Effect.promise<Awaited<ReturnType<typeof scanLlamaSwap>>>(() => scanLlamaSwap(3500))

      // Index mDNS/localhost results by normalised baseURL.
      const byURL = new Map<
        string,
        {
          id: string
          name: string
          host: string
          port: number
          baseURL: string
          online: boolean
          models: string[]
          configuredProviderID?: string
        }
      >()
      for (const svc of discovered) {
        const norm = normalizeBaseURL(svc.baseURL)
        const configuredProviderID = configuredByURL.get(norm)
        const name = configuredNameByURL.get(norm) ?? svc.name
        byURL.set(norm, {
          id: configuredProviderID ?? providerIDFromName(svc.name),
          name,
          host: svc.host,
          port: svc.port,
          baseURL: svc.baseURL,
          online: svc.online,
          models: [...svc.models],
          configuredProviderID,
        })
      }

      // Probe configured providers not already found by scan (parallel, 3 s timeout each).
      const missing = configuredEntries.filter((e) => !byURL.has(e.baseURL))
      const probeResults = yield* Effect.promise(() =>
        Promise.all(
          missing.map(async (e) => {
            const models = await probeModelIDs(e.baseURL)
            let host = ""
            let port = 0
            try {
              const u = new URL(e.baseURL)
              host = u.hostname
              port = Number(u.port) || (u.protocol === "https:" ? 443 : 80)
            } catch {
              host = e.baseURL
            }
            return { entry: e, host, port, models, online: models !== null }
          }),
        ),
      )
      for (const { entry, host, port, models, online } of probeResults) {
        byURL.set(entry.baseURL, {
          id: entry.id,
          name: entry.name,
          host,
          port,
          baseURL: entry.baseURL,
          online,
          models: models ?? [],
          configuredProviderID: entry.id,
        })
      }

      const deduped = new Map<
        string,
        {
          id: string
          name: string
          host: string
          port: number
          baseURL: string
          online: boolean
          models: string[]
          configuredProviderID?: string
        }
      >()
      for (const svc of byURL.values()) {
        const canonicalName = canonicalServiceName(svc.name)
        const canonicalID = providerIDFromName(canonicalName || svc.name)
        const dedupeKey = svc.configuredProviderID ?? canonicalID
        const previous = deduped.get(dedupeKey)
        const hasConfigured = Boolean(svc.configuredProviderID)
        const previousConfigured = Boolean(previous?.configuredProviderID)
        if (!previous || (hasConfigured && !previousConfigured) || svc.models.length > previous.models.length) {
          deduped.set(dedupeKey, {
            ...svc,
            id: svc.configuredProviderID ?? canonicalID,
            name: canonicalName || svc.name,
          })
        }
      }

      return [...deduped.values()].map((svc) => ({
        ...svc,
        baseURL: svc.baseURL,
      }))
    })

    const connect = Effect.fn("LocalHttpApi.connect")(function* (ctx) {
      const { id, name, baseURL } = ctx.payload
      const global = yield* configSvc.getGlobal()
      const providers = { ...(global.provider ?? {}) }
      // Reuse existing key if same baseURL already configured (e.g. written by sync-opencode)
      const normalised = normalizeBaseURL(baseURL)
      const existingKey = Object.entries(providers).find(
        ([, p]) =>
          normalizeBaseURL(String((p as { options?: { baseURL?: string } }).options?.baseURL ?? "")) === normalised,
      )?.[0]
      const key = existingKey ?? id

      providers[key] = {
        npm: "@ai-sdk/openai-compatible",
        name,
        options: { baseURL, apiKey: "skein" },
        discoverModels: true,
      }
      yield* configSvc.updateGlobal({ ...global, provider: providers })
      return key
    })

    const disconnect = Effect.fn("LocalHttpApi.disconnect")(function* (ctx) {
      const { providerID } = ctx.params
      const global = yield* configSvc.getGlobal()
      const providers = { ...(global.provider ?? {}) }
      delete providers[providerID]
      yield* configSvc.updateGlobal({ ...global, provider: providers })
      return providerID
    })

    const setModelCtxSize = Effect.fn("LocalHttpApi.setModelCtxSize")(function* (ctx) {
      const { providerID, modelID } = ctx.params
      const { ctx_size } = ctx.payload
      const config = yield* configSvc.get()
      const baseURL = (config.provider?.[providerID] as { options?: { baseURL?: string } } | undefined)?.options?.baseURL
      if (!baseURL) return false
      const res = yield* Effect.tryPromise(() =>
        llamaClient(baseURL).patchConfigModel({ id: modelID, configModelPatchRequest: { ctx_size } }),
      ).pipe(Effect.orElseSucceed(() => null))
      return res !== null && !res.error
    })

    return handlers
      .handle("scan", scan)
      .handle("connect", connect)
      .handle("disconnect", disconnect)
      .handle("setModelCtxSize", setModelCtxSize)
  }),
)
