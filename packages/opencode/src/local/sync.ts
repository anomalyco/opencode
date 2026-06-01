import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import { Effect, Layer } from "effect"
import { scanLlamaSwap } from "./mdns"

const log = Log.create({ service: "local-provider-sync" })

function normalizeBaseURL(url: string) {
  return url.replace(/\/+$/, "").toLowerCase()
}

function providerIDFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function canonicalName(name: string) {
  return name
    .replace(/\.local\.?$/i, "")
    .replace(/\.localdomain\.?$/i, "")
    .replace(/-llama-?swap$/i, "")
    .trim()
}

// syncLocalProviders scans for local llama-swap providers via mDNS + LAN probe
// and upserts them into the global opencode config.
//
// Existing providers whose baseURL has changed (stale IP) are updated in place
// by matching on the derived slug. Providers not found in the scan are left
// untouched — they may simply be offline.
const syncLocalProviders = Effect.gen(function* () {
  const configSvc = yield* Config.Service
  const discovered = yield* Effect.promise(() => scanLlamaSwap(4000))
  const online = discovered.filter((svc) => svc.online)

  if (online.length === 0) {
    log.info("no local providers found")
    return
  }

  log.info("found local providers", { count: online.length, names: online.map((s) => s.name) })

  const global = yield* configSvc.getGlobal()
  const providers = { ...(global.provider ?? {}) }

  // Index existing providers by normalized baseURL to skip already-correct entries.
  const existingByURL = new Map<string, string>()
  for (const [id, p] of Object.entries(providers)) {
    const base = normalizeBaseURL(String((p as { options?: { baseURL?: string } }).options?.baseURL ?? ""))
    if (base) existingByURL.set(base, id)
  }

  let changed = false
  for (const svc of online) {
    const norm = normalizeBaseURL(svc.baseURL)
    const name = canonicalName(svc.name)
    const slug = providerIDFromName(name || svc.name)

    if (existingByURL.has(norm)) {
      // Already configured at this exact URL — nothing to do.
      continue
    }

    if (slug in providers) {
      // Provider exists but IP has changed — update baseURL in place.
      const existing = providers[slug] as { options?: { baseURL?: string } }
      const oldURL = existing.options?.baseURL ?? ""
      providers[slug] = { ...(existing as object), options: { ...(existing.options ?? {}), baseURL: svc.baseURL } }
      log.info("updated provider baseURL", { slug, old: oldURL, new: svc.baseURL })
      changed = true
    } else {
      // New provider discovered — add it.
      providers[slug] = {
        npm: "@ai-sdk/openai-compatible",
        name,
        options: { baseURL: svc.baseURL, apiKey: "ollama" },
        discoverModels: true,
      }
      log.info("added provider", { slug, baseURL: svc.baseURL })
      changed = true
    }
  }

  if (changed) yield* configSvc.updateGlobal({ ...global, provider: providers })
})

export const layer = Layer.effectDiscard(
  syncLocalProviders.pipe(
    Effect.catch((err) => Effect.sync(() => log.error("sync failed", { error: String(err) }))),
    Effect.forkScoped,
  ),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as LocalProviderSync from "./sync"
