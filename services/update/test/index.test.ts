import { Database } from "bun:sqlite"
import { afterAll, expect, setSystemTime, spyOn, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import worker, { allowedChannels, applyPublish, validGitHubClaims, type GitHubClaims } from "../src/index"
import { buildManifestEntries, indexKey, manifestKey, selectActiveAndMinimum, type ArtifactRow } from "../src/manifest"

type Env = Parameters<typeof worker.fetch>[1]

const migrations = path.join(import.meta.dir, "../migrations")

// Advance the fake clock by an hour per harness so the module-level 60s isolate cache never leaks across tests or reruns.
let clock = Date.now()

function advanceClock(ms = 3_600_000) {
  clock = Math.max(clock, Date.now()) + ms
  setSystemTime(new Date(clock))
}

afterAll(() => setSystemTime())

function memoryKv(options?: {
  initial?: Map<string, string>
  onPut?: (key: string, value: string) => Promise<void> | void
}) {
  const store = new Map<string, string>(options?.initial)
  const reads: string[] = []
  const writes: string[] = []
  let failGet: Error | undefined
  let failPutKey: string | undefined

  const kv = {
    get: async (key: string, opts?: string | { type?: string; cacheTtl?: number }) => {
      reads.push(key)
      if (failGet) throw failGet
      const raw = store.get(key)
      if (raw === undefined) return null
      const type = typeof opts === "string" ? opts : opts?.type
      return type === "json" ? JSON.parse(raw) : raw
    },
    put: async (key: string, value: string) => {
      writes.push(key)
      if (failPutKey && (failPutKey === "*" || failPutKey === key)) {
        throw new Error(`KV put failed for ${key}`)
      }
      if (options?.onPut) await options.onPut(key, value)
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

  const execStatement = (sql: string, values: unknown[]) => {
    if (/^\s*SELECT\b/i.test(sql)) {
      return { success: true, results: sqlite.query(sql).all(...(values as never[])) }
    }
    sqlite.query(sql).run(...(values as never[]))
    return { success: true, results: [] }
  }

  const DB = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        sql,
        values,
        first: async () => sqlite.query(sql).get(...(values as never[])) ?? null,
        all: async () => ({ results: sqlite.query(sql).all(...(values as never[])) }),
        run: async () => execStatement(sql, values),
      }),
    }),
    batch: async (statements: Array<{ sql: string; values: unknown[] }>) => {
      sqlite.exec("BEGIN")
      try {
        const results = statements.map((statement) => execStatement(statement.sql, statement.values))
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
    metadata?: unknown
    raw?: string
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
        input.raw ?? JSON.stringify(input.metadata ?? {}),
        input.active ? 1 : 0,
        input.minimum ? 1 : 0,
        input.time,
        input.updated ?? input.time,
      )

  const activeAndMinimumRows = () => sqlite.query(selectActiveAndMinimum).all() as ArtifactRow[]

  return { sqlite, DB, insert, activeAndMinimumRows }
}

// KV lookup tests pass a DB that throws on any call to prove GET/HEAD never touch D1 in "kv" mode.
function unusedDb() {
  return {
    prepare: () => {
      throw new Error("KV lookup path must not touch D1")
    },
    batch: () => {
      throw new Error("KV lookup path must not touch D1")
    },
  } as unknown as D1Database
}

