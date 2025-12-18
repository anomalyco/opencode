import path from "path"
import z from "zod"
import { Global } from "@/global"
import { VaultFS } from "@/vault/fs"
import { Log } from "@/util/log"
import { RotatingFetch } from "@/inference/rotating-fetch"
import { CredentialStore } from "@/credentials"
import { ProviderAuthRegistry } from "@/provider-auth/registry"

const log = Log.create({ service: "provider.model-discovery" })

const CacheFile = z
  .object({
    version: z.literal(1),
    baseURL: z.string(),
    fetchedAt: z.number(),
    modelIds: z.array(z.string()),
  })
  .strict()
type CacheFile = z.infer<typeof CacheFile>

function cachePath(providerId: string, namespace: string): string {
  const safeProvider = encodeURIComponent(providerId)
  const safeNamespace = encodeURIComponent(namespace)
  return path.join(Global.Path.cache, "model-discovery", `${safeProvider}__${safeNamespace}.json`)
}

function withoutTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.replace(/\/+$/, "") : url
}

function baseHasV1(baseURL: string): boolean {
  return /\/v1($|\/)/.test(baseURL)
}

async function tryFetchModels(args: {
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  url: string
  headers: Headers
  timeoutMs: number
}): Promise<string[] | undefined> {
  const resp = await args.fetchFn(args.url, {
    method: "GET",
    headers: args.headers,
    signal: AbortSignal.timeout(args.timeoutMs),
  })

  if (!resp.ok) return undefined
  const json = await resp.json().catch(() => undefined)
  const data = (json as any)?.data
  if (!Array.isArray(data)) return undefined

  const ids = data
    .map((item: any) => (item && typeof item === "object" ? item.id : undefined))
    .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)

  return Array.from(new Set(ids)).sort()
}

export namespace ModelDiscovery {
  const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000 // 12h
  const DEFAULT_TIMEOUT_MS = 10_000

  export type Options = {
    providerId: string
    namespace: string
    baseURL: string
    authMode: "auto" | "api" | "subscription"
    apiKey?: string
    headers?: Record<string, string>
    ttlMs?: number
    timeoutMs?: number
    maxAttempts?: number
  }

  export async function discover(opts: Options): Promise<string[]> {
    const namespace = opts.namespace.trim() || "default"
    const baseURL = withoutTrailingSlash(opts.baseURL.trim())
    if (!baseURL) return []

    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const filePath = cachePath(opts.providerId, namespace)
    const cachedRaw = await VaultFS.readJson<unknown>(filePath)
    const cached = CacheFile.safeParse(cachedRaw)
    if (cached.success) {
      const fresh = Date.now() - cached.data.fetchedAt < ttlMs
      const sameBase = cached.data.baseURL === baseURL
      if (fresh && sameBase) return cached.data.modelIds
    }

    const canonicalProviderId = ProviderAuthRegistry.resolveProviderId(opts.providerId)
    const adapter = ProviderAuthRegistry.getAdapter(canonicalProviderId)

    const headers = new Headers({
      Accept: "application/json",
      ...(opts.headers ?? {}),
    })

    let fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch

    const providerIds = ProviderAuthRegistry.equivalentProviderIds(opts.providerId)
    const oauthRecords = (
      await Promise.all(providerIds.map((id) => CredentialStore.findByProvider(id, namespace)))
    )
      .flat()
      .filter((r) => r.meta.kind === "oauth")

    const shouldUseSubscription = opts.authMode !== "api" && adapter && oauthRecords.length > 0

    if (shouldUseSubscription) {
      fetchFn = RotatingFetch.create(fetchFn, {
        providerId: opts.providerId,
        namespace,
        maxAttempts: opts.maxAttempts,
      })
    } else if (opts.apiKey) {
      headers.set("Authorization", `Bearer ${opts.apiKey}`)
    }

    const candidates: string[] = []
    candidates.push(`${baseURL}/models`)
    if (!baseHasV1(baseURL)) {
      candidates.push(`${baseURL}/v1/models`)
    }

    for (const url of candidates) {
      const ids = await tryFetchModels({ fetchFn, url, headers, timeoutMs })
      if (ids && ids.length > 0) {
        const next: CacheFile = { version: 1, baseURL, fetchedAt: Date.now(), modelIds: ids }
        await VaultFS.atomicWriteJson(filePath, next, 0o600).catch((e) => {
          log.debug("failed to write model discovery cache", { providerId: opts.providerId, error: String(e) })
        })
        return ids
      }
    }

    return []
  }
}

