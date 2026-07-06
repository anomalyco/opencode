import * as Log from "@opencode-ai/core/util/log"
import os from "os"
import { Config } from "@/config/config"
import { Effect, Layer } from "effect"
import { withGlobalConfigLock } from "./config-lock"
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

function ownIPs(): Set<string> {
  const ips = new Set<string>()
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      ips.add(iface.address)
    }
  }
  return ips
}

function canonicalName(name: string) {
  return name
    .replace(/\.local\.?$/i, "")
    .replace(/\.localdomain\.?$/i, "")
    .replace(/-llama-?swap$/i, "")
    .trim()
}

type ProviderEntry = {
  npm?: string
  name?: string
  options?: { baseURL?: string; apiKey?: string }
}

// Entries this sync created carry apiKey "skein"; only those may be
// auto-corrected or removed. Hand-written providers are never touched.
function isAutoDiscovered(p: unknown): boolean {
  const entry = p as ProviderEntry
  return entry?.npm === "@ai-sdk/openai-compatible" && entry?.options?.apiKey === "skein"
}

function baseURLHost(baseURL: string | undefined): string {
  if (!baseURL) return ""
  try {
    return new URL(baseURL).hostname
  } catch {
    return ""
  }
}

// syncLocalProviders scans for local llama-swap providers via mDNS + LAN probe
// and upserts them into the global opencode config.
//
// Existing providers whose baseURL has changed (stale IP) are updated in place
// by matching on the derived slug — mDNS identity (the machine's own TXT
// advertisement) is authoritative for which name maps to which address.
// Reverse-DNS names from the LAN fallback are weak (routers serve stale DHCP
// lease names) and may only add brand-new entries, never modify existing ones.
// Providers not found in the scan are left untouched — they may be offline.
const syncLocalProviders = Effect.gen(function* () {
  const configSvc = yield* Config.Service
  const discovered = yield* Effect.promise(() => scanLlamaSwap(1000, false))
  const online = discovered.filter((svc) => svc.online)

  if (online.length === 0) {
    log.info("no local providers found")
    return
  }

  log.info("found local providers", { count: online.length, names: online.map((s) => s.name) })

  // The read-modify-write below runs under the global config lock — the scan
  // above is lock-free (slow, network), but the config must be read and
  // written back atomically w.r.t. /connect and /disconnect.
  yield* withGlobalConfigLock(
    Effect.gen(function* () {
      const global = yield* configSvc.getGlobal()
      const providers = { ...(global.provider ?? {}) }

      const selfIPs = ownIPs()
      const selfSlug = providerIDFromName(canonicalName(os.hostname()))
      let changed = false

      // Prune auto-discovered entries that point at one of this machine's own LAN
      // IPs under a different machine's name (e.g. "m5" left pointing at an
      // address DHCP later reassigned to this host). Such an entry is definitively
      // wrong — it dispatches another machine's traffic to us — and it can never
      // be healed by the loop below because own IPs are skipped there. Loopback
      // entries (an intentional local provider) are kept.
      for (const [id, p] of Object.entries(providers)) {
        if (!isAutoDiscovered(p)) continue
        const host = baseURLHost((p as ProviderEntry).options?.baseURL)
        if (!host || host === "localhost" || host.startsWith("127.")) continue
        if (selfIPs.has(host) && id !== selfSlug) {
          delete providers[id]
          log.info("removed stale provider pointing at own IP", { id, host })
          changed = true
        }
      }

      for (const svc of online) {
        // Skip own IPs — this machine's own llama-swap is configured via
        // localhost, not via a LAN address that DHCP may reassign.
        if (selfIPs.has(svc.host)) continue

        const norm = normalizeBaseURL(svc.baseURL)
        const name = canonicalName(svc.name)
        const slug = providerIDFromName(name || svc.name)
        const urlOwner = Object.entries(providers).find(
          ([, p]) => normalizeBaseURL(String((p as ProviderEntry).options?.baseURL ?? "")) === norm,
        )?.[0]

        if (urlOwner === slug) {
          // Already configured correctly at this exact URL — nothing to do.
          continue
        }

        if (svc.source === "lan") {
          // Reverse-DNS identity: only add when neither this URL nor this name is
          // known. Never rename or re-point existing entries on a weak name.
          if (urlOwner || slug in providers) continue
          providers[slug] = {
            npm: "@ai-sdk/openai-compatible",
            name,
            options: { baseURL: svc.baseURL, apiKey: "skein" },
            discoverModels: true,
          }
          log.info("added provider", { slug, baseURL: svc.baseURL, source: svc.source, defaultModel: svc.defaultModel })
          changed = true
          continue
        }

        // mDNS identity is authoritative for slug → URL.
        if (slug in providers) {
          // Provider exists but IP has changed — update baseURL in place.
          const existing = providers[slug] as ProviderEntry
          const oldURL = existing.options?.baseURL ?? ""
          providers[slug] = { ...(existing as object), options: { ...(existing.options ?? {}), baseURL: svc.baseURL } }
          log.info("updated provider baseURL", { slug, old: oldURL, new: svc.baseURL, defaultModel: svc.defaultModel })
          changed = true
        } else {
          providers[slug] = {
            npm: "@ai-sdk/openai-compatible",
            name,
            options: { baseURL: svc.baseURL, apiKey: "skein" },
            discoverModels: true,
          }
          log.info("added provider", { slug, baseURL: svc.baseURL, source: svc.source, defaultModel: svc.defaultModel })
          changed = true
        }

        // A different auto-discovered entry occupying this machine's URL is a
        // stale duplicate (e.g. "mac" → the IP that mDNS just proved belongs to
        // "m5"). Remove it so it stops shadowing the canonical entry.
        if (urlOwner && urlOwner !== slug && isAutoDiscovered(providers[urlOwner])) {
          delete providers[urlOwner]
          log.info("removed duplicate provider for same baseURL", { id: urlOwner, kept: slug, baseURL: svc.baseURL })
          changed = true
        }
      }

      if (changed) yield* configSvc.updateGlobal({ ...global, provider: providers }, { replace: ["provider"] })
    }),
  )
})

export const layer = Layer.effectDiscard(
  syncLocalProviders.pipe(
    Effect.catch((err) => Effect.sync(() => log.error("sync failed", { error: String(err) }))),
    Effect.forkScoped,
  ),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as LocalProviderSync from "./sync"
