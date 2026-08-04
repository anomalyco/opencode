import path from "path"
import fsNode from "fs/promises"
import { createHash, randomUUID } from "crypto"
import { fileURLToPath, pathToFileURL } from "url"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Global } from "@opencode-ai/core/global"
import type {
  MarketplaceFetch,
  MarketplaceInstallPlan,
  MarketplacePluginSpec,
  MarketplaceSource,
  MarketplaceSkill,
} from "@opencode-ai/core/marketplace"

export type CacheMode = "cache-first" | "refresh" | "strict"
const MAX_ICON_BYTES = 5 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024
const MAX_PACKAGE_FILES = 512
const MAX_SKILLS = 128
const MAX_PATH_BYTES = 512
const MAX_REDIRECTS = 5

export type Artifact = {
  digest: string
  path: string
  size: number
  mediaType?: string
  kind: string
  sourceUrl?: string
}

export type MaterializedPlan = {
  plan: MarketplaceInstallPlan
  artifactDigests: string[]
  treeDigest?: string
}

export type CacheSummary = {
  root: string
  objects: number
  total_bytes: number
  fetch_entries: number
  materializations: number
}

export class CacheError extends Schema.TaggedErrorClass<CacheError>()("MarketplaceCacheError", {
  operation: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly put: (
    bytes: Uint8Array,
    metadata?: { mediaType?: string; kind?: string; sourceUrl?: string },
  ) => Effect.Effect<Artifact, CacheError>
  readonly putJson: (
    value: unknown,
    metadata?: { kind?: string; sourceUrl?: string },
  ) => Effect.Effect<Artifact, CacheError>
  readonly fetchResponse: (input: {
    url: string
    headers?: HeadersInit
    signal?: AbortSignal
    kind?: string
    mode?: CacheMode
    source?: MarketplaceSource
  }) => Effect.Effect<Response, CacheError>
  readonly dataURL: (input: {
    url: string
    headers?: HeadersInit
    mode?: CacheMode
    source?: MarketplaceSource
  }) => Effect.Effect<string | undefined, CacheError>
  readonly fetcher: (mode?: CacheMode) => MarketplaceFetch
  readonly materializePlan: (
    plan: MarketplaceInstallPlan,
    source: MarketplaceSource,
  ) => Effect.Effect<MaterializedPlan, CacheError>
  readonly summary: () => Effect.Effect<CacheSummary>
  readonly prune: (input: {
    keep?: Iterable<string>
    maxAgeDays?: number
  }) => Effect.Effect<{ removed_objects: number; removed_materializations: number; summary: CacheSummary }, CacheError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplaceCache") {}

type FetchRow = {
  key: string
  url: string
  digest: string
  etag?: string | null
  last_modified?: string | null
  status: number
  time_fetched: number
}

type TreeEntry = {
  relative: string
  bytes: Uint8Array
  digest: string
}

type IndexedSkill = {
  name: string
  files: string[]
  version?: string
}

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function digestOf(bytes: Uint8Array) {
  return `sha256:${hashBytes(bytes)}`
}

function digestHex(digest: string) {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest)
  if (!match) throw new Error(`Unsupported marketplace digest: ${digest}`)
  return match[1]!.toLowerCase()
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function cacheError(operation: string, error: unknown) {
  return error instanceof CacheError
    ? error
    : new CacheError({ operation, message: error instanceof Error ? error.message : String(error) })
}

function safeSegment(value: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned || "item"
}

function safeRelative(value: string) {
  if (new TextEncoder().encode(value).byteLength > MAX_PATH_BYTES)
    throw new Error(`Artifact path is too long: ${value}`)
  const clean = value.replaceAll("\\", "/").replace(/^\.\/+/, "")
  if (!clean || clean.startsWith("/") || /^[A-Za-z]:\//.test(clean)) throw new Error(`Unsafe artifact path: ${value}`)
  const parts = clean.split("/")
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe artifact path: ${value}`)
  return parts.join("/")
}

function headersObject(input?: HeadersInit) {
  const headers = new Headers(input)
  return Object.fromEntries(
    Array.from(headers.entries())
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function requestKey(url: string, headers?: HeadersInit) {
  return hashBytes(new TextEncoder().encode(stable({ url, headers: headersObject(headers) })))
}

function sameOriginHeaders(source: MarketplaceSource, target: string) {
  if (!source.headers) return undefined
  try {
    const left = new URL(source.url)
    const right = new URL(target)
    if (!["http:", "https:"].includes(left.protocol) || !["http:", "https:"].includes(right.protocol)) {
      return undefined
    }
    return left.origin === right.origin ? source.headers : undefined
  } catch {
    return undefined
  }
}

function localMediaType(target: string) {
  switch (path.extname(target).toLowerCase()) {
    case ".json":
      return "application/json"
    case ".md":
      return "text/markdown; charset=utf-8"
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".ts":
      return "text/javascript; charset=utf-8"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    default:
      return undefined
  }
}

function isArtifactURL(value: string) {
  return /^(?:https?|file):/i.test(value)
}

function readIndex(value: unknown): IndexedSkill[] {
  if (!value || typeof value !== "object" || !("skills" in value) || !Array.isArray(value.skills)) {
    throw new Error("Skill source index must contain a skills array")
  }
  if (value.skills.length > MAX_SKILLS) throw new Error(`Skill source exceeds ${MAX_SKILLS} skills`)
  return value.skills.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Invalid skill index entry ${index}`)
    const record = entry as Record<string, unknown>
    if (typeof record.name !== "string" || !Array.isArray(record.files)) {
      throw new Error(`Invalid skill index entry ${index}`)
    }
    const files = record.files.map((file) => {
      if (typeof file !== "string") throw new Error(`Invalid skill index file in entry ${index}`)
      return safeRelative(file)
    })
    if (!files.includes("SKILL.md")) throw new Error(`Skill ${record.name} does not contain SKILL.md`)
    return {
      name: record.name,
      files,
      ...(typeof record.version === "string" ? { version: record.version } : {}),
    }
  })
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function maxBytes(kind?: string) {
  return kind === "icon" ? MAX_ICON_BYTES : MAX_ARTIFACT_BYTES
}

function canUseStale(mode: CacheMode | undefined, status?: number) {
  if (mode === "strict") return false
  if (status === undefined) return true
  return status === 408 || status === 429 || status >= 500
}

async function readResponseBytes(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) throw new Error(`Artifact exceeds ${limit} bytes`)
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`Artifact exceeds ${limit} bytes`)
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchWithRedirects(url: string, headers: Headers, signal?: AbortSignal) {
  let current = new URL(url)
  let requestHeaders = new Headers(headers)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await globalThis.fetch(current, { headers: requestHeaders, signal, redirect: "manual" })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    if (!location) return response
    if (redirects === MAX_REDIRECTS) throw new Error(`Too many redirects for ${url}`)
    const next = new URL(location, current)
    if (current.protocol === "https:" && next.protocol !== "https:") {
      throw new Error(`Refusing HTTPS downgrade redirect from ${current.href} to ${next.href}`)
    }
    if (next.origin !== current.origin) {
      requestHeaders = new Headers(requestHeaders)
      for (const name of ["authorization", "cookie", "proxy-authorization"]) requestHeaders.delete(name)
    }
    current = next
  }
  throw new Error(`Too many redirects for ${url}`)
}