function harness(options?: {
  db?: D1Database
  reads?: "d1" | "kv"
  onPut?: (key: string, value: string) => Promise<void> | void
}) {
  advanceClock()
  const kv = memoryKv({ onPut: options?.onPut })
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
    MANIFEST_READS: options?.reads ?? "kv",
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

async function snapshot(res: Response) {
  return {
    status: res.status,
    headers: [...res.headers.entries()].sort().map((header) => header.join(": ")),
    body: Buffer.from(await res.arrayBuffer()).toString("utf8"),
  }
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

test("publish writes D1, distribution manifest, and channel index (manifest before index), skipping unchanged index writes", async () => {
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

  // Publishing a new version of an already-indexed distribution does NOT rewrite index:<channel>.
  h.kv.writes.length = 0
  await applyPublish(
    h.env,
    {
      channel: "latest",
      name: "cli",
      distribution: "npm",
      version: "2.0.1",
      metadata: { package: "@opencode/cli" },
    },
    publishClaims(),
  )
  expect(h.kv.writes).toEqual([mKey])

  // Publishing a new distribution updates the sorted channel index.
  h.kv.writes.length = 0
  await applyPublish(
    h.env,
    {
      channel: "latest",
      name: "cli",
      distribution: "aur",
      version: "2.0.1",
      metadata: { package: "opencode" },
    },
    publishClaims(),
  )
  expect(h.kv.writes).toEqual([manifestKey("latest", "cli", "aur"), iKey])
  expect(JSON.parse(h.kv.store.get(iKey) ?? "{}")).toEqual({
    entries: [
      { name: "cli", distribution: "aur" },
      { name: "cli", distribution: "npm" },
    ],
  })

  // Lookup in kv mode serves the published artifact without touching D1.
  const readEnv = { ...h.env, DB: unusedDb() }
  expect(await version(await lookup(readEnv, "latest/cli/npm"))).toBe("2.0.1")
})

test("concurrent publishes of two new distributions do not lose an index entry", async () => {
  const db = sqliteDb()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const h = harness({
    db: db.DB,
    onPut: async (key) => {
      // Publish A stalls on its manifest write while publish B runs to completion.
      if (key === manifestKey("latest", "cli", "npm")) await gate
    },
  })

  const a = applyPublish(
    h.env,
    { channel: "latest", name: "cli", distribution: "npm", version: "2.0.0", metadata: {} },
    publishClaims(),
  )
  await Promise.resolve()
  const b = await applyPublish(
    h.env,
    { channel: "latest", name: "desktop", distribution: "opencode", version: "2.0.0", metadata: {} },
    publishClaims(),
  )
  expect(b.status).toBe(200)
  release()
  expect((await a).status).toBe(200)

  expect(JSON.parse(h.kv.store.get(indexKey("latest")) ?? "{}")).toEqual({
    entries: [
      { name: "cli", distribution: "npm" },
      { name: "desktop", distribution: "opencode" },
    ],
  })
  const readEnv = { ...h.env, DB: unusedDb() }
  expect((await lookup(readEnv, "latest/desktop")).status).toBe(200)
  const channelBody = (await (await lookup(readEnv, "latest")).json()) as {
    artifacts: Array<{ name: string; distribution: string }>
  }
  expect(channelBody.artifacts.map((artifact) => `${artifact.name}/${artifact.distribution}`)).toEqual([
    "cli/npm",
    "desktop/opencode",
  ])
})

test("back-to-back publishes on one channel stay under KV 1 write/sec/key limit once indexed", async () => {
  const db = sqliteDb()
  const lastWrite = new Map<string, number>()
  const h = harness({
    db: db.DB,
    onPut: (key) => {
      const now = Date.now()
      if (now - (lastWrite.get(key) ?? 0) < 1_000) throw new Error(`KV PUT failed: 429 Too Many Requests (${key})`)
      lastWrite.set(key, now)
    },
  })

  // Seed existing distributions (as after initial backfill).
  const dists = [
    ["cli", "npm"],
    ["cli", "opencode"],
    ["cli-node", "npm"],
    ["cli-node", "opencode"],
  ] as const
  for (const [name, distribution] of dists) {
    db.insert({ channel: "dev", name, distribution, version: "0.0.0-dev-1", time: 1, active: true })
  }
  for (const entry of buildManifestEntries(db.activeAndMinimumRows())) {
    h.kv.store.set(entry.key, entry.value)
  }
  h.kv.writes.length = 0

  // Publish all 4 distributions 400ms apart (matching publish-cli.sh): no index writes, zero 429s.
  const devClaims = publishClaims("refs/heads/dev", "push")
  for (const [name, distribution] of dists) {
    const res = await applyPublish(
      h.env,
      { channel: "dev", name, distribution, version: "0.0.0-dev-2", metadata: {} },
      devClaims,
    )
    expect(res.status).toBe(200)
    advanceClock(400)
  }
  expect(h.kv.writes).not.toContain(indexKey("dev"))
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

test("publish fails loudly on KV write error and heals via retry or backfill", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB })
  const log = spyOn(console, "error").mockImplementation(() => {})
  try {
    await applyPublish(
      h.env,
      { channel: "latest", name: "cli", distribution: "npm", version: "1.0.0", metadata: { package: "@opencode/cli" } },
      publishClaims(),
    )

    h.kv.setFailPut("*")
    const failed = await applyPublish(
      h.env,
      { channel: "latest", name: "cli", distribution: "npm", version: "2.0.0", metadata: { package: "@opencode/cli" } },
      publishClaims(),
    )
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: "Failed to publish artifact" })

    // KV still serves 1.0.0 until healed by retry or backfill.
    expect(await version(await lookup({ ...h.env, DB: unusedDb() }, "latest/cli/npm"))).toBe("1.0.0")

    // Backfill heals KV from D1.
    h.kv.setFailPut(undefined)
    for (const entry of buildManifestEntries(db.activeAndMinimumRows())) {
      await h.kv.kv.put(entry.key, entry.value)
    }
    advanceClock()
    expect(await version(await lookup({ ...h.env, DB: unusedDb() }, "latest/cli/npm"))).toBe("2.0.0")

    // Retry also heals cleanly.
    h.kv.setFailPut(manifestKey("latest", "cli", "npm"))
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
          },
          publishClaims(),
        )
      ).status,
    ).toBe(500)
    h.kv.setFailPut(undefined)
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
          },
          publishClaims(),
        )
      ).status,
    ).toBe(200)
    expect(await version(await lookup({ ...h.env, DB: unusedDb() }, "latest/cli/npm"))).toBe("2.1.0")
  } finally {
    log.mockRestore()
  }
})

