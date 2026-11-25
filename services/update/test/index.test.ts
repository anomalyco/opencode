import { Database } from "bun:sqlite"
import { afterAll, expect, setSystemTime, spyOn, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import worker, { allowedChannels, applyPublish, validGitHubClaims, type GitHubClaims } from "../src/index"
import { buildManifestEntries, indexKey, manifestKey, type ArtifactRow } from "../src/manifest"

type Env = Parameters<typeof worker.fetch>[1]

const migrations = path.join(import.meta.dir, "../migrations")
const selectAll = `SELECT channel, name, distribution, version, metadata, active, minimum, time_created, time_updated
FROM artifact INDEXED BY artifact_active WHERE active = 1
UNION ALL
SELECT channel, name, distribution, version, metadata, active, minimum, time_created, time_updated
FROM artifact INDEXED BY artifact_minimum WHERE minimum = 1 AND active = 0
ORDER BY channel, name, distribution`

// Advance the fake clock by an hour per harness so the module-level 60s isolate cache never leaks across tests or reruns.
let clock = Date.now()

function advanceClock() {
  clock = Math.max(clock, Date.now()) + 3_600_000
  setSystemTime(new Date(clock))
}

afterAll(() => setSystemTime())

function memoryKv(initial?: Map<string, string>) {
  const store = new Map<string, string>(initial)
  const reads: string[] = []
  const writes: string[] = []
  let failGet: Error | undefined
  let failPutKey: string | undefined

  const kv = {
    get: async (key: string, type?: string) => {
      reads.push(key)
      if (failGet) throw failGet
      const raw = store.get(key)
      if (raw === undefined) return null
      return type === "json" ? JSON.parse(raw) : raw
    },
    put: async (key: string, value: string) => {
      writes.push(key)
      if (failPutKey && (failPutKey === "*" || failPutKey === key)) {
        throw new Error(`KV put failed for ${key}`)
      }
      store.set(key, value)
    },
  } as unknown as KVNamespace

  return {
    kv,
    store,
    reads,
    writes,
    setFailGet: (error: Error | undefined) => {
      failGet = error
    },
    setFailPut: (key: string | undefined) => {
      failPutKey = key
    },
  }
}

function sqliteDb() {
  const sqlite = new Database(":memory:")
  readdirSync(migrations)
    .sort()
    .forEach((file) => sqlite.exec(readFileSync(path.join(migrations, file), "utf8")))

  const runStatement = (sql: string, values: unknown[]) => {
    sqlite.query(sql).run(...(values as never[]))
    return { success: true }
  }

  const DB = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        sql,
        values,
        first: async () => sqlite.query(sql).get(...(values as never[])) ?? null,
        all: async () => ({ results: sqlite.query(sql).all(...(values as never[])) }),
        run: async () => runStatement(sql, values),
      }),
    }),
    batch: async (statements: Array<{ sql: string; values: unknown[] }>) => {
      sqlite.exec("BEGIN")
      try {
        const results = statements.map((statement) => runStatement(statement.sql, statement.values))
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
  } as unknown as D1Database

  const insert = (input: {
    channel: string
    name?: string
    distribution?: string
    version: string
    metadata?: Record<string, unknown>
    time: number
    updated?: number
    active?: boolean
    minimum?: boolean
  }) =>
    sqlite
      .query(
        `INSERT INTO artifact (channel, name, distribution, version, metadata, active, minimum, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.channel,
        input.name ?? "cli",
        input.distribution ?? "opencode",
        input.version,
        JSON.stringify(input.metadata ?? {}),
        input.active ? 1 : 0,
        input.minimum ? 1 : 0,
        input.time,
        input.updated ?? input.time,
      )

  const activeAndMinimumRows = () => sqlite.query(selectAll).all() as ArtifactRow[]

  return { sqlite, DB, insert, activeAndMinimumRows }
}

// Lookup tests pass a DB that throws on any call to prove GET/HEAD never touch D1.
function unusedDb() {
  return {
    prepare: () => {
      throw new Error("Lookup path must not touch D1")
    },
    batch: () => {
      throw new Error("Lookup path must not touch D1")
    },
  } as unknown as D1Database
}

function harness(options?: { db?: D1Database }) {
  advanceClock()
  const kv = memoryKv()
  const events: unknown[] = []
  const env = {
    DB: options?.db ?? unusedDb(),
    MANIFESTS: kv.kv,
    EVENTS: {
      send: (batch: unknown[]) => {
        events.push(...batch)
        return Promise.resolve()
      },
    },
  } as unknown as Env
  return { kv, env, events }
}

function lookup(env: Env, pathname: string, headers?: HeadersInit, method = "GET") {
  return worker.fetch(new Request(`https://opencode.ai/update/api/${pathname}`, { method, headers }), env, {
    waitUntil: () => {},
  })
}

