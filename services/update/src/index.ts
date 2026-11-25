import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import type { Pipeline } from "cloudflare:pipelines"
import semver from "semver"
import { stringify } from "yaml"
import {
  compareEntries,
  indexKey,
  manifestKey,
  parseMetadata,
  toManifestEntry,
  type ArtifactRow,
  type ChannelIndex,
  type DistributionManifest,
  type ManifestEntry,
} from "./manifest"

interface Env {
  DB: D1Database
  MANIFESTS: KVNamespace
  EVENTS: Pipeline
}

type Artifact = {
  channel: string
  name: string
  distribution: string
  version: string
  metadata: unknown
  active: boolean
  minimum: boolean
  time_created: number
  time_updated: number
}

type PublishInput = {
  channel: string
  name: string
  distribution: string
  version: string
  metadata: Record<string, unknown>
  minimum?: boolean
}

const identifier = /^[a-zA-Z0-9._-]{1,64}$/
const version = /^[a-zA-Z0-9.+_-]{1,128}$/
const select =
  "SELECT channel, name, distribution, version, metadata, active, minimum, time_created, time_updated FROM artifact"
const audience = "https://update.opencode.ai"
const githubKeys = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"))
const hosts = ["opencode.ai", "dev.opencode.ai"]
const prefix = "/update"
// KV reads are billed per read and this worker handles ~65M requests/day.
// Cache parsed KV reads per isolate for 60s so each isolate reads each hot key about once a minute;
// caller-specific selection still runs per request.
const readTtl = 60_000
const reads = new Map<string, { expires: number; value: unknown }>()

export default {
  async fetch(request: Request, env: Env, ctx: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
    const url = new URL(request.url)
    const host = url.hostname.replace(/\.$/, "").toLowerCase()
    if (!hosts.includes(host) || !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      return new Response("Not found", { status: 404 })
    }
    const pathname = url.pathname.slice(prefix.length) || "/"
    ctx.waitUntil(
      env.EVENTS.send([
        {
          source: "update",
          type: "request",
          timestamp: new Date().toISOString(),
          payload: {
            method: request.method,
            path: pathname,
            useragent: request.headers.get("user-agent"),
            ip: request.headers.get("cf-connecting-ip"),
            cf_country: request.cf?.country,
            cf_colo: request.cf?.colo,
          },
        },
      ]).catch((error) => console.error("Failed to send update request event to the data lake", error)),
    )

    if (pathname === "/") return json({ service: "opencode-update" })
    if (pathname === "/api/publish" && request.method === "POST") return publishArtifact(request, env)
    // Download managers probe with HEAD before downloading; the runtime drops the body from HEAD responses.
    const head = request.method === "HEAD" && pathname.startsWith("/api/")
    if (request.method !== "GET" && !head) return new Response("Method not allowed", { status: 405 })

    const [root, ...path] = pathname.split("/").filter(Boolean)
    if (root !== "api" || path.length < 1 || path.length > 4 || !path.every(validIdentifier)) {
      return new Response("Not found", { status: 404 })
    }

    return lookup(request, env.MANIFESTS, url, path).catch((error) => {
      console.error("Update lookup failed", error)
      return json({ error: "Update service temporarily unavailable" }, 503, { "Retry-After": "60" })
    })
  },
} satisfies ExportedHandler<Env>

async function lookup(request: Request, kv: KVNamespace, url: URL, path: string[]) {
  const resolved = resolveChannel(path[0])
  const agent = request.headers.get("User-Agent")?.match(/^opencode\/(?:([^/]+)\/([^/]+)\/cli|(.*))$/)
  const current = url.searchParams.get("current") ?? agent?.[2] ?? agent?.[3]
  const source = agent?.[1] ?? current?.match(/^v?0\.0\.0-(.+)-\d+(?:\.\d+)?(?:\+.*)?$/)?.[1]
  const caller = source === undefined || resolveChannel(source) === resolved ? current : undefined
  if (path.length === 4) return artifactDistribution(kv, resolved, path[1], path[2], caller, path[3])
  if (path.length === 1) return channel(kv, resolved, caller)
  if (path.length === 2) return artifactName(kv, resolved, path[1], caller)
  return artifactDistribution(kv, resolved, path[1], path[2], caller)
}

