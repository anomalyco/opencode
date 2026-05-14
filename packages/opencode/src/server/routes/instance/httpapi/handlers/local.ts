import { Config } from "@/config/config"
import { probeModelIDs, scanLlamaSwap } from "@/local/mdns"
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
        const base = normalizeBaseURL(String((p as { options?: { baseURL?: string } }).options?.baseURL ?? ""))
        if (base) configuredByURL.set(base, id)
      }

      // Collect all openai-compatible providers already in the global config so we
      // can include them in scan results even when mDNS / localhost probing misses them
      // (e.g. remote hosts on a different subnet).
      const configuredEntries: Array<{ id: string; name: string; baseURL: string }> = []
      for (const [id, p] of Object.entries(global.provider ?? {})) {
        const baseURL = normalizeBaseURL(String((p as { options?: { baseURL?: string } }).options?.baseURL ?? ""))
        if (baseURL && (p as { npm?: string }).npm === "@ai-sdk/openai-compatible") {
          configuredEntries.push({ id, name: (p as { name?: string }).name ?? id, baseURL })
        }
      }

      const discovered = yield* Effect.promise<Awaited<ReturnType<typeof scanLlamaSwap>>>(() => scanLlamaSwap(4000))

      // Index mDNS/localhost results by normalised baseURL.
      const byURL = new Map<
        string,
        { id: string; name: string; host: string; port: number; baseURL: string; models: string[]; configuredProviderID?: string }
      >()
      for (const svc of discovered) {
        const norm = normalizeBaseURL(svc.baseURL)
        byURL.set(norm, {
          id: providerIDFromName(svc.name),
          name: svc.name,
          host: svc.host,
          port: svc.port,
          baseURL: svc.baseURL,
          models: [...svc.models],
          configuredProviderID: configuredByURL.get(norm),
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
            return { entry: e, host, port, models }
          }),
        ),
      )
      for (const { entry, host, port, models } of probeResults) {
        byURL.set(entry.baseURL, {
          id: entry.id,
          name: entry.name,
          host,
          port,
          baseURL: entry.baseURL,
          models,
          configuredProviderID: entry.id,
        })
      }

      return [...byURL.values()].map((svc) => ({
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