async function version(response: Response) {
  expect(response.status).toBe(200)
  const body = (await response.json()) as { version: string }
  return body.version
}

function publishClaims(
  ref = "refs/heads/dev",
  event_name = "workflow_dispatch",
  environment = "release",
): GitHubClaims {
  return {
    repository: "anomalyco/opencode",
    repository_id: "975734319",
    repository_owner_id: "66570915",
    workflow_ref: `anomalyco/opencode/.github/workflows/release.yml@${ref}`,
    ref,
    event_name,
    environment,
    sha: "0".repeat(40),
    run_id: "1",
    run_attempt: "1",
    actor: "opencode",
  }
}

test("publish writes D1, distribution manifest, and channel index (manifest before index)", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB })

  const res = await applyPublish(
    h.env,
    {
      channel: "latest",
      name: "cli",
      distribution: "npm",
      version: "2.0.0",
      metadata: { package: "@opencode/cli" },
    },
    publishClaims(),
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ published: true })

  const mKey = manifestKey("latest", "cli", "npm")
  const iKey = indexKey("latest")
  expect(h.kv.writes).toEqual([mKey, iKey])

  const manifest = JSON.parse(h.kv.store.get(mKey) ?? "{}")
  expect(manifest.active.version).toBe("2.0.0")
  expect(manifest.active.metadata).toEqual({
    package: "@opencode/cli",
    github: {
      sha: "0".repeat(40),
      run_id: "1",
      run_attempt: "1",
      actor: "opencode",
      ref: "refs/heads/dev",
    },
  })
  expect(manifest.minimum).toBeUndefined()
  expect(JSON.parse(h.kv.store.get(iKey) ?? "{}")).toEqual({
    entries: [{ name: "cli", distribution: "npm" }],
  })

  // Publishing a second distribution updates the sorted channel index.
  await applyPublish(
    h.env,
    {
      channel: "latest",
      name: "cli",
      distribution: "aur",
      version: "2.0.0",
      metadata: { package: "opencode" },
    },
    publishClaims(),
  )
  expect(JSON.parse(h.kv.store.get(iKey) ?? "{}")).toEqual({
    entries: [
      { name: "cli", distribution: "aur" },
      { name: "cli", distribution: "npm" },
    ],
  })

  // Lookup serves the published artifact from KV without touching D1.
  const readEnv = { ...h.env, DB: unusedDb() }
  expect(await version(await lookup(readEnv, "latest/cli/npm"))).toBe("2.0.0")
})

test("publish manages minimum flag: set, preserve across releases, and clear", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB })

  // Set 1.9.0 as both active and minimum.
  expect(
    (
      await applyPublish(
        h.env,
        {
          channel: "latest",
          name: "cli",
          distribution: "npm",
          version: "1.9.0",
          metadata: { package: "@opencode-ai/cli" },
          minimum: true,
        },
        publishClaims(),
      )
    ).status,
  ).toBe(200)

  // Publish 2.0.0 without minimum -> preserves 1.9.0 as minimum.
  expect(
    (
      await applyPublish(
        h.env,
        {
          channel: "latest",
          name: "cli",
          distribution: "npm",
          version: "2.0.0",
          metadata: { package: "@opencode/cli" },
        },
        publishClaims(),
      )
    ).status,
  ).toBe(200)

  const readEnv = { ...h.env, DB: unusedDb() }
  expect(await version(await lookup(readEnv, "latest/cli/npm?current=1.8.0"))).toBe("1.9.0")
  expect(await version(await lookup(readEnv, "latest/cli/npm?current=1.9.0"))).toBe("2.0.0")
  expect(await version(await lookup(readEnv, "latest/cli/npm?current=2.0.0"))).toBe("2.0.0")

  // Clear minimum with minimum: false.
  expect(
    (
      await applyPublish(
        h.env,
        {
          channel: "latest",
          name: "cli",
          distribution: "npm",
          version: "2.1.0",
          metadata: { package: "@opencode/cli" },
          minimum: false,
        },
        publishClaims(),
      )
    ).status,
  ).toBe(200)

  expect(await version(await lookup(readEnv, "latest/cli/npm?current=1.8.0"))).toBe("2.1.0")
})