async function channel(kv: KVNamespace, channel: string, current: string | undefined) {
  const index = await readIndex(kv, channel)
  if (!index?.entries.length) return json({ error: "Channel not found" }, 404)
  const manifests = await Promise.all(
    index.entries.map(async (entry) => ({
      entry,
      manifest: await readManifest(kv, channel, entry.name, entry.distribution),
    })),
  )
  const artifacts = manifests.flatMap((item) =>
    item.manifest ? [selectArtifact(channel, item.entry.name, item.entry.distribution, item.manifest, current)] : [],
  )
  if (!artifacts.length) return json({ error: "Channel not found" }, 404)
  return updateResponse({ channel, artifacts })
}

async function artifactName(kv: KVNamespace, channel: string, name: string, current: string | undefined) {
  const index = await readIndex(kv, channel)
  const entries = index?.entries.filter((entry) => entry.name === name) ?? []
  if (!entries.length) return json({ error: "Artifact not found" }, 404)
  const manifests = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      manifest: await readManifest(kv, channel, entry.name, entry.distribution),
    })),
  )
  const artifacts = manifests.flatMap((item) =>
    item.manifest ? [selectArtifact(channel, item.entry.name, item.entry.distribution, item.manifest, current)] : [],
  )
  if (!artifacts.length) return json({ error: "Artifact not found" }, 404)
  return updateResponse({ channel, name, artifacts })
}

async function artifactDistribution(
  kv: KVNamespace,
  channel: string,
  name: string,
  distribution: string,
  current: string | undefined,
  file?: string,
) {
  const manifest = await readManifest(kv, channel, name, distribution)
  if (!manifest) return json({ error: "Artifact not found" }, 404)
  const artifact = selectArtifact(channel, name, distribution, manifest, current)
  if (file) {
    if (name === "desktop" && /^latest(?:-mac|-linux(?:-arm64)?)?\.yml$/.test(file)) {
      const value =
        isRecord(artifact.metadata) && isRecord(artifact.metadata.manifests)
          ? artifact.metadata.manifests[file.replace(/^latest/, "desktop")]
          : undefined
      if (!isRecord(value)) return json({ error: "Manifest not found" }, 404)
      return new Response(stringify({ ...value, version: artifact.version }), {
        headers: { "Content-Type": "application/yaml; charset=utf-8", "Cache-Control": "no-store" },
      })
    }
    const entry =
      isRecord(artifact.metadata) && isRecord(artifact.metadata.files) ? artifact.metadata.files[file] : undefined
    if (!isRecord(entry) || typeof entry.url !== "string") return json({ error: "File not found" }, 404)
    return new Response(null, { status: 302, headers: { Location: entry.url, "Cache-Control": "no-store" } })
  }
  return updateResponse(artifact)
}

function readIndex(kv: KVNamespace, channel: string) {
  const key = indexKey(channel)
  return cachedRead<ChannelIndex | null>(key, () => kv.get<ChannelIndex>(key, "json"))
}

function readManifest(kv: KVNamespace, channel: string, name: string, distribution: string) {
  const key = manifestKey(channel, name, distribution)
  return cachedRead<DistributionManifest | null>(key, () => kv.get<DistributionManifest>(key, "json"))
}

function selectArtifact(
  channel: string,
  name: string,
  distribution: string,
  manifest: DistributionManifest,
  current: string | undefined,
): Artifact {
  // Preview build numbers reset, so a minimum outside latest can send clients back to a build they passed.
  const minimum = channel === "latest" ? manifest.minimum : undefined
  const floor = minimum && releaseVersion(minimum.version)
  const caller = current === undefined ? undefined : releaseVersion(current)
  const same = manifest.minimum !== undefined && manifest.minimum.version === manifest.active.version
  if (current !== undefined && minimum && (!floor || !caller || semver.lt(caller, floor))) {
    return toArtifact(channel, name, distribution, minimum, same, true)
  }
  return toArtifact(channel, name, distribution, manifest.active, true, same)
}

function toArtifact(
  channel: string,
  name: string,
  distribution: string,
  entry: ManifestEntry,
  active: boolean,
  minimum: boolean,
): Artifact {
  return {
    channel,
    name,
    distribution,
    version: entry.version,
    metadata: entry.metadata,
    active,
    minimum,
    time_created: entry.time_created,
    time_updated: entry.time_updated ?? entry.time_created,
  }
}

function releaseVersion(input: string) {
  // Preview builds use a hyphen before the run number. Normalize it to a numeric
  // prerelease identifier, and compare historical next builds in the beta channel.
  return semver.valid(
    input.replace(
      /^(v?0\.0\.0)-(next|beta|dev)-(\d+)(?=\.|$)/,
      (_, core, channel, build) => `${core}-${resolveChannel(channel)}.${build}`,
    ),
  )
}