test("KV written by publish sequence equals buildManifestEntries over the same D1", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB })
  const desktop = (v: string) => ({
    files: { "app.exe": { url: `https://opencode.ai/files/bin/${v}/app.exe` } },
    manifests: { "desktop.yml": { path: "app.exe" }, "desktop-mac.yml": { path: "a.zip" } },
  })
  const pub = async (input: Record<string, unknown>, claims = publishClaims()) => {
    advanceClock(1_000)
    expect((await applyPublish(h.env, input, claims)).status).toBe(200)
  }

  await pub({
    channel: "latest",
    name: "cli",
    distribution: "npm",
    version: "1.0.0",
    metadata: { package: "@opencode-ai/cli" },
    minimum: true,
  })
  await pub({
    channel: "latest",
    name: "cli",
    distribution: "npm",
    version: "1.5.0",
    metadata: { package: "@opencode/cli" },
  })
  await pub({
    channel: "latest",
    name: "cli",
    distribution: "npm",
    version: "2.0.0",
    metadata: '{"package":"@opencode/cli"}',
  })
  await pub({
    channel: "latest",
    name: "cli",
    distribution: "opencode",
    version: "2.0.0",
    metadata: { files: { "app.exe": { url: "https://o/c" } } },
    minimum: true,
  })
  await pub({ channel: "latest", name: "cli", distribution: "aur", version: "1.0.0", metadata: {}, minimum: true })
  await pub({ channel: "latest", name: "cli", distribution: "aur", version: "2.0.0", metadata: {}, minimum: false })
  await pub({
    channel: "latest",
    name: "desktop",
    distribution: "opencode",
    version: "1.0.0",
    metadata: desktop("1.0.0"),
    minimum: true,
  })
  await pub({
    channel: "latest",
    name: "desktop",
    distribution: "opencode",
    version: "2.0.0",
    metadata: desktop("2.0.0"),
  })
  // Rollback (republish older version) preserves original time_created and updates active.
  await pub({
    channel: "latest",
    name: "desktop",
    distribution: "github",
    version: "2.0.0",
    metadata: desktop("2.0.0"),
  })
  await pub({
    channel: "latest",
    name: "desktop",
    distribution: "github",
    version: "1.0.0",
    metadata: desktop("1.0.0"),
  })
  await pub(
    { channel: "beta", name: "cli", distribution: "npm", version: "0.0.0-beta-7", metadata: {} },
    publishClaims("refs/heads/beta", "push"),
  )
  await pub(
    { channel: "dev", name: "cli", distribution: "opencode", version: "0.0.0-dev-7", metadata: {}, minimum: false },
    publishClaims("refs/heads/dev", "push"),
  )

  const rebuilt = new Map(buildManifestEntries(db.activeAndMinimumRows()).map((entry) => [entry.key, entry.value]))
  expect(Object.fromEntries(h.kv.store)).toEqual(Object.fromEntries(rebuilt))
})