test("publish validates minimum, channel, and metadata rules", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB })

  const devMinimum = await applyPublish(
    h.env,
    {
      channel: "dev",
      name: "cli",
      distribution: "opencode",
      version: "0.0.0-dev-18952",
      metadata: {},
      minimum: true,
    },
    publishClaims("refs/heads/dev", "push"),
  )
  expect(devMinimum.status).toBe(400)
  expect(await devMinimum.json()).toEqual({ error: "Minimum is only supported on the latest channel" })

  const invalidMinimumVersion = await applyPublish(
    h.env,
    {
      channel: "latest",
      name: "cli",
      distribution: "opencode",
      version: "not-a-semver",
      metadata: {},
      minimum: true,
    },
    publishClaims(),
  )
  expect(invalidMinimumVersion.status).toBe(400)
  expect(await invalidMinimumVersion.json()).toEqual({ error: "Minimum must have a comparable release version" })

  const nonBooleanMinimum = await applyPublish(
    h.env,
    {
      channel: "latest",
      name: "cli",
      distribution: "opencode",
      version: "1.0.0",
      metadata: {},
      minimum: "true",
    },
    publishClaims(),
  )
  expect(nonBooleanMinimum.status).toBe(400)
  expect(await nonBooleanMinimum.json()).toEqual({ error: "Minimum must be a boolean" })

  const nextChannel = await applyPublish(
    h.env,
    { channel: "next", name: "cli", distribution: "npm", version: "1.0.0", metadata: {} },
    publishClaims("refs/heads/beta", "push"),
  )
  expect(nextChannel.status).toBe(400)
  expect(await nextChannel.json()).toEqual({ error: "Invalid artifact" })

  const disallowed = await applyPublish(
    h.env,
    { channel: "latest", name: "cli", distribution: "npm", version: "1.0.0", metadata: {} },
    publishClaims("refs/heads/dev", "push"),
  )
  expect(disallowed.status).toBe(403)
  expect(await disallowed.json()).toEqual({ error: "Channel is not allowed" })

  const unauth = await worker.fetch(
    new Request("https://opencode.ai/update/api/publish", { method: "POST", body: "{}" }),
    h.env,
    { waitUntil: () => {} },
  )
  expect(unauth.status).toBe(401)
})

test("publish fails loudly on KV write error and converges on retry", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB })
  const log = spyOn(console, "error").mockImplementation(() => {})
  try {
    h.kv.setFailPut(indexKey("latest"))
    const failed = await applyPublish(
      h.env,
      { channel: "latest", name: "cli", distribution: "npm", version: "2.0.0", metadata: { package: "@opencode/cli" } },
      publishClaims(),
    )
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: "Failed to publish artifact" })

    // Retry succeeds and writes both manifest and index cleanly.
    h.kv.setFailPut(undefined)
    const retried = await applyPublish(
      h.env,
      { channel: "latest", name: "cli", distribution: "npm", version: "2.0.0", metadata: { package: "@opencode/cli" } },
      publishClaims(),
    )
    expect(retried.status).toBe(200)
    expect(await version(await lookup({ ...h.env, DB: unusedDb() }, "latest/cli/npm"))).toBe("2.0.0")
  } finally {
    log.mockRestore()
  }
})

