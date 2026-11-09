import { Database } from "bun:sqlite"
import { afterEach, expect, setSystemTime, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import worker, { allowedChannels, validGitHubClaims } from "../src/index"

type Env = Parameters<typeof worker.fetch>[1]

const migrations = path.join(import.meta.dir, "../migrations")

afterEach(() => setSystemTime())

// Runs the real schema and queries through bun:sqlite and records every statement sent to D1.
function database() {
  const sqlite = new Database(":memory:")
  readdirSync(migrations)
    .sort()
    .forEach((file) => sqlite.exec(readFileSync(path.join(migrations, file), "utf8")))
  const queries: string[] = []
  const DB = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          queries.push(sql)
          return sqlite.query(sql).get(...(values as never[])) ?? null
        },
        all: async () => {
          queries.push(sql)
          return { results: sqlite.query(sql).all(...(values as never[])) }
        },
      }),
    }),
  }
  const env = { DB, EVENTS: { send: () => Promise.resolve() } } as unknown as Env
  const insert = (input: { channel: string; version: string; time: number; active?: boolean; minimum?: boolean }) =>
    sqlite
      .query(
        "INSERT INTO artifact (channel, name, distribution, version, metadata, active, minimum, time_created, time_updated) VALUES (?, 'cli', 'opencode', ?, '{}', ?, ?, ?, ?)",
      )
      .run(input.channel, input.version, input.active ? 1 : 0, input.minimum ? 1 : 0, input.time, input.time)
  return { sqlite, env, queries, insert }
}

function lookup(env: Env, pathname: string, headers?: HeadersInit) {
  return worker.fetch(new Request(`https://opencode.ai/update/api/${pathname}`, { headers }), env, {
    waitUntil: () => {},
  })
}

async function version(response: Response) {
  expect(response.status).toBe(200)
  const body = (await response.json()) as { version: string }
  return body.version
}

test("returns a retryable 503 when D1 rejects a lookup", async () => {
  const overloaded = new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long.")
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: () => Promise.reject(overloaded) }) }) },
    EVENTS: { send: () => Promise.resolve() },
  } as unknown as Env
  const response = await worker.fetch(
    new Request("https://opencode.ai/update/api/latest/desktop/opencode/opencode-desktop-win-x64.exe"),
    env,
    { waitUntil: () => {} },
  )
  expect(response.status).toBe(503)
  expect(response.headers.get("Retry-After")).toBe("60")
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(await response.json()).toEqual({ error: "Update service temporarily unavailable" })
})

test("reuses D1 reads across lookups for 1 minute", async () => {
  const db = database()
  db.insert({ channel: "reuse", version: "1.0.0", time: 1, active: true })
  setSystemTime(new Date("2026-10-13T00:00:00Z"))

  expect(
    await Promise.all([lookup(db.env, "reuse/cli/opencode"), lookup(db.env, "reuse/cli/opencode")]).then((responses) =>
      Promise.all(responses.map(version)),
    ),
  ).toEqual(["1.0.0", "1.0.0"])
  expect(db.queries).toHaveLength(2)

  db.sqlite.query("UPDATE artifact SET active = 0").run()
  db.insert({ channel: "reuse", version: "1.0.1", time: 2, active: true })
  setSystemTime(new Date("2026-10-13T00:00:59Z"))
  expect(await version(await lookup(db.env, "reuse/cli/opencode"))).toBe("1.0.0")
  expect(db.queries).toHaveLength(2)

  setSystemTime(new Date("2026-10-13T00:01:01Z"))
  expect(await version(await lookup(db.env, "reuse/cli/opencode"))).toBe("1.0.1")
  expect(db.queries).toHaveLength(4)
})

test("evicts stale and cold entries without clearing hot reads", async () => {
  const db = database()
  db.insert({ channel: "hot", version: "1.0.0", time: 1, active: true })
  setSystemTime(new Date("2026-10-13T01:00:00Z"))

  expect(await version(await lookup(db.env, "hot/cli/opencode"))).toBe("1.0.0")
  expect(db.queries).toHaveLength(2)

  for (let i = 0; i < 600; i++) {
    expect((await lookup(db.env, `cold-${i}/cli/opencode`)).status).toBe(404)
    expect(await version(await lookup(db.env, "hot/cli/opencode"))).toBe("1.0.0")
  }
  expect(db.queries).toHaveLength(1202)
})