test("differential parity: MANIFEST_READS=d1 and MANIFEST_READS=kv return byte-for-byte identical responses across edge-case matrix", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB })
  const t = 1_700_000_000_000
  const desktopMeta = (v: string) => ({
    files: {
      "app.exe": { url: `https://opencode.ai/files/bin/${v}/app.exe`, sha256: "x", size: 1 },
      nourl: { size: 1 },
      arr: [1],
      str: "s",
    },
    manifests: {
      "desktop.yml": {
        version: "0",
        path: "app.exe",
        files: [{ url: `https://x/${v}`, sha512: "abc==", size: 12 }],
        releaseDate: "2026-01-01T00:00:00.000Z",
      },
      "desktop-mac.yml": { path: "a.zip", "1": "int-key", b: null },
      "desktop-linux.yml": "notrecord",
    },
  })

  // Seed tricky edge cases across channels, distributions, metadata encodings, and minimum combinations.
  db.insert({
    channel: "latest",
    version: "1.0.0",
    time: t + 100,
    updated: t + 110,
    minimum: true,
    metadata: { files: { "app.exe": { url: "https://o/1.0.0" } } },
  })
  db.insert({ channel: "latest", version: "1.5.0", time: t + 200 })
  db.insert({
    channel: "latest",
    version: "2.0.0",
    time: t + 300,
    updated: t + 310,
    active: true,
    metadata: { files: { "app.exe": { url: "https://o/2.0.0" } } },
  })
  db.insert({
    channel: "latest",
    distribution: "npm",
    version: "2.0.0",
    time: t + 300,
    active: true,
    metadata: { package: "@opencode/cli" },
  })
  db.insert({ channel: "latest", distribution: "aur", version: "2.0.0", time: t + 300, active: true, minimum: true })
  db.insert({ channel: "latest", distribution: "brew", version: "1.0.0", time: t + 300, minimum: true })
  db.insert({ channel: "latest", distribution: "bad", version: "nightly", time: t + 1, minimum: true })
  db.insert({ channel: "latest", distribution: "bad", version: "2.0.0", time: t + 2, active: true })
  db.insert({
    channel: "latest",
    distribution: "rawmeta",
    version: "2.0.0",
    time: t + 2,
    active: true,
    raw: "{not json",
  })
  db.insert({ channel: "latest", distribution: "arrmeta", version: "2.0.0", time: t + 2, active: true, raw: "[1,2]" })
  db.insert({ channel: "latest", distribution: "nullmeta", version: "2.0.0", time: t + 2, active: true, raw: "null" })
  db.insert({
    channel: "latest",
    name: "desktop",
    version: "1.0.0",
    time: t + 100,
    minimum: true,
    metadata: desktopMeta("1.0.0"),
  })
  db.insert({
    channel: "latest",
    name: "desktop",
    version: "2.0.0",
    time: t + 300,
    active: true,
    metadata: desktopMeta("2.0.0"),
  })
  db.insert({
    channel: "latest",
    name: "Zeta",
    distribution: "A",
    version: "2.0.0",
    time: t + 300,
    active: true,
    metadata: { ...desktopMeta("2.0.0"), files: { "latest.yml": { url: "https://o/yml" } } },
  })
  db.insert({ channel: "latest", name: "_a", distribution: "-a", version: "2.0.0", time: t + 300, active: true })
  db.insert({
    channel: "beta",
    distribution: "npm",
    version: "0.0.0-beta-200",
    time: t + 400,
    active: true,
    metadata: { package: "@opencode/cli" },
  })
  db.insert({
    channel: "beta",
    distribution: "opencode",
    version: "0.0.0-beta-200",
    time: t + 400,
    active: true,
    minimum: true,
  })
  db.insert({ channel: "next", distribution: "npm", version: "0.0.0-next-9", time: t + 400, active: true })
  db.insert({ channel: "dev", version: "0.0.0-dev-20000", time: t + 1, minimum: true })
  db.insert({ channel: "dev", version: "0.0.0-dev-18952", time: t + 2, active: true })
  db.insert({ channel: "onlymin", version: "1.0.0", time: t + 1, minimum: true })

  for (const entry of buildManifestEntries(db.activeAndMinimumRows())) {
    await h.kv.kv.put(entry.key, entry.value)
  }

  const d1Env = { ...h.env, DB: db.DB, MANIFEST_READS: "d1" as const }
  const kvEnv = { ...h.env, DB: unusedDb(), MANIFEST_READS: "kv" as const }

  const paths = [
    "latest",
    "beta",
    "next",
    "dev",
    "onlymin",
    "missing",
    "latest/cli",
    "latest/desktop",
    "latest/Zeta",
    "latest/nope",
    "latest/cli/opencode",
    "latest/cli/npm",
    "latest/cli/aur",
    "latest/cli/brew",
    "latest/cli/bad",
    "latest/cli/rawmeta",
    "latest/cli/arrmeta",
    "latest/cli/nullmeta",
    "latest/desktop/opencode",
    "latest/desktop/opencode/latest.yml",
    "latest/desktop/opencode/latest-mac.yml",
    "latest/desktop/opencode/latest-linux.yml",
    "latest/desktop/opencode/latest-linux-arm64.yml",
    "latest/desktop/opencode/app.exe",
    "latest/desktop/opencode/missing.dmg",
    "latest/desktop/opencode/__proto__",
    "latest/desktop/opencode/constructor",
    "latest/desktop/opencode/nourl",
    "latest/desktop/opencode/arr",
    "latest/Zeta/A/latest.yml",
    "next/cli/npm",
    "dev/cli/opencode",
  ]
  const queries = [
    undefined,
    "",
    "0.9.0",
    "1.0.0",
    "v1.0.0",
    "1.0.0-rc.1",
    "2.0.0",
    "garbage",
    "0.0.0-dev-100",
    "0.0.0-beta-100",
    "0.0.0-next-100",
  ]
  const agents = [
    undefined,
    "opencode/latest/0.9.0/cli",
    "opencode/latest/junk/cli",
    "opencode/dev/0.0.0-dev-1/cli",
    "opencode/next/0.0.0-next-5/cli",
    "opencode/0.9.0",
    "opencode/",
    "curl/8.0",
  ]

  for (const pathname of paths) {
    for (const current of queries) {
      const url = `${pathname}${current === undefined ? "" : `?current=${encodeURIComponent(current)}`}`
      for (const agent of agents) {
        const headers = agent ? { "User-Agent": agent } : undefined
        const [d1, kv] = await Promise.all([
          lookup(d1Env, url, headers, "GET").then(snapshot),
          lookup(kvEnv, url, headers, "GET").then(snapshot),
        ])
        expect(kv).toEqual(d1)
      }
    }
    const [d1Head, kvHead] = await Promise.all([
      lookup(d1Env, pathname, undefined, "HEAD").then(snapshot),
      lookup(kvEnv, pathname, undefined, "HEAD").then(snapshot),
    ])
    expect(kvHead).toEqual(d1Head)
  }
})