async function publishArtifact(request: Request, env: Env) {
  const claims = await verifyGitHub(request)
  if (claims instanceof Response) return claims
  const input: unknown = await request.json().catch(() => undefined)
  return applyPublish(env, input, claims)
}

export async function applyPublish(env: Env, input: unknown, claims: GitHubClaims) {
  const artifact = parseArtifact(isRecord(input) ? input : {})
  if (artifact instanceof Response) return artifact
  if (!allowedChannels(claims).includes(artifact.channel)) return json({ error: "Channel is not allowed" }, 403)
  if (artifact.minimum === true && artifact.channel !== "latest") {
    return json({ error: "Minimum is only supported on the latest channel" }, 400)
  }
  if (artifact.minimum === true && !releaseVersion(artifact.version)) {
    return json({ error: "Minimum must have a comparable release version" }, 400)
  }

  const record: PublishInput = {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      github: {
        sha: claims.sha,
        run_id: claims.run_id,
        run_attempt: claims.run_attempt,
        actor: claims.actor,
        ref: claims.ref,
      },
    },
  }

  try {
    await writeArtifact(env.DB, record)
    await syncManifest(env.DB, env.MANIFESTS, record.channel, record.name, record.distribution)
  } catch (error) {
    console.error("Failed to publish artifact", error)
    return json({ error: "Failed to publish artifact" }, 500)
  }

  return json({ published: true })
}

function writeArtifact(db: D1Database, artifact: PublishInput) {
  const time = Date.now()
  const statements = [
    db
      .prepare("UPDATE artifact SET active = 0 WHERE channel = ? AND name = ? AND distribution = ? AND active = 1")
      .bind(artifact.channel, artifact.name, artifact.distribution),
    ...(artifact.minimum === undefined
      ? [
          db
            .prepare(
              `INSERT INTO artifact (channel, name, distribution, version, metadata, active, time_created, time_updated)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?)
               ON CONFLICT (channel, name, distribution, version) DO UPDATE SET
                 metadata = excluded.metadata, active = 1, time_updated = excluded.time_updated`,
            )
            .bind(
              artifact.channel,
              artifact.name,
              artifact.distribution,
              artifact.version,
              JSON.stringify(artifact.metadata),
              time,
              time,
            ),
        ]
      : [
          db
            .prepare(
              "UPDATE artifact SET minimum = 0 WHERE channel = ? AND name = ? AND distribution = ? AND minimum = 1",
            )
            .bind(artifact.channel, artifact.name, artifact.distribution),
          db
            .prepare(
              `INSERT INTO artifact (channel, name, distribution, version, metadata, active, minimum, time_created, time_updated)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
               ON CONFLICT (channel, name, distribution, version) DO UPDATE SET
                 metadata = excluded.metadata, active = 1, minimum = excluded.minimum, time_updated = excluded.time_updated`,
            )
            .bind(
              artifact.channel,
              artifact.name,
              artifact.distribution,
              artifact.version,
              JSON.stringify(artifact.metadata),
              artifact.minimum ? 1 : 0,
              time,
              time,
            ),
        ]),
  ]
  return db.batch(statements)
}

async function syncManifest(db: D1Database, kv: KVNamespace, channel: string, name: string, distribution: string) {
  const [rows, indexRows] = await Promise.all([
    db
      .prepare(
        `${select} INDEXED BY artifact_active WHERE channel = ? AND name = ? AND distribution = ? AND active = 1
         UNION ALL
         ${select} INDEXED BY artifact_minimum WHERE channel = ? AND name = ? AND distribution = ? AND minimum = 1 AND active = 0`,
      )
      .bind(channel, name, distribution, channel, name, distribution)
      .all<ArtifactRow>(),
    db
      .prepare(
        `SELECT name, distribution FROM artifact INDEXED BY artifact_active
         WHERE channel = ? AND active = 1 ORDER BY name, distribution`,
      )
      .bind(channel)
      .all<{ name: string; distribution: string }>(),
  ])

  const activeRow = rows.results.find((row) => row.active === 1)
  if (!activeRow) throw new Error(`Missing active artifact after publish: ${channel}/${name}/${distribution}`)
  const minimumRow = rows.results.find((row) => row.minimum === 1)
  const manifest: DistributionManifest = minimumRow
    ? { active: toManifestEntry(activeRow), minimum: toManifestEntry(minimumRow) }
    : { active: toManifestEntry(activeRow) }
  const index: ChannelIndex = {
    entries: indexRows.results.map((row) => ({ name: row.name, distribution: row.distribution })).sort(compareEntries),
  }

  const mKey = manifestKey(channel, name, distribution)
  const iKey = indexKey(channel)
  // Write the manifest before the channel index so an index never points to an unwritten manifest.
  await kv.put(mKey, JSON.stringify(manifest))
  await kv.put(iKey, JSON.stringify(index))
  reads.delete(mKey)
  reads.delete(iKey)
}

