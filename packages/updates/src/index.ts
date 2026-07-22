import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

interface Env {
  DB: D1Database
}

type ArtifactRow = {
  channel: string
  name: string
  distribution: string
  version: string
  metadata: string
  active: number
  time_updated: number
}

type Artifact = Omit<ArtifactRow, "metadata" | "active"> & {
  metadata: unknown
  active: boolean
}

type ArtifactInput = Pick<ArtifactRow, "channel" | "name" | "distribution" | "version"> & {
  metadata: unknown
}

const identifier = /^[a-zA-Z0-9._-]{1,64}$/
const version = /^[a-zA-Z0-9.+_-]{1,128}$/
const select = "SELECT channel, name, distribution, version, metadata, active, time_updated FROM artifact"
const audience = "https://update.opencode.ai"
const githubKeys = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"))

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/") return json({ service: "opencode-updates" })
    if (url.pathname === "/admin" && request.method === "GET") return admin(request, env)
    if (url.pathname === "/admin/artifact" && request.method === "POST") return registerArtifact(request, env)
    if (url.pathname === "/admin/activate" && request.method === "POST") return activateArtifact(request, env)
    if (url.pathname === "/api/publish" && request.method === "POST") return publishArtifact(request, env)
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })

    const segments = url.pathname.split("/").filter(Boolean)
    if (segments.length === 2 && segments[0] === "api" && validIdentifier(segments[1])) {
      return channel(env.DB, segments[1])
    }
    return new Response("Not found", { status: 404 })
  },
} satisfies ExportedHandler<Env>

async function channel(db: D1Database, channel: string) {
  const result = await db
    .prepare(`${select} WHERE channel = ? AND active = 1 ORDER BY name, distribution`)
    .bind(channel)
    .all<ArtifactRow>()
  if (!result.results.length) return json({ error: "Channel not found" }, 404)
  return cached({ channel, artifacts: result.results.map(decodeArtifact) })
}