test("retries D1 on the next lookup after a failed read", async () => {
  const db = database()
  db.insert({ channel: "retry", version: "1.0.0", time: 1, active: true })
  const prepare = db.env.DB.prepare
  let fail = true
  db.env.DB.prepare = ((sql: string) =>
    fail
      ? { bind: () => ({ first: () => Promise.reject(new Error("overloaded")) }) }
      : prepare.call(db.env.DB, sql)) as typeof prepare

  expect((await lookup(db.env, "retry/cli/opencode")).status).toBe(503)
  fail = false
  expect(await version(await lookup(db.env, "retry/cli/opencode"))).toBe("1.0.0")
})

test("selects the minimum and active artifacts from the partial indexes", async () => {
  const db = database()
  db.insert({ channel: "latest", version: "1.0.0", time: 1, minimum: true })
  db.insert({ channel: "latest", version: "1.5.0", time: 2 })
  db.insert({ channel: "latest", version: "2.0.0", time: 3, active: true })

  expect(await version(await lookup(db.env, "latest/cli/opencode?current=0.9.0"))).toBe("1.0.0")
  expect(await version(await lookup(db.env, "latest/cli/opencode?current=1.0.0"))).toBe("2.0.0")
  expect(await version(await lookup(db.env, "latest/cli/opencode"))).toBe("2.0.0")

  // A release that is both active and minimum is listed once.
  db.insert({ channel: "both", version: "3.0.0", time: 1, active: true, minimum: true })
  const response = await lookup(db.env, "both")
  expect(response.status).toBe(200)
  const body = (await response.json()) as { artifacts: { version: string }[] }
  expect(body.artifacts.map((artifact) => artifact.version)).toEqual(["3.0.0"])
})

// Dev build numbers reset, so a stray dev minimum kept sending clients to a build they had already passed.
test("ignores minimum artifacts outside the latest channel", async () => {
  const db = database()
  db.insert({ channel: "dev", version: "0.0.0-dev-20000", time: 1, minimum: true })
  db.insert({ channel: "dev", version: "0.0.0-dev-18952", time: 2, active: true })

  expect(
    await version(
      await lookup(db.env, "dev/cli/opencode", { "User-Agent": "opencode/dev/0.0.0-dev-18952/cli" }),
    ),
  ).toBe("0.0.0-dev-18952")
  expect(await version(await lookup(db.env, "dev/cli/opencode?current=garbage"))).toBe("0.0.0-dev-18952")
})

test("rejects setting a minimum outside the latest channel", async () => {
  const db = database()
  const response = await worker.fetch(
    new Request("https://opencode.ai/update/admin/minimum", {
      method: "POST",
      body: new URLSearchParams({ channel: "dev", name: "cli", distribution: "opencode", version: "0.0.0-dev-18952" }),
    }),
    db.env,
    { waitUntil: () => {} },
  )
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: "Minimum is only supported on the latest channel" })
})

test("caches rollout fallback reads across caller IPs and overlapping releases", async () => {
  const db = database()
  const base = Date.parse("2026-10-13T00:00:00Z")
  db.sqlite.query("INSERT INTO channel_rollout (channel, duration_hours) VALUES ('rollout', 6)").run()
  db.insert({ channel: "rollout", version: "1.0.0", time: base })
  db.insert({ channel: "rollout", version: "1.1.0", time: base + 5 * 3_600_000 })
  db.insert({ channel: "rollout", version: "1.2.0", time: base + 7 * 3_600_000, active: true })
  setSystemTime(new Date(base + 7 * 3_600_000 + 1_000))

  // Missing IP waits for full 6h rollout -> cutoff is base + 1h + 1s, selects 1.0.0.
  expect(await version(await lookup(db.env, "rollout/cli/opencode"))).toBe("1.0.0")
  expect(db.queries).toHaveLength(3)

  // Different caller IPs evaluate different cutoffs against the cached rollout history without extra D1 reads.
  const versions = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      lookup(db.env, "rollout/cli/opencode", { "CF-Connecting-IP": `203.0.113.${i + 1}` }).then(version),
    ),
  )
  expect(new Set(versions)).toEqual(new Set(["1.0.0", "1.1.0"]))
  expect(db.queries).toHaveLength(3)
})

function publishClaims(ref: string, event_name = "push", environment = "release") {
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