type GitLabRawReference = {
  origin: string
  repository: string
  project: string
  revision: string
  file: string
}

function gitLabRawReference(url: URL) {
  const marker = "/-/raw/"
  const index = url.pathname.indexOf(marker)
  if (index <= 0) return
  const tail = url.pathname.slice(index + marker.length)
  const separator = tail.indexOf("/")
  if (separator <= 0 || separator === tail.length - 1) return
  try {
    return {
      origin: url.origin,
      repository: url.pathname.slice(0, index),
      project: decodeURIComponent(url.pathname.slice(1, index)),
      revision: decodeURIComponent(tail.slice(0, separator)),
      file: decodeURIComponent(tail.slice(separator + 1)),
    } satisfies GitLabRawReference
  } catch {
    return
  }
}

function gitLabRawFileURL(reference: GitLabRawReference, file: string) {
  return `${reference.origin}${reference.repository}/-/raw/${encodeURIComponent(reference.revision)}/${file
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`
}

function gitLabAPIFileURL(reference: GitLabRawReference) {
  return `${reference.origin}/api/v4/projects/${encodeURIComponent(reference.project)}/repository/files/${encodeURIComponent(reference.file)}/raw?ref=${encodeURIComponent(reference.revision)}`
}

function gitLabAPITreeURL(reference: GitLabRawReference) {
  return `${reference.origin}/api/v4/projects/${encodeURIComponent(reference.project)}/repository/tree?path=${encodeURIComponent(reference.file.replace(/\/$/, ""))}&ref=${encodeURIComponent(reference.revision)}&recursive=true&per_page=100`
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const flock = yield* EffectFlock.Service
    const root = path.join(Global.Path.cache, "marketplace")
    const objects = path.join(root, "objects", "sha256")
    const materialized = path.join(root, "materialized", "sha256")

    const objectPath = (digest: string) => {
      const hex = digestHex(digest)
      return path.join(objects, hex.slice(0, 2), hex)
    }

    const exists = (target: string) =>
      Effect.tryPromise({
        try: () =>
          fsNode
            .stat(target)
            .then(() => true)
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return false
              throw error
            }),
        catch: (error) => cacheError("stat", error),
      })

    const readBytes = (target: string) =>
      Effect.tryPromise({
        try: () => fsNode.readFile(target).then((value) => new Uint8Array(value)),
        catch: (error) => cacheError("read", error),
      })

    const validateLocalArtifact = Effect.fnUntraced(function* (source: MarketplaceSource | undefined, target: URL) {
      if (target.protocol !== "file:" || !source) return
      const sourceURL = new URL(source.url)
      if (sourceURL.protocol !== "file:") {
        return yield* new CacheError({
          operation: "validate local artifact",
          message: `Network Marketplace source ${source.name} cannot reference local file ${target.href}`,
        })
      }

      const sourcePath = fileURLToPath(sourceURL)
      const rootPath = sourceURL.pathname.endsWith("/") ? sourcePath : path.dirname(sourcePath)
      const targetPath = fileURLToPath(target)
      const lexical = path.relative(rootPath, targetPath)
      if (lexical === ".." || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) {
        return yield* new CacheError({
          operation: "validate local artifact",
          message: `Local Marketplace artifact escapes its source directory: ${target.href}`,
        })
      }
      const parts = lexical.split(path.sep)
      for (const index of parts.keys()) {
        const candidatePath = path.join(rootPath, ...parts.slice(0, index + 1))
        const stat = yield* Effect.tryPromise({
          try: () => fsNode.lstat(candidatePath),
          catch: (error) => cacheError("validate local artifact", error),
        })
        if (stat.isSymbolicLink()) {
          return yield* new CacheError({
            operation: "validate local artifact",
            message: `Local Marketplace artifacts cannot traverse symbolic links: ${target.href}`,
          })
        }
      }
      const [root, candidate] = yield* Effect.tryPromise({
        try: () => Promise.all([fsNode.realpath(rootPath), fsNode.realpath(targetPath)]),
        catch: (error) => cacheError("validate local artifact", error),
      })
      const relative = path.relative(root, candidate)
      if (relative === "") return
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return yield* new CacheError({
          operation: "validate local artifact",
          message: `Local Marketplace artifact escapes its source directory: ${target.href}`,
        })
      }
    })

    const putLocks = new Map<string, { semaphore: Semaphore.Semaphore; references: number }>()

    const put = Effect.fn("MarketplaceCache.put")(function* (
      bytes: Uint8Array,
      metadata: { mediaType?: string; kind?: string; sourceUrl?: string } = {},
    ) {
      const digest = digestOf(bytes)
      const target = objectPath(digest)
      const lock = putLocks.get(digest) ?? { semaphore: Semaphore.makeUnsafe(1), references: 0 }
      putLocks.set(digest, lock)
      lock.references++
      return yield* lock.semaphore
        .withPermits(1)(
          Effect.gen(function* () {
            yield* flock
              .withLock(
                Effect.gen(function* () {
                  if (!(yield* exists(target))) {
                    const staging = `${target}.tmp-${randomUUID()}`
                    yield* Effect.tryPromise({
                      try: async () => {
                        await fsNode.mkdir(path.dirname(target), { recursive: true })
                        await fsNode.writeFile(staging, bytes, { mode: 0o600 })
                        await fsNode.rename(staging, target).catch(async (error: NodeJS.ErrnoException) => {
                          if (error.code !== "EEXIST") throw error
                        })
                        await fsNode.rm(staging, { force: true })
                      },
                      catch: (error) => cacheError("put", error),
                    })
                  }

                  const now = Date.now()
                  yield* db
                    .run(
                      sql`
                      INSERT INTO marketplace_artifact
                        (digest, size, media_type, kind, source_url, time_created, time_accessed)
                      VALUES
                        (${digest}, ${bytes.byteLength}, ${metadata.mediaType ?? null}, ${metadata.kind ?? "blob"},
                         ${metadata.sourceUrl ?? null}, ${now}, ${now})
                      ON CONFLICT(digest) DO UPDATE SET
                        time_accessed = excluded.time_accessed,
                        media_type = COALESCE(marketplace_artifact.media_type, excluded.media_type),
                        source_url = COALESCE(marketplace_artifact.source_url, excluded.source_url)
                    `,
                    )
                    .pipe(Effect.orDie)
                }),
                `marketplace-artifact:${digest}`,
              )
              .pipe(Effect.mapError((error) => cacheError("lock", error)))

            return {
              digest,
              path: target,
              size: bytes.byteLength,
              ...(metadata.mediaType ? { mediaType: metadata.mediaType } : {}),
              kind: metadata.kind ?? "blob",
              ...(metadata.sourceUrl ? { sourceUrl: metadata.sourceUrl } : {}),
            } satisfies Artifact
          }),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              lock.references--
              if (lock.references === 0) putLocks.delete(digest)
            }),
          ),
        )
    })

    const putJson = Effect.fn("MarketplaceCache.putJson")(function* (
      value: unknown,
      metadata: { kind?: string; sourceUrl?: string } = {},
    ) {
      return yield* put(new TextEncoder().encode(stable(value)), {
        mediaType: "application/json",
        kind: metadata.kind ?? "json",
        sourceUrl: metadata.sourceUrl,
      })
    })

    const cached = Effect.fnUntraced(function* (row: FetchRow | undefined) {
      if (!row) return undefined
      const target = objectPath(row.digest)
      if (!(yield* exists(target))) return undefined
      const bytes = yield* readBytes(target)
      if (digestOf(bytes) !== row.digest) {
        yield* Effect.tryPromise({
          try: () => fsNode.rm(target, { force: true }),
          catch: (error) => cacheError("remove corrupt artifact", error),
        })
        return undefined
      }
      const artifact = (yield* db
        .all<{
          media_type?: string | null
        }>(sql`SELECT media_type FROM marketplace_artifact WHERE digest = ${row.digest} LIMIT 1`)
        .pipe(Effect.orDie))[0]
      yield* db
        .run(sql`UPDATE marketplace_artifact SET time_accessed = ${Date.now()} WHERE digest = ${row.digest}`)
        .pipe(Effect.orDie)
      return { bytes, mediaType: artifact?.media_type ?? undefined }
    })

    const fetchResponse = Effect.fn("MarketplaceCache.fetchResponse")(function* (input: {
      url: string
      headers?: HeadersInit
      signal?: AbortSignal
      kind?: string
      mode?: CacheMode
      source?: MarketplaceSource
    }) {
      const parsed = new URL(input.url)
      yield* validateLocalArtifact(input.source, parsed)
      const url = parsed.href
      const gitlab = gitLabRawReference(parsed)
      const requestURL = gitlab ? gitLabAPIFileURL(gitlab) : url
      const key = requestKey(url, input.headers)
      const row = (yield* db
        .all<FetchRow>(sql`SELECT * FROM marketplace_fetch WHERE key = ${key} LIMIT 1`)
        .pipe(Effect.orDie))[0]
      const hit = yield* cached(row)

      if (hit && (input.mode === undefined || input.mode === "cache-first")) {
        return new Response(hit.bytes, {
          status: 200,
          headers: {
            ...(hit.mediaType ? { "content-type": hit.mediaType } : {}),
            "content-length": String(hit.bytes.byteLength),
            "x-opencode-artifact-digest": row!.digest,
            "x-opencode-cache": "hit",
          },
        })
      }

      if (parsed.protocol === "file:") {
        const local = yield* Effect.tryPromise({
          try: async () => {
            const target = fileURLToPath(parsed)
            const [buffer, stat] = await Promise.all([fsNode.readFile(target), fsNode.stat(target)])
            return {
              bytes: new Uint8Array(buffer),
              mediaType: localMediaType(target),
              lastModified: stat.mtime.toUTCString(),
            }
          },
          catch: (error) => cacheError("read local source", error),
        }).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
        )

        if (!local.ok) {
          if (hit && row && canUseStale(input.mode)) {
            return new Response(hit.bytes, {
              status: 200,
              headers: {
                ...(hit.mediaType ? { "content-type": hit.mediaType } : {}),
                "content-length": String(hit.bytes.byteLength),
                "x-opencode-artifact-digest": row.digest,
                "x-opencode-cache": "stale",
              },
            })
          }
          return yield* local.error
        }
        if (local.value.bytes.byteLength > maxBytes(input.kind)) {
          return yield* new CacheError({
            operation: "read local source",
            message: `Artifact exceeds ${maxBytes(input.kind)} bytes`,
          })
        }

        const artifact = yield* put(local.value.bytes, {
          mediaType: local.value.mediaType,
          kind: input.kind ?? "local",
          sourceUrl: url,
        })
        const now = Date.now()
        yield* db
          .run(
            sql`
            INSERT INTO marketplace_fetch (key, url, digest, etag, last_modified, status, time_fetched)
            VALUES (${key}, ${url}, ${artifact.digest}, ${null}, ${local.value.lastModified}, ${200}, ${now})
            ON CONFLICT(key) DO UPDATE SET
              url = excluded.url,
              digest = excluded.digest,
              etag = excluded.etag,
              last_modified = excluded.last_modified,
              status = excluded.status,
              time_fetched = excluded.time_fetched
          `,
          )
          .pipe(Effect.orDie)

        return new Response(local.value.bytes, {
          status: 200,
          headers: {
            ...(local.value.mediaType ? { "content-type": local.value.mediaType } : {}),
            "content-length": String(local.value.bytes.byteLength),
            "last-modified": local.value.lastModified,
            "x-opencode-artifact-digest": artifact.digest,
            "x-opencode-cache": "miss",
          },
        })
      }

      const headers = new Headers(input.headers)
      if (row?.etag) headers.set("if-none-match", row.etag)
      if (row?.last_modified) headers.set("if-modified-since", row.last_modified)

      const attempt = yield* Effect.tryPromise({
        try: () => fetchWithRedirects(requestURL, headers, input.signal),
        catch: (error) => cacheError("fetch", error),
      }).pipe(
        Effect.map((response) => ({ ok: true as const, response })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )

      if (!attempt.ok) {
        if (hit && canUseStale(input.mode)) {
          return new Response(hit.bytes, {
            status: 200,
            headers: {
              ...(hit.mediaType ? { "content-type": hit.mediaType } : {}),
              "content-length": String(hit.bytes.byteLength),
              "x-opencode-artifact-digest": row!.digest,
              "x-opencode-cache": "stale",
            },
          })
        }
        return yield* attempt.error
      }

      const response = attempt.response
      if (response.status === 304 && hit && row) {
        yield* db
          .run(sql`UPDATE marketplace_fetch SET time_fetched = ${Date.now()} WHERE key = ${key}`)
          .pipe(Effect.orDie)
        return new Response(hit.bytes, {
          status: 200,
          headers: {
            ...(hit.mediaType ? { "content-type": hit.mediaType } : {}),
            "content-length": String(hit.bytes.byteLength),
            "x-opencode-artifact-digest": row.digest,
            "x-opencode-cache": "revalidated",
          },
        })
      }

      if (!response.ok) {
        if (hit && row && canUseStale(input.mode, response.status)) {
          return new Response(hit.bytes, {
            status: 200,
            headers: {
              ...(hit.mediaType ? { "content-type": hit.mediaType } : {}),
              "content-length": String(hit.bytes.byteLength),
              "x-opencode-artifact-digest": row.digest,
              "x-opencode-cache": "stale",
            },
          })
        }
        return yield* new CacheError({
          operation: "fetch",
          message: `HTTP ${response.status} ${response.statusText} for ${url}`,
        })
      }

      const bytes = yield* Effect.tryPromise({
        try: () => readResponseBytes(response, maxBytes(input.kind)),
        catch: (error) => cacheError("read response", error),
      })
      const mediaType = response.headers.get("content-type") ?? undefined
      const artifact = yield* put(bytes, { mediaType, kind: input.kind ?? "remote", sourceUrl: url })
      const now = Date.now()
      yield* db
        .run(
          sql`
          INSERT INTO marketplace_fetch (key, url, digest, etag, last_modified, status, time_fetched)
          VALUES (${key}, ${url}, ${artifact.digest}, ${response.headers.get("etag")},
                  ${response.headers.get("last-modified")}, ${response.status}, ${now})
          ON CONFLICT(key) DO UPDATE SET
            url = excluded.url,
            digest = excluded.digest,
            etag = excluded.etag,
            last_modified = excluded.last_modified,
            status = excluded.status,
            time_fetched = excluded.time_fetched
        `,
        )
        .pipe(Effect.orDie)

      return new Response(bytes, {
        status: 200,
        headers: {
          ...(mediaType ? { "content-type": mediaType } : {}),
          "content-length": String(bytes.byteLength),
          "x-opencode-artifact-digest": artifact.digest,
          "x-opencode-cache": "miss",
        },
      })
    })

    const fetchArtifact = Effect.fnUntraced(function* (input: {
      url: string
      headers?: HeadersInit
      kind: string
      source: MarketplaceSource
    }) {
      const response = yield* fetchResponse({ ...input, mode: "strict" })
      const bytes = yield* Effect.tryPromise({
        try: () => response.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
        catch: (error) => cacheError("read cached response", error),
      })
      const digest = response.headers.get("x-opencode-artifact-digest")
      if (!digest) return yield* new CacheError({ operation: "fetch", message: `Missing digest for ${input.url}` })
      return { bytes, digest, mediaType: response.headers.get("content-type") ?? undefined }
    })

    const fetcher = (mode: CacheMode = "cache-first"): MarketplaceFetch => {
      return async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        return Effect.runPromise(
          fetchResponse({
            url: request.url,
            headers: request.headers,
            signal: request.signal,
            kind: "catalog",
            mode,
          }),
        )
      }
    }

    const dataURL = Effect.fn("MarketplaceCache.dataURL")(function* (input: {
      url: string
      headers?: HeadersInit
      mode?: CacheMode
      source?: MarketplaceSource
    }) {
      const response = yield* fetchResponse({ ...input, kind: "icon" })
      const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
      if (!mediaType || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType)) return
      const declared = Number(response.headers.get("content-length"))
      if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) return
      const bytes = yield* Effect.promise(() => response.arrayBuffer())
      if (bytes.byteLength > MAX_ICON_BYTES) return
      return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`
    })

    const materializeRemoteSkillFiles = Effect.fnUntraced(function* (input: {
      files: Array<{ url: string; relative: string }>
      source: MarketplaceSource
      entries: Map<string, TreeEntry>
      digests: Set<string>
    }) {
      const files = Array.from(new Map(input.files.map((file) => [file.url, file])).values())
      const artifacts = yield* Effect.forEach(
        files,
        (file) =>
          fetchArtifact({
            url: file.url,
            headers: sameOriginHeaders(input.source, file.url),
            kind: "skill-file",
            source: input.source,
          }).pipe(Effect.map((artifact) => ({ url: file.url, artifact }))),
        { concurrency: 32 },
      )
      const byURL = new Map(artifacts.map((item) => [item.url, item.artifact]))
      for (const file of input.files) {
        const artifact = byURL.get(file.url)!
        input.digests.add(artifact.digest)
        input.entries.set(file.relative, { relative: file.relative, bytes: artifact.bytes, digest: artifact.digest })
      }
    })

    const indexedSkill = Effect.fnUntraced(function* (input: {
      url: string
      source: MarketplaceSource
      prefix: string
      name?: string
      entries: Map<string, TreeEntry>
      digests: Set<string>
    }) {
      const base = input.url.endsWith("/") ? input.url : `${input.url}/`
      if (new URL(base).protocol === "file:") {
        const directory = fileURLToPath(base)
        const direct = path.join(directory, "SKILL.md")
        const candidates = (yield* Effect.tryPromise({
          try: async () => {
            if (
              await fsNode
                .stat(direct)
                .then((stat) => stat.isFile())
                .catch(() => false)
            )
              return [directory]
            const children = await fsNode.readdir(directory, { withFileTypes: true })
            const directories = children
              .filter((entry) => entry.isDirectory())
              .map((entry) => path.join(directory, entry.name))
            const skills = await Promise.all(
              directories.map(async (target) => ({
                target,
                exists: await fsNode
                  .stat(path.join(target, "SKILL.md"))
                  .then((stat) => stat.isFile() && stat.size > 0)
                  .catch(() => false),
              })),
            )
            return skills.filter((skill) => skill.exists).map((skill) => skill.target)
          },
          catch: (error) => cacheError("discover local skills", error),
        })).filter((target) => !input.name || path.basename(target) === input.name)
        if (candidates.length > MAX_SKILLS) {
          return yield* new CacheError({
            operation: "discover local skills",
            message: `Skill source exceeds ${MAX_SKILLS} skills`,
          })
        }
        if (!candidates.length) {
          return yield* new CacheError({ operation: "discover local skills", message: `No skills found in ${base}` })
        }
        const roots: Array<{ name: string; relative: string }> = []
        for (const skillDirectory of candidates) {
          const name = path.basename(skillDirectory)
          const skillRoot = path.posix.join(input.prefix, safeSegment(name))
          const files: string[] = []
          const visit = async (directory: string): Promise<void> => {
            for (const entry of await fsNode.readdir(directory, { withFileTypes: true })) {
              const target = path.join(directory, entry.name)
              const stat = await fsNode.lstat(target)
              if (stat.isSymbolicLink()) throw new Error(`Local skill contains a symbolic link: ${target}`)
              if (stat.isDirectory()) {
                await visit(target)
                continue
              }
              if (!stat.isFile()) throw new Error(`Unsupported local skill entry: ${target}`)
              files.push(target)
            }
          }
          yield* Effect.tryPromise({
            try: () => visit(skillDirectory),
            catch: (error) => cacheError("discover local skill", error),
          })
          for (const file of files) {
            const url = pathToFileURL(file).href
            const artifact = yield* fetchArtifact({
              url,
              headers: sameOriginHeaders(input.source, url),
              kind: "skill-file",
              source: input.source,
            })
            input.digests.add(artifact.digest)
            const relative = path.posix.join(skillRoot, safeRelative(path.relative(skillDirectory, file)))
            input.entries.set(relative, { relative, bytes: artifact.bytes, digest: artifact.digest })
          }
          roots.push({ name, relative: skillRoot })
        }
        return roots
      }
      if (new URL(base).hostname === "raw.githubusercontent.com") {
        const parsed = new URL(base)
        const [owner, repository, revision, ...parts] = parsed.pathname.split("/").filter(Boolean)
        if (!owner || !repository || !revision) {
          return yield* new CacheError({ operation: "discover GitHub skills", message: `Invalid GitHub URL: ${base}` })
        }
        const treeURL = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(revision)}?recursive=1`
        const treeArtifact = yield* fetchArtifact({
          url: treeURL,
          kind: "skill-index",
          source: input.source,
        })
        input.digests.add(treeArtifact.digest)
        const tree = yield* Effect.try({
          try: () => JSON.parse(new TextDecoder().decode(treeArtifact.bytes)) as unknown,
          catch: (error) => cacheError("parse GitHub skill tree", error),
        })
        if (!tree || typeof tree !== "object" || !("tree" in tree) || !Array.isArray(tree.tree)) {
          return yield* new CacheError({ operation: "parse GitHub skill tree", message: "Invalid GitHub tree" })
        }
        if ("truncated" in tree && tree.truncated === true) {
          return yield* new CacheError({ operation: "discover GitHub skills", message: "GitHub tree is truncated" })
        }
        const prefix = parts.map(decodeURIComponent).join("/").replace(/\/$/, "")
        const files = tree.tree.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || !("path" in entry) || typeof entry.path !== "string") return []
          if (!("type" in entry) || entry.type !== "blob") return []
          if (prefix && entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) return []
          return [entry.path]
        })
        const roots = Array.from(
          new Set(
            files
              .filter((file) => file.endsWith("/SKILL.md") || file === "SKILL.md")
              .map((file) => file.slice(0, -"SKILL.md".length).replace(/\/$/, "")),
          ),
        ).filter((root) => !input.name || root.split("/").at(-1) === input.name)
        if (!roots.length) {
          return yield* new CacheError({ operation: "discover GitHub skills", message: `No skills found in ${base}` })
        }
        if (roots.length > MAX_SKILLS) {
          return yield* new CacheError({
            operation: "discover GitHub skills",
            message: `Skill source exceeds ${MAX_SKILLS} skills`,
          })
        }
        const result = roots.map((root) => {
          const name = root.split("/").at(-1) || repository
          const relative = path.posix.join(input.prefix, safeSegment(name))
          return {
            name,
            relative,
            files: files
              .filter((candidate) => candidate === `${root}/SKILL.md` || candidate.startsWith(`${root}/`))
              .map((file) => ({
                url: new URL(file.slice(prefix.length).replace(/^\/+/, ""), base).href,
                relative: path.posix.join(relative, safeRelative(file.slice(root.length + 1))),
              })),
          }
        })
        yield* materializeRemoteSkillFiles({
          files: result.flatMap((item) => item.files),
          source: input.source,
          entries: input.entries,
          digests: input.digests,
        })
        return result.map((item) => ({ name: item.name, relative: item.relative }))
      }
      const gitlab = gitLabRawReference(new URL(base))
      if (gitlab) {
        const treeArtifact = yield* fetchArtifact({
          url: gitLabAPITreeURL(gitlab),
          headers: sameOriginHeaders(input.source, base),
          kind: "skill-index",
          source: input.source,
        })
        input.digests.add(treeArtifact.digest)
        const tree = yield* Effect.try({
          try: () => JSON.parse(new TextDecoder().decode(treeArtifact.bytes)) as unknown,
          catch: (error) => cacheError("parse GitLab skill tree", error),
        })
        if (!Array.isArray(tree)) {
          return yield* new CacheError({ operation: "parse GitLab skill tree", message: "Invalid GitLab tree" })
        }
        const prefix = gitlab.file.replace(/\/$/, "")
        const files = tree.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || !("path" in entry) || typeof entry.path !== "string") return []
          if (!("type" in entry) || entry.type !== "blob") return []
          if (prefix && entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) return []
          return [entry.path]
        })
        const roots = Array.from(
          new Set(
            files
              .filter((file) => file.endsWith("/SKILL.md") || file === "SKILL.md")
              .map((file) => file.slice(0, -"SKILL.md".length).replace(/\/$/, "")),
          ),
        ).filter((root) => !input.name || root.split("/").at(-1) === input.name)
        if (!roots.length) {
          return yield* new CacheError({ operation: "discover GitLab skills", message: `No skills found in ${base}` })
        }
        if (roots.length > MAX_SKILLS) {
          return yield* new CacheError({
            operation: "discover GitLab skills",
            message: `Skill source exceeds ${MAX_SKILLS} skills`,
          })
        }
        const result = roots.map((root) => {
          const name = root.split("/").at(-1) || gitlab.project.split("/").at(-1) || "skill"
          const relative = path.posix.join(input.prefix, safeSegment(name))
          return {
            name,
            relative,
            files: files
              .filter((candidate) => candidate === `${root}/SKILL.md` || candidate.startsWith(`${root}/`))
              .map((file) => ({
                url: gitLabRawFileURL(gitlab, file),
                relative: path.posix.join(relative, safeRelative(file.slice(root.length + 1))),
              })),
          }
        })
        yield* materializeRemoteSkillFiles({
          files: result.flatMap((item) => item.files),
          source: input.source,
          entries: input.entries,
          digests: input.digests,
        })
        return result.map((item) => ({ name: item.name, relative: item.relative }))
      }
      if (new URL(base).hostname === "unpkg.com") {
        const metadataURL = `${base}?meta`
        const metadataArtifact = yield* fetchArtifact({
          url: metadataURL,
          headers: sameOriginHeaders(input.source, metadataURL),
          kind: "skill-index",
          source: input.source,
        })
        input.digests.add(metadataArtifact.digest)
        const metadata = yield* Effect.try({
          try: () => JSON.parse(new TextDecoder().decode(metadataArtifact.bytes)) as unknown,
          catch: (error) => cacheError("parse npm skill metadata", error),
        })
        if (!metadata || typeof metadata !== "object" || !("files" in metadata) || !Array.isArray(metadata.files)) {
          return yield* new CacheError({ operation: "parse npm skill metadata", message: "Invalid unpkg metadata" })
        }
        const files = metadata.files.flatMap((value) => {
          if (!value || typeof value !== "object" || !("path" in value) || typeof value.path !== "string") return []
          return [value.path]
        })
        const roots = Array.from(
          new Set(files.filter((file) => file.endsWith("/SKILL.md")).map((file) => file.slice(0, -"/SKILL.md".length))),
        ).filter((root) => !input.name || root.split("/").at(-1) === input.name)
        if (!roots.length) {
          return yield* new CacheError({ operation: "discover npm skills", message: `No skills found in ${base}` })
        }
        if (roots.length > MAX_SKILLS) {
          return yield* new CacheError({
            operation: "discover npm skills",
            message: `Skill source exceeds ${MAX_SKILLS} skills`,
          })
        }
        const metadataPrefix = "prefix" in metadata && typeof metadata.prefix === "string" ? metadata.prefix : "/"
        const result = roots.map((root) => {
          const name = root.split("/").at(-1)!
          const relative = path.posix.join(input.prefix, safeSegment(name))
          return {
            name,
            relative,
            files: files
              .filter((candidate) => candidate === `${root}/SKILL.md` || candidate.startsWith(`${root}/`))
              .map((file) => ({
                url: new URL(
                  file.startsWith(metadataPrefix) ? file.slice(metadataPrefix.length) : file.replace(/^\/+/, ""),
                  base,
                ).href,
                relative: path.posix.join(relative, safeRelative(file.slice(root.length + 1))),
              })),
          }
        })
        yield* materializeRemoteSkillFiles({
          files: result.flatMap((item) => item.files),
          source: input.source,
          entries: input.entries,
          digests: input.digests,
        })
        return result.map((item) => ({ name: item.name, relative: item.relative }))
      }
      const indexURL = new URL("index.json", base).href
      const headers = sameOriginHeaders(input.source, indexURL)
      const indexArtifact = yield* fetchArtifact({ url: indexURL, headers, kind: "skill-index", source: input.source })
      input.digests.add(indexArtifact.digest)
      const index = yield* Effect.try({
        try: () => readIndex(JSON.parse(new TextDecoder().decode(indexArtifact.bytes))),
        catch: (error) => cacheError("parse skill index", error),
      })
      const selected = input.name ? index.filter((skill) => skill.name === input.name) : index
      if (selected.length === 0) {
        return yield* new CacheError({
          operation: "materialize skill",
          message: `Skill ${input.name} is not present in ${indexURL}`,
        })
      }

      const roots = selected.map((skill) => {
        const relative = path.posix.join(input.prefix, safeSegment(skill.name))
        return {
          name: skill.name,
          relative,
          files: skill.files.map((file) => ({
            url: new URL(file, `${base}${encodeURIComponent(skill.name)}/`).href,
            relative: path.posix.join(relative, safeRelative(file)),
          })),
        }
      })
      yield* materializeRemoteSkillFiles({
        files: roots.flatMap((item) => item.files),
        source: input.source,
        entries: input.entries,
        digests: input.digests,
      })
      return roots.map((item) => ({ name: item.name, relative: item.relative }))
    })

    const directSkillSource = Effect.fnUntraced(function* (input: {
      url: string
      source: MarketplaceSource
      prefix: string
      name: string
      entries: Map<string, TreeEntry>
      digests: Set<string>
    }) {
      const base = input.url.endsWith("/") ? input.url : `${input.url}/`
      const url = new URL("SKILL.md", base).href
      const artifact = yield* fetchArtifact({
        url,
        headers: sameOriginHeaders(input.source, url),
        kind: "skill-file",
        source: input.source,
      })
      input.digests.add(artifact.digest)
      const root = path.posix.join(input.prefix, safeSegment(input.name))
      const relative = path.posix.join(root, "SKILL.md")
      input.entries.set(relative, { relative, bytes: artifact.bytes, digest: artifact.digest })
      return [{ name: input.name, relative: root }]
    })

    const directSkill = Effect.fnUntraced(function* (input: {
      item: MarketplaceSkill
      source: MarketplaceSource
      prefix: string
      entries: Map<string, TreeEntry>
      digests: Set<string>
    }) {
      const configured = input.item.url!
      const url = configured.endsWith("/") ? new URL("SKILL.md", configured).href : configured
      const artifact = yield* fetchArtifact({
        url,
        headers: sameOriginHeaders(input.source, url),
        kind: "skill-file",
        source: input.source,
      })
      input.digests.add(artifact.digest)
      const root = path.posix.join(input.prefix, safeSegment(input.item.id || input.item.name))
      const relative = path.posix.join(root, "SKILL.md")
      input.entries.set(relative, { relative, bytes: artifact.bytes, digest: artifact.digest })
      return { name: input.item.name, relative: root }
    })

    const materializePlan = Effect.fn("MarketplaceCache.materializePlan")(function* (
      inputPlan: MarketplaceInstallPlan,
      source: MarketplaceSource,
    ) {
      const plan = clone(inputPlan)
      const entries = new Map<string, TreeEntry>()
      const digests = new Set<string>()
      const legacyRoots: Array<{ id: string; name: string; relative: string }> = []
      const itemRoots = new Map<string, string>()
      const pluginRelatives = new Map<number, string>()
      const mcpCommandRelatives = new Map<string, Map<number, string>>()

      for (const [index, plugin] of (plan.plugins ?? []).entries()) {
        const spec = Array.isArray(plugin) ? plugin[0] : plugin
        if (!isArtifactURL(spec)) continue
        const artifact = yield* fetchArtifact({
          url: spec,
          headers: sameOriginHeaders(source, spec),
          kind: "plugin-file",
          source,
        })
        digests.add(artifact.digest)
        const basename = safeSegment(path.posix.basename(new URL(spec).pathname) || `plugin-${index}.js`)
        const relative = path.posix.join("plugins", `${index}-${basename}`)
        entries.set(relative, { relative, bytes: artifact.bytes, digest: artifact.digest })
        pluginRelatives.set(index, relative)
      }

      for (const [name, config] of Object.entries(plan.mcp ?? {})) {
        if (config.type !== "local" || !Array.isArray(config.command)) continue
        for (const [index, command] of config.command.entries()) {
          if (typeof command !== "string" || !isArtifactURL(command)) continue
          const artifact = yield* fetchArtifact({
            url: command,
            headers: sameOriginHeaders(source, command),
            kind: "mcp-file",
            source,
          })
          digests.add(artifact.digest)
          const basename = safeSegment(path.posix.basename(new URL(command).pathname) || `command-${index}`)
          const relative = path.posix.join("mcp", safeSegment(name), `${index}-${basename}`)
          entries.set(relative, { relative, bytes: artifact.bytes, digest: artifact.digest })
          const commands = mcpCommandRelatives.get(name) ?? new Map<number, string>()
          commands.set(index, relative)
          mcpCommandRelatives.set(name, commands)
        }
      }

      for (const [index, url] of (plan.skills?.urls ?? []).entries()) {
        const prefix = path.posix.join("skills", `source-${index}`)
        const roots = yield* indexedSkill({
          url,
          source,
          prefix,
          entries,
          digests,
        }).pipe(
          Effect.catch(() =>
            directSkillSource({
              url,
              source,
              prefix,
              name: `source-${index}`,
              entries,
              digests,
            }),
          ),
        )
        legacyRoots.push(
          ...roots.map((root) => ({
            id: `url:${url}#${encodeURIComponent(root.name)}`,
            name: root.name,
            relative: root.relative,
          })),
        )
      }

      for (const item of plan.skills?.items ?? []) {
        if (!item.url) continue
        const indexed = yield* indexedSkill({
          url: item.url,
          source,
          prefix: path.posix.join("skills", `item-${safeSegment(item.id)}`),
          name: item.name,
          entries,
          digests,
        }).pipe(
          Effect.map((roots) => ({ ok: true as const, roots })),
          Effect.catch(() =>
            directSkill({
              item,
              source,
              prefix: path.posix.join("skills", `item-${safeSegment(item.id)}`),
              entries,
              digests,
            }).pipe(Effect.map((root) => ({ ok: true as const, roots: [root] }))),
          ),
        )
        const root = indexed.roots[0]
        if (root) itemRoots.set(item.id, root.relative)
      }

      const instructionRelatives = new Map<number, string>()
      for (const [index, instruction] of (plan.instructions ?? []).entries()) {
        if (!isArtifactURL(instruction)) continue
        const url = new URL(instruction).href
        const artifact = yield* fetchArtifact({
          url,
          headers: sameOriginHeaders(source, url),
          kind: "instruction",
          source,
        })
        digests.add(artifact.digest)
        const basename = safeSegment(path.posix.basename(new URL(url).pathname) || `instruction-${index}.md`)
        const relative = path.posix.join("instructions", `${index}-${basename}`)
        entries.set(relative, { relative, bytes: artifact.bytes, digest: artifact.digest })
        instructionRelatives.set(index, relative)
      }

      if (entries.size > MAX_PACKAGE_FILES) {
        return yield* new CacheError({
          operation: "materialize",
          message: `Marketplace package exceeds ${MAX_PACKAGE_FILES} files`,
        })
      }
      const packageBytes = Array.from(entries.values()).reduce((total, entry) => total + entry.bytes.byteLength, 0)
      if (packageBytes > MAX_PACKAGE_BYTES) {
        return yield* new CacheError({
          operation: "materialize",
          message: `Marketplace package exceeds ${MAX_PACKAGE_BYTES} bytes`,
        })
      }

      if (entries.size === 0) {
        return { plan, artifactDigests: Array.from(digests).toSorted() } satisfies MaterializedPlan
      }

      const manifest = Array.from(entries.values())
        .map((entry) => ({ path: entry.relative, digest: entry.digest }))
        .toSorted((left, right) => left.path.localeCompare(right.path))
      const treeDigest = digestOf(new TextEncoder().encode(stable(manifest)))
      const hex = digestHex(treeDigest)
      const target = path.join(materialized, hex.slice(0, 2), hex)

      yield* flock
        .withLock(
          Effect.gen(function* () {
            if (!(yield* exists(target))) {
              const staging = `${target}.tmp-${randomUUID()}`
              yield* Effect.tryPromise({
                try: async () => {
                  for (const entry of entries.values()) {
                    const file = path.join(staging, ...entry.relative.split("/"))
                    await fsNode.mkdir(path.dirname(file), { recursive: true })
                    await fsNode.writeFile(file, entry.bytes, { mode: 0o600 })
                  }
                  await fsNode.mkdir(path.dirname(target), { recursive: true })
                  await fsNode.rename(staging, target).catch(async (error: NodeJS.ErrnoException) => {
                    if (error.code !== "EEXIST") throw error
                  })
                  await fsNode.rm(staging, { recursive: true, force: true })
                },
                catch: (error) => cacheError("materialize", error),
              })
            }

            const now = Date.now()
            yield* db
              .run(
                sql`
                INSERT INTO marketplace_materialization
                  (digest, path, artifacts, time_created, time_accessed)
                VALUES (${treeDigest}, ${target}, ${JSON.stringify(Array.from(digests).toSorted())}, ${now}, ${now})
                ON CONFLICT(digest) DO UPDATE SET time_accessed = excluded.time_accessed
              `,
              )
              .pipe(Effect.orDie)
          }),
          `marketplace-materialization:${treeDigest}`,
        )
        .pipe(Effect.mapError((error) => cacheError("materialize lock", error)))

      if (plan.plugins && pluginRelatives.size) {
        plan.plugins = plan.plugins.map((plugin, index) => {
          const relative = pluginRelatives.get(index)
          if (!relative) return plugin
          const spec = pathToFileURL(path.join(target, ...relative.split("/"))).href
          return (Array.isArray(plugin) ? [spec, clone(plugin[1])] : spec) as MarketplacePluginSpec
        })
      }

      if (plan.mcp && mcpCommandRelatives.size) {
        plan.mcp = Object.fromEntries(
          Object.entries(plan.mcp).map(([name, config]) => {
            const commands = mcpCommandRelatives.get(name)
            if (!commands || !Array.isArray(config.command)) return [name, config]
            return [
              name,
              {
                ...config,
                command: config.command.map((command, index) => {
                  const relative = commands.get(index)
                  return relative ? path.join(target, ...relative.split("/")) : command
                }),
              },
            ]
          }),
        )
      }

      if (plan.skills) {
        const existing = plan.skills.paths ?? []
        plan.skills.paths = Array.from(new Set(existing))
        delete plan.skills.urls
        const items = (plan.skills.items ?? []).map((item) => {
          const relative = itemRoots.get(item.id)
          if (!relative) return item
          const next = { ...item, path: path.join(target, ...relative.split("/")) }
          delete next.url
          return next
        })
        plan.skills.items = [
          ...items,
          ...legacyRoots.map((root) => ({
            id: root.id,
            name: root.name,
            path: path.join(target, ...root.relative.split("/")),
          })),
        ]
        if (!plan.skills.paths.length) delete plan.skills.paths
      }

      if (plan.instructions) {
        plan.instructions = plan.instructions.map((instruction, index) => {
          const relative = instructionRelatives.get(index)
          return relative ? path.join(target, ...relative.split("/")) : instruction
        })
      }

      return {
        plan,
        artifactDigests: Array.from(digests).toSorted(),
        treeDigest,
      } satisfies MaterializedPlan
    })

    const summary = Effect.fn("MarketplaceCache.summary")(function* () {
      const artifact = (yield* db
        .all<{
          objects: number
          total_bytes: number
        }>(sql`SELECT COUNT(*) AS objects, COALESCE(SUM(size), 0) AS total_bytes FROM marketplace_artifact`)
        .pipe(Effect.orDie))[0] ?? { objects: 0, total_bytes: 0 }
      const fetches =
        (yield* db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM marketplace_fetch`).pipe(Effect.orDie))[0]
          ?.count ?? 0
      const trees =
        (yield* db
          .all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM marketplace_materialization`)
          .pipe(Effect.orDie))[0]?.count ?? 0
      return {
        root,
        objects: Number(artifact.objects),
        total_bytes: Number(artifact.total_bytes),
        fetch_entries: Number(fetches),
        materializations: Number(trees),
      }
    })

    const prune = Effect.fn("MarketplaceCache.prune")(function* (input: {
      keep?: Iterable<string>
      maxAgeDays?: number
    }) {
      const keep = new Set(input.keep ?? [])
      const cutoff = Date.now() - Math.max(0, input.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000
      const artifacts = yield* db
        .all<{
          digest: string
          time_accessed: number
        }>(sql`SELECT digest, time_accessed FROM marketplace_artifact WHERE time_accessed < ${cutoff}`)
        .pipe(Effect.orDie)
      const trees = yield* db
        .all<{
          digest: string
          path: string
          time_accessed: number
        }>(sql`SELECT digest, path, time_accessed FROM marketplace_materialization WHERE time_accessed < ${cutoff}`)
        .pipe(Effect.orDie)

      let removedObjects = 0
      for (const artifact of artifacts) {
        if (keep.has(artifact.digest)) continue
        yield* Effect.tryPromise({
          try: () => fsNode.rm(objectPath(artifact.digest), { force: true }),
          catch: (error) => cacheError("prune object", error),
        })
        yield* db.run(sql`DELETE FROM marketplace_artifact WHERE digest = ${artifact.digest}`).pipe(Effect.orDie)
        removedObjects++
      }

      let removedMaterializations = 0
      for (const tree of trees) {
        if (keep.has(tree.digest)) continue
        yield* Effect.tryPromise({
          try: () => fsNode.rm(tree.path, { recursive: true, force: true }),
          catch: (error) => cacheError("prune materialization", error),
        })
        yield* db.run(sql`DELETE FROM marketplace_materialization WHERE digest = ${tree.digest}`).pipe(Effect.orDie)
        removedMaterializations++
      }

      return {
        removed_objects: removedObjects,
        removed_materializations: removedMaterializations,
        summary: yield* summary(),
      }
    })

    return Service.of({
      put,
      putJson,
      fetchResponse,
      dataURL,
      fetcher,
      materializePlan,
      summary,
      prune,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Database.node, EffectFlock.node],
})

export const MarketplaceCacheNode = node