test("two-deploy rollout: MANIFEST_READS=d1 serves from D1 while dual-writing KV", async () => {
  const db = sqliteDb()
  const h = harness({ db: db.DB, reads: "d1" })

  // Publish writes both D1 and KV.
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

  // Reads in "d1" mode do not read KV.
  h.kv.reads.length = 0
  expect(await version(await lookup(h.env, "latest/cli/npm"))).toBe("2.0.0")
  expect(h.kv.reads).toHaveLength(0)

  // Flipping to "kv" mode serves the same version from KV without touching D1.
  expect(await version(await lookup({ ...h.env, DB: unusedDb(), MANIFEST_READS: "kv" }, "latest/cli/npm"))).toBe(
    "2.0.0",
  )
})

test("reuses KV reads across lookups for 1 minute", async () => {
  const h = harness()
  const ch = `reuse-${crypto.randomUUID().slice(0, 8)}`
  const key = manifestKey(ch, "cli", "opencode")
  await h.kv.kv.put(
    key,
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  expect(await version(await lookup(h.env, `${ch}/cli/opencode`))).toBe("1.0.0")
  expect(await version(await lookup(h.env, `${ch}/cli/opencode`))).toBe("1.0.0")
  expect(h.kv.reads).toHaveLength(1)

  await h.kv.kv.put(
    key,
    JSON.stringify({ active: { version: "1.0.1", metadata: {}, time_created: 2, time_updated: 2 } }),
  )
  setSystemTime(new Date(clock + 59_000))
  expect(await version(await lookup(h.env, `${ch}/cli/opencode`))).toBe("1.0.0")
  expect(h.kv.reads).toHaveLength(1)

  setSystemTime(new Date(clock + 61_000))
  expect(await version(await lookup(h.env, `${ch}/cli/opencode`))).toBe("1.0.1")
  expect(h.kv.reads).toHaveLength(2)
})

test("does not share in-flight KV reads between concurrent lookups", async () => {
  const h = harness()
  const ch = `concurrent-${crypto.randomUUID().slice(0, 8)}`
  await h.kv.kv.put(
    manifestKey(ch, "cli", "opencode"),
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  expect(
    await Promise.all([lookup(h.env, `${ch}/cli/opencode`), lookup(h.env, `${ch}/cli/opencode`)]).then((responses) =>
      Promise.all(responses.map(version)),
    ),
  ).toEqual(["1.0.0", "1.0.0"])
  expect(h.kv.reads).toHaveLength(2)
})

test("evicts stale and cold entries without clearing hot reads", async () => {
  const h = harness()
  const run = crypto.randomUUID().slice(0, 8)
  const ch = `hot-${run}`
  await h.kv.kv.put(
    manifestKey(ch, "cli", "opencode"),
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  expect(await version(await lookup(h.env, `${ch}/cli/opencode`))).toBe("1.0.0")
  expect(h.kv.reads).toHaveLength(1)

  for (let i = 0; i < 1_100; i++) {
    expect((await lookup(h.env, `cold-${run}-${i}/cli/opencode`)).status).toBe(404)
    expect(await version(await lookup(h.env, `${ch}/cli/opencode`))).toBe("1.0.0")
  }
  expect(h.kv.reads).toHaveLength(1_101)
})

test("returns a retryable 503 when KV fails and retries on the next lookup", async () => {
  const h = harness()
  const ch = `retry-${crypto.randomUUID().slice(0, 8)}`
  await h.kv.kv.put(
    manifestKey(ch, "cli", "opencode"),
    JSON.stringify({ active: { version: "1.0.0", metadata: {}, time_created: 1, time_updated: 1 } }),
  )

  const log = spyOn(console, "error").mockImplementation(() => {})
  try {
    h.kv.setFailGet(new Error("KV unavailable"))
    const failed = await lookup(h.env, `${ch}/cli/opencode`)
    expect(failed.status).toBe(503)
    expect(failed.headers.get("Retry-After")).toBe("60")
    expect(failed.headers.get("Cache-Control")).toBe("no-store")
    expect(await failed.json()).toEqual({ error: "Update service temporarily unavailable" })

    h.kv.setFailGet(undefined)
    expect(await version(await lookup(h.env, `${ch}/cli/opencode`))).toBe("1.0.0")
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