function parseArtifact(input: Record<string, unknown>): PublishInput | Response {
  if (
    !validIdentifier(input.channel) ||
    input.channel === "next" ||
    !validIdentifier(input.name) ||
    !validIdentifier(input.distribution) ||
    !validVersion(input.version)
  ) {
    return json({ error: "Invalid artifact" }, 400)
  }
  const metadata = typeof input.metadata === "string" ? parseMetadata(input.metadata) : input.metadata
  if (metadata === undefined) return json({ error: "Metadata must be valid JSON" }, 400)
  if (!isRecord(metadata)) return json({ error: "Metadata must be an object" }, 400)
  if (input.minimum !== undefined && typeof input.minimum !== "boolean") {
    return json({ error: "Minimum must be a boolean" }, 400)
  }
  return {
    channel: input.channel,
    name: input.name,
    distribution: input.distribution,
    version: input.version,
    metadata,
    minimum: input.minimum,
  }
}

async function verifyGitHub(request: Request) {
  const authorization = request.headers.get("Authorization")
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401)
  const result = await jwtVerify(authorization.slice("Bearer ".length), githubKeys, {
    issuer: "https://token.actions.githubusercontent.com",
    audience,
  }).catch(() => undefined)
  if (!result || !validGitHubClaims(result.payload)) return json({ error: "Unauthorized" }, 401)
  return result.payload
}

export type GitHubClaims = JWTPayload & {
  repository: string
  repository_id: string
  repository_owner_id: string
  workflow_ref: string
  ref: string
  event_name: string
  environment: string
  sha: string
  run_id: string
  run_attempt: string
  actor: string
}

export function validGitHubClaims(claims: JWTPayload): claims is GitHubClaims {
  if (claims.repository !== "anomalyco/opencode") return false
  if (claims.repository_id !== "975734319") return false
  if (claims.repository_owner_id !== "66570915") return false
  if (typeof claims.workflow_ref !== "string" || typeof claims.ref !== "string") return false
  if (claims.workflow_ref !== `anomalyco/opencode/.github/workflows/release.yml@${claims.ref}`) return false
  // Only publish jobs run in the release environment, and they never execute repository code.
  if (claims.environment !== "release") return false
  if (typeof claims.event_name !== "string") return false
  return [claims.sha, claims.run_id, claims.run_attempt, claims.actor].every((value) => typeof value === "string")
}

// Pushes to dev ship dev builds. Only a manual dispatch of a versioned release may ship to latest.
export function allowedChannels(claims: Pick<GitHubClaims, "ref" | "event_name">) {
  if (claims.ref === "refs/heads/dev") return claims.event_name === "workflow_dispatch" ? ["dev", "latest"] : ["dev"]
  if (claims.ref === "refs/heads/beta") return ["beta"]
  return []
}

export function resolveChannel(channel: string) {
  return channel === "next" ? "beta" : channel
}

async function cachedRead<T>(key: string, load: () => Promise<T>) {
  const hit = reads.get(key)
  if (hit) {
    reads.delete(key)
    if (hit.expires > Date.now()) {
      reads.set(key, hit)
      return hit.value as T
    }
  }
  // Workers ties I/O streams to the request that started the call, so sharing an in-flight
  // promise fails other requests with "Cannot perform I/O on behalf of a different request".
  // Only settled results are shared. Failed reads throw before they are cached, so the next request retries KV.
  const value = await load()
  const now = Date.now()
  // Lookup paths are caller-controlled identifiers, so bound the number of retained entries.
  if (reads.size >= 1_000) {
    reads.forEach((entry, k) => {
      if (entry.expires <= now) reads.delete(k)
    })
    if (reads.size >= 1_000) {
      const oldest = reads.keys().next().value
      if (oldest !== undefined) reads.delete(oldest)
    }
  }
  reads.set(key, { expires: now + readTtl, value })
  return value
}

function validIdentifier(input: unknown): input is string {
  return typeof input === "string" && identifier.test(input)
}

function validVersion(input: unknown): input is string {
  return typeof input === "string" && version.test(input)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function updateResponse(value: unknown) {
  return json(value, 200, { "Cache-Control": "no-store" })
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } })
}