async function admin(request: Request, env: Env) {
  const result = await env.DB.prepare(`${select} ORDER BY channel, name, distribution, active DESC, time_updated DESC`).all<ArtifactRow>()
  const rows = result.results
    .map(
      (artifact) => `<tr>
        <td><code>${escape(artifact.channel)}</code></td>
        <td><code>${escape(artifact.name)}</code></td>
        <td><code>${escape(artifact.distribution)}</code></td>
        <td><code>${escape(artifact.version)}</code></td>
        <td>${artifact.active ? '<span class="badge">Active</span>' : '<span class="badge" data-variant="secondary">History</span>'}</td>
        <td>${new Date(artifact.time_updated).toISOString()}</td>
        <td>
          ${
            artifact.active
              ? ""
              : `<form action="/admin/activate" method="post">
                  <input type="hidden" name="channel" value="${escape(artifact.channel)}">
                  <input type="hidden" name="name" value="${escape(artifact.name)}">
                  <input type="hidden" name="distribution" value="${escape(artifact.distribution)}">
                  <input type="hidden" name="version" value="${escape(artifact.version)}">
                  <button class="btn" data-size="sm" data-variant="outline" type="submit">Activate</button>
                </form>`
          }
        </td>
      </tr>`,
    )
    .join("")

  return new Response(
    `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenCode Updates</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/basecoat-css@1.0.2/dist/basecoat.cdn.min.css">
  <style>
    body { min-height: 100vh; background: var(--background); }
    main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 4rem 0; }
    .masthead { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-bottom: 2rem; }
    .masthead h1 { font-size: clamp(2.25rem, 6vw, 4.5rem); line-height: .95; letter-spacing: -.055em; }
    .masthead p { color: var(--muted-foreground); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .8rem 1rem; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
    th { color: var(--muted-foreground); font-size: .75rem; font-weight: 500; text-transform: uppercase; letter-spacing: .08em; }
    tbody tr:last-child td { border-bottom: 0; }
    td form { margin: 0; }
    .publish { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
    .publish .metadata { grid-column: 1 / -1; }
    textarea { min-height: 9rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .actions { display: flex; justify-content: end; grid-column: 1 / -1; }
    @media (max-width: 760px) { main { padding: 2rem 0; } .masthead { align-items: start; flex-direction: column; } .publish { grid-template-columns: 1fr; } .publish .metadata, .actions { grid-column: 1; } }
  </style>
</head>
<body>
  <main>
    <header class="masthead">
      <div><p>Release control</p><h1>Artifacts</h1></div>
      <span class="badge" data-variant="outline">${escape(request.headers.get("Cf-Access-Authenticated-User-Email") ?? "Cloudflare Access pending")}</span>
    </header>
    <article class="card">
      <header><h2>Published artifacts</h2><p>Activate any successfully published version without changing its metadata.</p></header>
      <section class="table-wrap">
        <table>
          <thead><tr><th>Channel</th><th>Name</th><th>Distribution</th><th>Version</th><th>Status</th><th>Time updated</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7">No artifacts published yet.</td></tr>'}</tbody>
        </table>
      </section>
    </article>
    <article class="card">
      <header><h2>Publish artifact</h2><p>Publishing stores the metadata and activates this version for its distribution.</p></header>
      <section>
        <form action="/admin/artifact" method="post" class="publish">
          ${field("Channel", '<input name="channel" value="latest" required>')}
          ${field("Name", '<input name="name" placeholder="cli" required>')}
          ${field("Distribution", '<input name="distribution" placeholder="npm" required>')}
          ${field("Version", '<input name="version" placeholder="1.0.0" required>')}
          <div class="field metadata"><label for="metadata">Metadata</label><textarea class="textarea" id="metadata" name="metadata" spellcheck="false">{}</textarea><p class="text-muted-foreground">JSON containing URLs, hashes, sizes, or distribution-specific data.</p></div>
          <div class="actions"><button class="btn" type="submit">Publish and activate</button></div>
        </form>
      </section>
    </article>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )
}

async function registerArtifact(request: Request, env: Env) {
  const invalid = validMutation(request)
  if (invalid) return invalid
  const form = await request.formData()
  const artifact = parseArtifact({
    channel: form.get("channel"),
    name: form.get("name"),
    distribution: form.get("distribution"),
    version: form.get("version"),
    metadata: form.get("metadata"),
  })
  if (artifact instanceof Response) return artifact
  await activate(env.DB, [artifact])
  return Response.redirect(new URL("/admin", request.url), 303)
}

async function publishArtifact(request: Request, env: Env) {
  const claims = await verifyGitHub(request)
  if (claims instanceof Response) return claims
  const input: unknown = await request.json().catch(() => undefined)
  const artifact = parseArtifact(isRecord(input) ? input : {})
  if (artifact instanceof Response) return artifact
  if (!channelsForRef(claims.ref).includes(artifact.channel)) return json({ error: "Channel is not allowed" }, 403)
  if (!isRecord(artifact.metadata)) return json({ error: "Metadata must be an object" }, 400)
  await activate(env.DB, [
    {
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
    },
  ])
  return json({ published: true })
}

async function activateArtifact(request: Request, env: Env) {
  const invalid = validMutation(request)
  if (invalid) return invalid
  const form = await request.formData()
  const key = parseKey({
    channel: form.get("channel"),
    name: form.get("name"),
    distribution: form.get("distribution"),
    version: form.get("version"),
  })
  if (key instanceof Response) return key
  const exists = await env.DB.prepare(
    "SELECT 1 FROM artifact WHERE channel = ? AND name = ? AND distribution = ? AND version = ?",
  )
    .bind(key.channel, key.name, key.distribution, key.version)
    .first()
  if (!exists) return json({ error: "Artifact not found" }, 404)
  await env.DB.batch([
    deactivateStatement(env.DB, key),
    env.DB
      .prepare(
        "UPDATE artifact SET active = 1, time_updated = ? WHERE channel = ? AND name = ? AND distribution = ? AND version = ?",
      )
      .bind(Date.now(), key.channel, key.name, key.distribution, key.version),
  ])
  return Response.redirect(new URL("/admin", request.url), 303)
}

function activate(db: D1Database, artifacts: ArtifactInput[]) {
  return db.batch(
    artifacts.flatMap((artifact) => [
      deactivateStatement(db, artifact),
      db
        .prepare(
          `INSERT INTO artifact (channel, name, distribution, version, metadata, active, time_updated)
           VALUES (?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (channel, name, distribution, version) DO UPDATE SET
             metadata = excluded.metadata, active = 1, time_updated = excluded.time_updated`,
        )
        .bind(
          artifact.channel,
          artifact.name,
          artifact.distribution,
          artifact.version,
          JSON.stringify(artifact.metadata),
          Date.now(),
        ),
    ]),
  )
}

function deactivateStatement(db: D1Database, artifact: Pick<ArtifactInput, "channel" | "name" | "distribution">) {
  return db
    .prepare("UPDATE artifact SET active = 0 WHERE channel = ? AND name = ? AND distribution = ? AND active = 1")
    .bind(artifact.channel, artifact.name, artifact.distribution)
}

function parseArtifact(input: Record<string, unknown>): ArtifactInput | Response {
  const key = parseKey(input)
  if (key instanceof Response) return key
  const metadata = typeof input.metadata === "string" ? parseMetadata(input.metadata) : input.metadata
  if (metadata === undefined) return json({ error: "Metadata must be valid JSON" }, 400)
  return { ...key, metadata }
}

function parseKey(input: Record<string, unknown>): Omit<ArtifactInput, "metadata"> | Response {
  if (
    !validIdentifier(input.channel) ||
    !validIdentifier(input.name) ||
    !validIdentifier(input.distribution) ||
    !validVersion(input.version)
  )
    return json({ error: "Invalid artifact" }, 400)
  return {
    channel: input.channel,
    name: input.name,
    distribution: input.distribution,
    version: input.version,
  }
}

function decodeArtifact(row: ArtifactRow): Artifact {
  return { ...row, metadata: decodeMetadata(row.metadata), active: row.active === 1 }
}

function decodeMetadata(input: string) {
  return parseMetadata(input) ?? null
}

function parseMetadata(input: string): unknown | undefined {
  try {
    return JSON.parse(input)
  } catch {
    return
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

type GitHubClaims = JWTPayload & {
  repository: string
  repository_id: string
  repository_owner_id: string
  workflow_ref: string
  ref: string
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
  if (claims.workflow_ref !== `anomalyco/opencode/.github/workflows/publish.yml@${claims.ref}`) return false
  if (!channelsForRef(claims.ref).length) return false
  return [claims.sha, claims.run_id, claims.run_attempt, claims.actor].every((value) => typeof value === "string")
}

export function channelsForRef(ref: string) {
  if (ref === "refs/heads/dev") return ["dev", "latest"]
  if (ref === "refs/heads/v2") return ["next"]
  if (ref === "refs/heads/beta") return ["beta"]
  if (ref === "refs/heads/ci") return ["ci"]
  if (ref === "refs/heads/fix/npm-native-binary-install") return ["fix/npm-native-binary-install"]
  const snapshot = ref.match(/^refs\/heads\/(snapshot-[a-zA-Z0-9._-]+)$/)?.[1]
  return snapshot ? [snapshot] : []
}

function validMutation(request: Request) {
  const origin = request.headers.get("Origin")
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403)
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

function cached(value: unknown) {
  return json(value, 200, { "Cache-Control": "public, max-age=60" })
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, { status, headers })
}

function field(label: string, input: string) {
  return `<div class="field"><label>${label}</label>${input}</div>`
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;"
    if (character === "<") return "&lt;"
    if (character === ">") return "&gt;"
    if (character === '"') return "&quot;"
    return "&#39;"
  })
}
