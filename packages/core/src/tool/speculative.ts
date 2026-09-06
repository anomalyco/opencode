export * as SpeculativeExecution from "./speculative"

import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { FSUtil } from "../fs-util"

export interface CachedSpeculativeResult {
  readonly key: string
  readonly tool: "read" | "grep" | "glob"
  readonly data: unknown
  readonly timestamp: number
  readonly mtimeMs?: number
}

const CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 100
const speculativeCache = new Map<string, CachedSpeculativeResult>()

export const cacheKey = (tool: string, params: Record<string, unknown>): string => {
  return `${tool}::${JSON.stringify(params)}`
}

export const getCached = <T = unknown>(key: string): T | undefined => {
  const entry = speculativeCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    speculativeCache.delete(key)
    return undefined
  }
  return entry.data as T
}

export const setCached = (
  tool: "read" | "grep" | "glob",
  params: Record<string, unknown>,
  data: unknown,
  mtimeMs?: number,
): void => {
  if (speculativeCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = speculativeCache.keys().next().value
    if (oldestKey) speculativeCache.delete(oldestKey)
  }
  const key = cacheKey(tool, params)
  speculativeCache.set(key, {
    key,
    tool,
    data,
    timestamp: Date.now(),
    mtimeMs,
  })
}

export const clearCache = (): void => {
  speculativeCache.clear()
}

const FILE_PATH_REGEX = /(?:(?:read|inspect|cat|open|view|examine|check)\s+['"`]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)['"`]?)|(?:['"`]([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)['"`])/gi

export const extractSpeculativeReadPaths = (streamChunk: string, baseDir?: string): string[] => {
  const results: string[] = []
  const matches = streamChunk.matchAll(FILE_PATH_REGEX)
  for (const match of matches) {
    const candidate = match[1] || match[2]
    if (!candidate) continue
    // Filter out common false positives
    if (candidate.endsWith(".com") || candidate.endsWith(".org") || candidate.endsWith(".net")) continue
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) continue
    const resolved = baseDir ? path.resolve(baseDir, candidate) : candidate
    results.push(resolved)
  }
  return Array.from(new Set(results))
}

export const prefetchFile = Effect.fn("SpeculativeExecution.prefetchFile")(function* (
  filePath: string,
  options?: { offset?: number; limit?: number },
) {
  try {
    const file = Bun.file(filePath)
    const exists = yield* Effect.promise(() => file.exists())
    if (!exists) return undefined

    const stat = fs.statSync(filePath)
    const text = yield* Effect.promise(() => file.text())
    let resultText = text
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const lines = text.split("\n")
      const start = Math.max(0, (options.offset ?? 1) - 1)
      const end = options.limit !== undefined ? start + options.limit : lines.length
      resultText = lines.slice(start, end).join("\n")
    }

    const payload = {
      uri: pathToFileURL(filePath).href,
      name: path.basename(filePath),
      content: resultText,
      encoding: "utf8" as const,
      mime: FSUtil.mimeType(filePath),
      type: "text",
      path: filePath,
    }
    const params: Record<string, unknown> = { path: filePath }
    if (options?.offset !== undefined) params.offset = options.offset
    if (options?.limit !== undefined) params.limit = options.limit
    setCached("read", params, payload, stat.mtimeMs)
    return payload
  } catch {
    return undefined
  }
})

export const prefetchPaths = Effect.fn("SpeculativeExecution.prefetchPaths")(function* (
  paths: readonly string[],
) {
  for (const p of paths) {
    yield* prefetchFile(p).pipe(Effect.ignore)
  }
})