test("backfill + lookup matrix serves all depths, minimum selection, desktop manifests, redirects, next->beta, and HEAD", async () => {
  const db = sqliteDb()
  // Latest CLI opencode: minimum 1.0.0, inactive 1.5.0, active 2.0.0
  db.insert({
    channel: "latest",
    name: "cli",
    distribution: "opencode",
    version: "1.0.0",
    time: 100,
    updated: 110,
    minimum: true,
  })
  db.insert({ channel: "latest", name: "cli", distribution: "opencode", version: "1.5.0", time: 200 })
  db.insert({
    channel: "latest",
    name: "cli",
    distribution: "opencode",
    version: "2.0.0",
    metadata: {
      files: { "opencode-darwin-arm64.zip": { url: "https://opencode.ai/files/bin/2.0.0/opencode-darwin-arm64.zip" } },
    },
    time: 300,
    updated: 310,
    active: true,
  })
  // Latest CLI npm: active only
  db.insert({
    channel: "latest",
    name: "cli",
    distribution: "npm",
    version: "2.0.0",
    metadata: { package: "@opencode/cli" },
    time: 300,
    active: true,
  })
  // Latest desktop opencode: minimum 1.0.0 + active 2.0.0 with manifests & files
  db.insert({
    channel: "latest",
    name: "desktop",
    distribution: "opencode",
    version: "1.0.0",
    metadata: {
      files: {
        "opencode-desktop-win-x64.exe": { url: "https://opencode.ai/files/bin/1.0.0/opencode-desktop-win-x64.exe" },
      },
      manifests: { "desktop.yml": { path: "opencode-desktop-win-x64.exe" } },
    },
    time: 100,
    minimum: true,
  })
  db.insert({
    channel: "latest",
    name: "desktop",
    distribution: "opencode",
    version: "2.0.0",
    metadata: {
      files: {
        "opencode-desktop-win-x64.exe": { url: "https://opencode.ai/files/bin/2.0.0/opencode-desktop-win-x64.exe" },
      },
      manifests: {
        "desktop.yml": { path: "opencode-desktop-win-x64.exe" },
        "desktop-mac.yml": { path: "opencode-desktop-mac-arm64.zip" },
      },
    },
    time: 300,
    active: true,
  })
  // Beta channel (also accessed via /api/next)
  db.insert({
    channel: "beta",
    name: "cli",
    distribution: "npm",
    version: "0.0.0-beta-200",
    metadata: { package: "@opencode/cli" },
    time: 400,
    active: true,
  })
  // Dev channel with a stray minimum (must be ignored outside latest)
  db.insert({
    channel: "dev",
    name: "cli",
    distribution: "opencode",
    version: "0.0.0-dev-20000",
    time: 1,
    minimum: true,
  })
  db.insert({
    channel: "dev",
    name: "cli",
    distribution: "opencode",
    version: "0.0.0-dev-18952",
    time: 2,
    active: true,
  })
  // Channel where one release is both active and minimum
  db.insert({
    channel: "both",
    name: "cli",
    distribution: "opencode",
    version: "3.0.0",
    time: 500,
    active: true,
    minimum: true,
  })

  // Populate KV purely via the backfill builder.
  const entries = buildManifestEntries(db.activeAndMinimumRows())
  const h = harness()
  for (const entry of entries) {
    await h.kv.kv.put(entry.key, entry.value)
  }

  // Depth 1: channel listing (ordered by name, distribution)
  const latestRes = await lookup(h.env, "latest")
  expect(latestRes.status).toBe(200)
  expect(latestRes.headers.get("Cache-Control")).toBe("no-store")
  const latestBody = (await latestRes.json()) as {
    channel: string
    artifacts: Array<{ name: string; distribution: string; version: string; active: boolean; minimum: boolean }>
  }
  expect(latestBody.channel).toBe("latest")
  expect(latestBody.artifacts.map((a) => `${a.name}/${a.distribution}@${a.version}`)).toEqual([
    "cli/npm@2.0.0",
    "cli/opencode@2.0.0",
    "desktop/opencode@2.0.0",
  ])

  // Depth 1: release that is both active and minimum is listed once with both flags true
  const bothBody = (await (await lookup(h.env, "both")).json()) as {
    artifacts: Array<{ version: string; active: boolean; minimum: boolean }>
  }
  expect(bothBody.artifacts).toHaveLength(1)
  expect(bothBody.artifacts[0].version).toBe("3.0.0")
  expect(bothBody.artifacts[0].active).toBe(true)
  expect(bothBody.artifacts[0].minimum).toBe(true)

  // Depth 1: unknown channel -> 404
  const unknownChannel = await lookup(h.env, "missing")
  expect(unknownChannel.status).toBe(404)
  expect(await unknownChannel.json()).toEqual({ error: "Channel not found" })

  // Depth 2: artifact name listing
  const cliBody = (await (await lookup(h.env, "latest/cli")).json()) as {
    channel: string
    name: string
    artifacts: Array<{ distribution: string }>
  }
  expect(cliBody.channel).toBe("latest")
  expect(cliBody.name).toBe("cli")
  expect(cliBody.artifacts.map((a) => a.distribution)).toEqual(["npm", "opencode"])
  expect((await lookup(h.env, "latest/unknown")).status).toBe(404)

  // Depth 3: minimum selection rules on latest
  const below = (await (await lookup(h.env, "latest/cli/opencode?current=0.9.0")).json()) as {
    version: string
    active: boolean
    minimum: boolean
    time_created: number
    time_updated: number
  }
  expect(below).toMatchObject({ version: "1.0.0", active: false, minimum: true, time_created: 100, time_updated: 110 })
  expect(await version(await lookup(h.env, "latest/cli/opencode?current=1.0.0"))).toBe("2.0.0")
  expect(await version(await lookup(h.env, "latest/cli/opencode?current=1.5.0"))).toBe("2.0.0")
  expect(await version(await lookup(h.env, "latest/cli/opencode"))).toBe("2.0.0")
  expect(await version(await lookup(h.env, "latest/cli/opencode?current=garbage"))).toBe("1.0.0")
  expect(await version(await lookup(h.env, "latest/cli/opencode", { "User-Agent": "opencode/latest/0.9.0/cli" }))).toBe(
    "1.0.0",
  )
  expect(await version(await lookup(h.env, "latest/cli/opencode", { "User-Agent": "opencode/0.9.0" }))).toBe("1.0.0")
  // Other-channel callers are treated as unknown -> active release
  expect(
    await version(await lookup(h.env, "latest/cli/opencode", { "User-Agent": "opencode/dev/0.0.0-dev-100/cli" })),
  ).toBe("2.0.0")
  expect(await version(await lookup(h.env, "latest/cli/opencode?current=0.0.0-beta-100"))).toBe("2.0.0")
  expect(await version(await lookup(h.env, "latest/cli/opencode?current=0.0.0-next-100"))).toBe("2.0.0")

  // Non-latest channel ignores stray minimum
  expect(
    await version(await lookup(h.env, "dev/cli/opencode", { "User-Agent": "opencode/dev/0.0.0-dev-18952/cli" })),
  ).toBe("0.0.0-dev-18952")
  expect(await version(await lookup(h.env, "dev/cli/opencode?current=garbage"))).toBe("0.0.0-dev-18952")

  // Retired next channel transparently resolves to beta
  const nextRes = await lookup(h.env, "next/cli/npm")
  expect(nextRes.status).toBe(200)
  const nextBody = (await nextRes.json()) as { channel: string; version: string }
  expect(nextBody.channel).toBe("beta")
  expect(nextBody.version).toBe("0.0.0-beta-200")

  // Depth 4: desktop YAML manifest + minimum selection + missing manifest 404
  const ymlActive = await lookup(h.env, "latest/desktop/opencode/latest-mac.yml")
  expect(ymlActive.status).toBe(200)
  expect(ymlActive.headers.get("Content-Type")).toBe("application/yaml; charset=utf-8")
  expect(ymlActive.headers.get("Cache-Control")).toBe("no-store")
  expect(await ymlActive.text()).toContain("version: 2.0.0")

  const ymlMin = await lookup(h.env, "latest/desktop/opencode/latest.yml?current=0.5.0")
  expect(ymlMin.status).toBe(200)
  expect(await ymlMin.text()).toContain("version: 1.0.0")

  const missingYml = await lookup(h.env, "latest/desktop/opencode/latest-linux-arm64.yml")
  expect(missingYml.status).toBe(404)
  expect(await missingYml.json()).toEqual({ error: "Manifest not found" })

  // Depth 4: file redirect + missing file 404
  const fileRedirect = await lookup(h.env, "latest/desktop/opencode/opencode-desktop-win-x64.exe")
  expect(fileRedirect.status).toBe(302)
  expect(fileRedirect.headers.get("Location")).toBe("https://opencode.ai/files/bin/2.0.0/opencode-desktop-win-x64.exe")
  expect(fileRedirect.headers.get("Cache-Control")).toBe("no-store")

  const fileMinRedirect = await lookup(h.env, "latest/desktop/opencode/opencode-desktop-win-x64.exe?current=0.5.0")
  expect(fileMinRedirect.status).toBe(302)
  expect(fileMinRedirect.headers.get("Location")).toBe(
    "https://opencode.ai/files/bin/1.0.0/opencode-desktop-win-x64.exe",
  )

  const missingFile = await lookup(h.env, "latest/desktop/opencode/missing.dmg")
  expect(missingFile.status).toBe(404)
  expect(await missingFile.json()).toEqual({ error: "File not found" })

  // HEAD mirrors GET across JSON, YAML, 302, and 404
  for (const pathname of [
    "latest",
    "latest/cli",
    "latest/desktop/opencode",
    "latest/desktop/opencode/latest.yml",
    "latest/desktop/opencode/opencode-desktop-win-x64.exe",
    "latest/desktop/opencode/missing.dmg",
  ]) {
    const [get, head] = await Promise.all([
      lookup(h.env, pathname, undefined, "GET"),
      lookup(h.env, pathname, undefined, "HEAD"),
    ])
    expect(head.status).toBe(get.status)
    expect(head.headers.get("Location")).toBe(get.headers.get("Location"))
    expect(head.headers.get("Content-Type")).toBe(get.headers.get("Content-Type"))
  }
})

