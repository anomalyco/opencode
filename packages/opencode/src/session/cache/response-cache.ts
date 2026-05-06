import type { CacheHit, CacheInput, CacheEntry, CacheEntryValue, CacheStats } from "./schema"
import { Context, Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { createPrefixTrie } from "./prefix-trie"
import { createSemanticIndex } from "./sketch"

export interface Interface {
  readonly check: (input: CacheInput) => Effect.Effect<CacheHit | undefined>
  readonly store: (input: CacheInput, value: CacheEntryValue) => Effect.Effect<void>
  readonly invalidate: (sessionID?: string) => Effect.Effect<void>
  readonly stats: () => Effect.Effect<CacheStats>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ResponseCache") {}

function* seg(text: string) {
  const lines = text.split("\n")
  yield String(lines.length)
  for (let i = 0; i < lines.length; i++) {
    yield `${i}:${lines[i].length}`
    yield `${i}:h${Math.abs(djb2(lines[i]))}`
  }
}

function keyFor(input: CacheInput): string {
  const c = input.messages.join("\n").replace(/\s+/g, " ").trim()
  const parts = [input.model, input.sessionID, String(input.temperature), String(input.toolCount), c]
  return Math.abs(djb2(parts.join("|"))).toString(36)
}

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configSvc = yield* Config.Service
    const cfg = (yield* configSvc.get()).experimental?.responseCache
    if (!cfg?.enabled) {
      const empty: CacheStats = { hits: 0, misses: 0, expires: 0, evictions: 0, tierExactHits: 0, tierPrefixHits: 0, tierSemanticHits: 0 }
      return Service.of({
        check: () => Effect.succeed(undefined),
        store: () => Effect.void,
        invalidate: () => Effect.void,
        stats: () => Effect.succeed(empty),
      })
    }

    const trie = createPrefixTrie({ breakevenPrefixLen: cfg.trieBreakevenPrefixLen, maxEntries: cfg.trieMaxEntries })
    const semIdx = createSemanticIndex({ dims: cfg.semanticDims, minSimilarity: cfg.semanticMinSimilarity, maxEntries: cfg.semanticMaxEntries })
    const entries = new Map<string, CacheEntry>()
    const stats: CacheStats = { hits: 0, misses: 0, expires: 0, evictions: 0, tierExactHits: 0, tierPrefixHits: 0, tierSemanticHits: 0 }
    const maxSz = cfg.maxSize ?? 100
    const ttlSec = cfg.ttlSeconds ?? 300
    const utilMin = cfg.utilMinMs ?? 8
    const minConf = cfg.minConfidence ?? 0.5
    const maxDiv = cfg.maxDivergence ?? 0.1

    const mk = (strategy: "exact" | "prefix" | "semantic", entry: CacheEntry, confidence: number): CacheHit => {
      const utility = Math.max(0, entry.value.tokenUsage.total * 0.5 - 2)
      return { strategy, entry, confidence, utility, divergence: 1 - confidence }
    }

    const check = Effect.fn("Cache.check")(function* (input: CacheInput) {
      const k = keyFor(input)
      const exact = entries.get(k)
      if (exact && Date.now() - exact.createdAt <= ttlSec * 1000) {
        exact.lastAccessed = Date.now()
        exact.accessCount++
        stats.hits++; stats.tierExactHits++
        return mk("exact", exact, 1)
      }

      const content = input.messages.join("\n")
      const m = trie.match(Array.from(seg(content)))
      if (m) {
        const pe = entries.get(m.key)
        if (pe && pe.model === input.model && Date.now() - pe.createdAt <= ttlSec * 1000) {
          const r = m.prefixLength / m.totalLength
          if (r >= 0.8 && Math.max(0, pe.value.tokenUsage.total * 0.5 - 2) >= utilMin) {
            pe.lastAccessed = Date.now(); pe.accessCount++
            stats.hits++; stats.tierPrefixHits++
            return mk("prefix", pe, r)
          }
        }
      }

      const sh = semIdx.query(content, maxDiv)
      if (sh) {
        const se = entries.get(sh.key)
        if (se && se.model === input.model && Date.now() - se.createdAt <= ttlSec * 1000) {
          const conf = 1 - sh.divergence
          if (conf >= minConf && Math.max(0, se.value.tokenUsage.total * 0.5 - 2) >= utilMin) {
            se.lastAccessed = Date.now(); se.accessCount++
            stats.hits++; stats.tierSemanticHits++
            return mk("semantic", se, conf)
          }
        }
      }

      for (const [s, e] of entries) {
        if (Date.now() - e.createdAt > ttlSec * 1000) { entries.delete(s); stats.expires++ }
      }
      stats.misses++
      return undefined
    })

    const store = Effect.fn("Cache.store")(function* (input: CacheInput, value: CacheEntryValue) {
      const k = keyFor(input)
      if (entries.size >= maxSz) {
        let oldest = "", oldestTime = Infinity
        for (const [sk, e] of entries) {
          if (e.lastAccessed < oldestTime) { oldestTime = e.lastAccessed; oldest = sk }
        }
        if (oldest) { entries.delete(oldest); stats.evictions++ }
      }
      const content = input.messages.join("\n")
      entries.set(k, {
        key: k, value,
        createdAt: Date.now(), lastAccessed: Date.now(), accessCount: 1,
        size: content.length + JSON.stringify(value).length,
        sessionID: input.sessionID, model: input.model,
      })
      trie.insert(Array.from(seg(content)), k)
      semIdx.put(content, k)
    })

    const invalidate = Effect.fn("Cache.invalidate")(function* (sessionID?: string) {
      if (sessionID) {
        for (const [s, e] of entries) {
          if (e.sessionID === sessionID) entries.delete(s)
        }
      } else {
        entries.clear(); trie.clear(); semIdx.clear()
      }
    })

    const statsFn = Effect.fn("Cache.stats")(function* () { return { ...stats } })
    return Service.of({ check, store, invalidate, stats: statsFn })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))
