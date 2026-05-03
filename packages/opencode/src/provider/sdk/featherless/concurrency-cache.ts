import path from "path"
import fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "featherless.concurrency-cache" })

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_BASE_URL = "https://api.featherless.ai/v1"
const DEFAULT_FETCH_TIMEOUT_MS = 10_000
const DEFAULT_COST_FALLBACK = 1
const CACHE_FILENAME = "featherless-models.json"

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface CacheFile {
  fetchedAt: number
  costs: Record<string, number>
}

interface ModelsApiResponse {
  data: Array<{ id?: string; concurrency_cost?: number }>
}

export interface ConcurrencyCacheOptions {
  apiKey: string
  cacheDir?: string
  baseURL?: string
  ttlMs?: number
  fetch?: FetchLike
  fetchTimeoutMs?: number
  costFallback?: number
}

export class ConcurrencyCache {
  private readonly apiKey: string
  private readonly cacheFile: string
  private readonly baseURL: string
  private readonly ttlMs: number
  private readonly fetchImpl: FetchLike
  private readonly fetchTimeoutMs: number
  private readonly costFallback: number

  private memory: Map<string, number> | undefined
  private fetchedAt = 0
  private inFlight: Promise<void> | undefined

  constructor(opts: ConcurrencyCacheOptions) {
    if (!opts.apiKey) throw new Error("ConcurrencyCache: apiKey is required")
    this.apiKey = opts.apiKey
    this.cacheFile = path.join(opts.cacheDir ?? Global.Path.cache, CACHE_FILENAME)
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.fetchImpl = opts.fetch ?? globalThis.fetch
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    this.costFallback = opts.costFallback ?? DEFAULT_COST_FALLBACK
  }

  /**
   * Returns the concurrency cost for a model. Loads the cache on first call,
   * triggers a background refresh if the on-disk cache is stale, and falls
   * back to `costFallback` (default 1) when a model is not found.
   */
  async getCost(modelId: string): Promise<number> {
    await this.ensureLoaded()
    const hit = this.memory?.get(modelId)
    if (hit !== undefined) return hit

    // Miss: do a single foreground refresh in case the model is brand new.
    // After the refresh, fall back to costFallback if it's still missing.
    await this.refresh(true)
    const second = this.memory?.get(modelId)
    if (second !== undefined) return second
    log.warn("model not found in /v1/models, defaulting", { modelId, fallback: this.costFallback })
    return this.costFallback
  }

  /**
   * Force a refresh from the API and overwrite the in-memory + on-disk cache.
   * Pass `force: false` to skip when the on-disk file is fresh.
   */
  async refresh(force = true): Promise<void> {
    if (!force && this.memory !== undefined && Date.now() - this.fetchedAt < this.ttlMs) return
    if (this.inFlight) return this.inFlight
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  /** Drop the in-memory map and the on-disk file. Forces next call to refetch. */
  async invalidate(): Promise<void> {
    this.memory = undefined
    this.fetchedAt = 0
    await fs.rm(this.cacheFile, { force: true }).catch((err) => {
      log.warn("invalidate: failed to remove cache file", { error: String(err) })
    })
  }

  /** Number of entries currently in memory. Useful for tests/debugging. */
  size(): number {
    return this.memory?.size ?? 0
  }

  private async ensureLoaded(): Promise<void> {
    if (this.memory) {
      // Memory present — kick off a non-blocking background refresh if stale.
      if (Date.now() - this.fetchedAt >= this.ttlMs) {
        this.refresh(true).catch((err) => log.warn("background refresh failed", { error: String(err) }))
      }
      return
    }
    const fromDisk = await this.loadFromDisk()
    if (fromDisk && Object.keys(fromDisk.costs).length > 0) {
      this.memory = new Map(Object.entries(fromDisk.costs))
      this.fetchedAt = fromDisk.fetchedAt
      // Stale on first load → background refresh, don't block the caller.
      if (Date.now() - this.fetchedAt >= this.ttlMs) {
        this.refresh(true).catch((err) => log.warn("background refresh failed", { error: String(err) }))
      }
      return
    }
    // No usable disk cache → blocking refresh.
    await this.refresh(true)
  }

  private async loadFromDisk(): Promise<CacheFile | undefined> {
    try {
      const text = await fs.readFile(this.cacheFile, "utf-8")
      const parsed = JSON.parse(text) as CacheFile
      if (typeof parsed?.fetchedAt !== "number" || !parsed.costs || typeof parsed.costs !== "object") {
        log.warn("cache file shape invalid, ignoring", { path: this.cacheFile })
        return undefined
      }
      return parsed
    } catch (err: any) {
      if (err?.code === "ENOENT") return undefined
      log.warn("cache file read failed, ignoring", { error: String(err) })
      return undefined
    }
  }

  private async doRefresh(): Promise<void> {
    let json: ModelsApiResponse
    try {
      json = await this.fetchModels()
    } catch (err) {
      log.warn("refresh failed, keeping existing cache", { error: String(err) })
      return
    }

    const costs: Record<string, number> = {}
    let missing = 0
    for (const m of json.data ?? []) {
      if (typeof m.id !== "string") continue
      if (typeof m.concurrency_cost === "number") {
        // Duplicates collapse to last-write-wins (matches probe finding of 3
        // duplicate ids in the live response — overwrite is intentional).
        costs[m.id] = m.concurrency_cost
      } else {
        missing++
      }
    }
    if (missing > 0) log.info("models without concurrency_cost", { count: missing })

    this.memory = new Map(Object.entries(costs))
    this.fetchedAt = Date.now()

    const payload: CacheFile = { fetchedAt: this.fetchedAt, costs }
    await fs
      .mkdir(path.dirname(this.cacheFile), { recursive: true })
      .then(() => fs.writeFile(this.cacheFile, JSON.stringify(payload)))
      .catch((err) => log.warn("cache file write failed", { error: String(err) }))
  }

  private async fetchModels(): Promise<ModelsApiResponse> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new Error("featherless /v1/models timeout")), this.fetchTimeoutMs)
    try {
      const res = await this.fetchImpl(`${this.baseURL}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: ctl.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`featherless /v1/models ${res.status}: ${text.slice(0, 200)}`)
      }
      return (await res.json()) as ModelsApiResponse
    } finally {
      clearTimeout(timer)
    }
  }
}