test("reuses KV reads across lookups for 1 minute", async () => {
  const h = harness()
  const key = manifestKey("reuse", "cli", "opencode")
  await h.kv.kv.put(
    key,
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  expect(await version(await lookup(h.env, "reuse/cli/opencode"))).toBe("1.0.0")
  expect(await version(await lookup(h.env, "reuse/cli/opencode"))).toBe("1.0.0")
  expect(h.kv.reads).toHaveLength(1)

  await h.kv.kv.put(
    key,
    JSON.stringify({ active: { version: "1.0.1", metadata: {}, time_created: 2, time_updated: 2 } }),
  )
  setSystemTime(new Date(clock + 59_000))
  expect(await version(await lookup(h.env, "reuse/cli/opencode"))).toBe("1.0.0")
  expect(h.kv.reads).toHaveLength(1)

  setSystemTime(new Date(clock + 61_000))
  expect(await version(await lookup(h.env, "reuse/cli/opencode"))).toBe("1.0.1")
  expect(h.kv.reads).toHaveLength(2)
})

test("does not share in-flight KV reads between concurrent lookups", async () => {
  const h = harness()
  await h.kv.kv.put(
    manifestKey("concurrent", "cli", "opencode"),
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  expect(
    await Promise.all([lookup(h.env, "concurrent/cli/opencode"), lookup(h.env, "concurrent/cli/opencode")]).then(
      (responses) => Promise.all(responses.map(version)),
    ),
  ).toEqual(["1.0.0", "1.0.0"])
  expect(h.kv.reads).toHaveLength(2)
})

test("evicts stale and cold entries without clearing hot reads", async () => {
  const h = harness()
  await h.kv.kv.put(
    manifestKey("hot", "cli", "opencode"),
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  expect(await version(await lookup(h.env, "hot/cli/opencode"))).toBe("1.0.0")
  expect(h.kv.reads).toHaveLength(1)

  for (let i = 0; i < 1_100; i++) {
    expect((await lookup(h.env, `cold-${i}/cli/opencode`)).status).toBe(404)
    expect(await version(await lookup(h.env, "hot/cli/opencode"))).toBe("1.0.0")
  }
  expect(h.kv.reads).toHaveLength(1_101)
})

test("returns a retryable 503 when KV fails and retries on the next lookup", async () => {
  const h = harness()
  await h.kv.kv.put(
    manifestKey("retry", "cli", "opencode"),
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  const log = spyOn(console, "error").mockImplementation(() => {})
  try {
    h.kv.setFailGet(new Error("KV unavailable"))
    const failed = await lookup(h.env, "retry/cli/opencode")
    expect(failed.status).toBe(503)
    expect(failed.headers.get("Retry-After")).toBe("60")
    expect(failed.headers.get("Cache-Control")).toBe("no-store")
    expect(await failed.json()).toEqual({ error: "Update service temporarily unavailable" })

    h.kv.setFailGet(undefined)
    expect(await version(await lookup(h.env, "retry/cli/opencode"))).toBe("1.0.0")
  } finally {
    log.mockRestore()
  }
})

test.each([
  "https://update.opencode.ai/api/latest/cli/npm",
  "https://example.com/update/api/latest/cli/npm",
  "https://opencode.ai/api/latest/cli/npm",
  "https://opencode.ai/update/admin",
  "https://opencode.ai/update/api",
  "https://opencode.ai/update/api/a/b/c/d/e",
])("returns 404 for %s", async (url) => {
  const h = harness()
  expect((await worker.fetch(new Request(url), h.env, { waitUntil: () => {} })).status).toBe(404)
})

test.each([
  ["POST", "https://opencode.ai/update/admin/activate", 405],
  ["HEAD", "https://opencode.ai/update/admin", 405],
  ["PUT", "https://opencode.ai/update/api/latest/cli/opencode", 405],
  ["DELETE", "https://opencode.ai/update/api/latest/cli/opencode", 405],
] as const)("returns %p %s -> %p", async (method, url, status) => {
  const h = harness()
  expect((await worker.fetch(new Request(url, { method }), h.env, { waitUntil: () => {} })).status).toBe(status)
})

test("serves root health endpoint and both allowed hosts (including trailing dot)", async () => {
  const h = harness()
  await h.kv.kv.put(
    manifestKey("public", "cli", "opencode"),
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  const root = await worker.fetch(new Request("https://opencode.ai/update/"), h.env, { waitUntil: () => {} })
  expect(root.status).toBe(200)
  expect(await root.json()).toEqual({ service: "opencode-update" })

  for (const host of ["opencode.ai", "opencode.ai.", "OPENCODE.AI.", "dev.opencode.ai"]) {
    const res = await worker.fetch(new Request(`https://${host}/update/api/public/cli/opencode`), h.env, {
      waitUntil: () => {},
    })
    expect(await version(res)).toBe("1.0.0")
  }
})

test("logs the data lake send error", async () => {
  const h = harness()
  const error = new Error("pipeline unavailable")
  let pending: Promise<unknown> | undefined
  const log = spyOn(console, "error").mockImplementation(() => {})
  try {
    await worker.fetch(
      new Request("https://opencode.ai/update/"),
      { ...h.env, EVENTS: { send: () => Promise.reject(error) } } as unknown as Env,
      { waitUntil: (promise) => (pending = promise) },
    )
    await pending
    expect(log).toHaveBeenCalledWith("Failed to send update request event to the data lake", error)
  } finally {
    log.mockRestore()
  }
})

// Pushes to dev ship 0.0.0-dev-N to "dev". Only a dispatch with a bump or version may ship a release to "latest".
test.each([
  ["refs/heads/dev", "push", ["dev"]],
  ["refs/heads/dev", "workflow_dispatch", ["dev", "latest"]],
  ["refs/heads/beta", "push", ["beta"]],
  ["refs/heads/beta", "workflow_dispatch", ["beta"]],
  // These branches no longer publish (v2 was merged into dev).
  ["refs/heads/v1", "push", []],
  ["refs/heads/v2", "push", []],
  ["refs/heads/ci", "push", []],
  ["refs/heads/snapshot-otui", "workflow_dispatch", []],
] as const)("allows %s on %s to publish to %p", (ref, event, channels) => {
  expect(allowedChannels({ ref, event_name: event })).toEqual([...channels])
})

// Build jobs run repository code and hold no environment, so their tokens must never publish.
test.each([
  ["release", true],
  ["", false],
  ["production", false],
])("accepts publish tokens from environment %p: %p", (environment, valid) => {
  expect(validGitHubClaims(publishClaims("refs/heads/dev", "push", environment))).toBe(valid)
})
