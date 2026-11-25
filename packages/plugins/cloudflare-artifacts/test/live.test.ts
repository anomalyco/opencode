import { afterAll, describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Artifact } from "@opencode/core/artifact"
import { ArtifactTable } from "@opencode/core/artifact/sql"
import { Database } from "@opencode/core/database/database"
import { Flag } from "@opencode/core/flag"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import type { ArtifactProviderDefinition } from "@opencode/plugin/promise/artifact"
import { ArtifactConformance } from "../../../core/test/lib/artifact-conformance"
import { testEffect } from "../../../core/test/lib/effect"
import { PluginTestLayer } from "../../../core/test/plugin/fixture"
import { provider, type Receipt } from "../index"

// Publishes to a real account: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, every resource named with PREFIX and
// deleted afterwards. Run with "bun run test:live".
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? ""
const token = process.env.CLOUDFLARE_API_TOKEN ?? ""
const PREFIX = "opencode-artifacts-test"
const it = testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, "artifacts"))))
const cloudflare = Artifact.ProviderID.make("cloudflare")

const api = async <T>(method: string, path: string, body?: unknown) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body instanceof FormData ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
  })
  const parsed = (await response.json().catch(() => ({}))) as { result: T; errors?: unknown }
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(parsed.errors)}`)
  return parsed.result
}

/** Polls a live URL until it shows what the last publish should serve, since a deploy takes moments to arrive. */
const tracked = (base: ArtifactProviderDefinition) => {
  const generation = new Map<string, number>()
  const seen = new Map<string, { generation: number; bytes?: Uint8Array }>()
  const bump = (id: string, value: number) => generation.set(id, value)
  const definition: ArtifactProviderDefinition = {
    ...base,
    create: (input, context) => base.create(input, context).finally(() => bump(input.id, 1)),
    update: (id, input, context) =>
      base.update(id, input, context).finally(() => bump(id, (generation.get(id) ?? 0) + 1)),
    delete: (id, receipt, context) => base.delete(id, receipt, context).then(() => void bump(id, -1)),
  }
  const read = async (url: URL) => {
    const response = await fetch(url, { redirect: "follow" }).catch(() => undefined)
    return response?.ok ? new Uint8Array(await response.arrayBuffer()) : undefined
  }
  const fetchLive = async (info: Artifact.Info, path: string) => {
    const url = new URL(path, new URL("/", info.url))
    const key = `${info.id} ${path}`
    const current = generation.get(info.id) ?? 0
    const before = seen.get(key)
    const done = (bytes: Uint8Array | undefined) =>
      current === -1
        ? bytes === undefined
        : before && before.generation !== current
          ? bytes !== undefined && Buffer.compare(bytes, before.bytes ?? new Uint8Array()) !== 0
          : bytes !== undefined
    for (let attempt = 0; ; attempt++) {
      const bytes = await read(url)
      if (done(bytes) || attempt === 45) {
        seen.set(key, { generation: current, bytes })
        return bytes
      }
      await Bun.sleep(2000)
    }
  }
  return { definition, fetchLive }
}

let calls = 0
const subject = tracked(
  provider({
    accountId: account,
    apiToken: token,
    prefix: PREFIX,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      calls++
      return fetch(input, init)
    }) as typeof fetch,
  }),
)

const start = Effect.fnUntraced(function* () {
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* PluginPromise.fromPromise({
    id: "cloudflare-live",
    async setup(ctx) {
      await ctx.experimental.artifact.transform((editor) => editor.add(subject.definition))
    },
  }).effect(host)
})

const receipt = (id: Artifact.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const row = yield* database.db.select().from(ArtifactTable).where(eq(ArtifactTable.id, id)).get()
    return row?.receipt as unknown as Receipt
  })

const json = (info: Artifact.Info, path: string, until: (body: Record<string, unknown>) => boolean) =>
  Effect.promise(async () => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(new URL(path, info.url)).catch(() => undefined)
      const body = (response?.headers.get("content-type")?.includes("json") ? await response.json() : {}) as Record<
        string,
        unknown
      >
      if (until(body) || attempt === 45) return body
      await Bun.sleep(2000)
    }
  })

// Reads every binding and, from the cron path, writes a row: what the runtime gives a server, end to end.
const runtime = `export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/tasks/tick") {
      await env.DB.prepare("INSERT INTO tick (at) VALUES (?)").bind(Date.now()).run()
      return new Response("ticked")
    }
    await env.CACHE.put("probe", "kv")
    await env.PUBLISHED_DOCUMENTS.put("probe.txt", "r2")
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    const secret = env.PROBE_SECRET ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.PROBE_SECRET)))].map((b) => b.toString(16).padStart(2, "0")).join("") : null
    return Response.json({
      version: VERSION,
      tables: tables.results.map((row) => row.name),
      kv: await env.CACHE.get("probe"),
      r2: await (await env.PUBLISHED_DOCUMENTS.get("probe.txt"))?.text(),
      secret,
    })
  },
}
`

describe.skipIf(!account || !token)("Cloudflare artifacts, live", () => {
  afterAll(() => teardown(), 300_000)

  it.live(
    "meets the pinned conformance matrix on a real account",
    () =>
      Effect.gen(function* () {
        yield* start()
        yield* ArtifactConformance.run(
          {
            provider: cloudflare,
            fetch: (info, path) => Effect.promise(() => subject.fetchLive(info, path)),
            calls: () => calls,
          },
          {
            "markdown-doc": "accept",
            "static-binary": "accept",
            "nested-entry": "accept",
            "spa-index": "accept",
            "fetch-echo": "accept",
            sqlite: "accept",
            blob: "accept",
            cron: "accept",
          },
        )
      }),
    900_000,
  )

  it.live(
    "serves D1, KV, R2, a cron path and an out-of-band secret, and keeps the data on delete",
    () =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start()
        const files = (version: number) => ({
          "artifact.json": JSON.stringify({
            server: "server.js",
            bindings: [
              { name: "DB", kind: "sqlite", migrations: ["migrations"] },
              { name: "CACHE", kind: "kv" },
              { name: "PUBLISHED_DOCUMENTS", kind: "blob" },
            ],
            crons: [{ schedule: "0 0 1 1 *", path: "/tasks/tick" }],
          }),
          "server.js": runtime.replace("VERSION", String(version)),
          "migrations/0001_tick.sql": "CREATE TABLE tick (at INTEGER NOT NULL);",
        })
        const created = yield* artifacts.create({ title: "Runtime", provider: cloudflare, files: files(1) })
        const pinned = yield* receipt(created.id)
        const probe = yield* json(created, "/", (body) => body.version === 1)
        expect(probe).toMatchObject({ version: 1, kv: "kv", r2: "r2", secret: null })
        expect(probe.tables).toContain("tick")

        // The cron path is the Worker's own: a visitor gets 404, the trigger is set, and the trigger reaches it.
        expect((yield* Effect.promise(() => fetch(new URL("/tasks/tick", created.url)))).status).toBe(404)
        expect(
          yield* Effect.promise(() =>
            api<{ schedules: { cron: string }[] }>("GET", `/workers/scripts/${pinned.script}/schedules`),
          ),
        ).toMatchObject({
          schedules: [{ cron: "0 0 1 1 *" }],
        })
        yield* Effect.promise(() => fireCron(pinned.script, "0 0 1 1 *"))
        const ticks = yield* Effect.promise(() =>
          api<{ results: { n: number }[] }[]>("POST", `/d1/database/${pinned.bindings.DB!.id}/query`, {
            sql: "SELECT count(*) AS n FROM tick",
          }),
        )
        expect(ticks[0]?.results[0]?.n).toBe(1)

        // A secret set out of band, as "wrangler secret put" does, survives the next publish.
        const secret = crypto.randomUUID()
        yield* Effect.promise(() =>
          api("PUT", `/workers/scripts/${pinned.script}/secrets`, {
            name: "PROBE_SECRET",
            text: secret,
            type: "secret_text",
          }),
        )
        yield* artifacts.update(created.id, { files: files(2) })
        const hash = new Bun.CryptoHasher("sha256").update(secret).digest("hex")
        expect(yield* json(created, "/", (body) => body.version === 2)).toMatchObject({ version: 2, secret: hash })
        expect((yield* receipt(created.id)).bindings).toEqual(pinned.bindings)

        yield* artifacts.remove(created.id)
        const scripts = yield* Effect.promise(() => api<{ id: string }[]>("GET", "/workers/scripts"))
        expect(scripts.map((item) => item.id)).not.toContain(pinned.script)
        yield* Effect.promise(() => api("GET", `/d1/database/${pinned.bindings.DB!.id}`))
        yield* Effect.promise(() => api("GET", `/storage/kv/namespaces/${pinned.bindings.CACHE!.id}`))
        yield* Effect.promise(() => api("GET", `/r2/buckets/${pinned.bindings.PUBLISHED_DOCUMENTS!.id}`))
      }),
    600_000,
  )
})

/**
 * Fires a Cron Trigger now, as the platform would, through a throwaway Worker whose service binding calls the
 * artifact's scheduled().
 */
async function fireCron(script: string, cron: string) {
  const name = `${PREFIX}-cron-${crypto.randomUUID().slice(0, 8)}`
  const key = crypto.randomUUID()
  const form = new FormData()
  form.set(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          main_module: "index.mjs",
          compatibility_date: "2026-11-01",
          bindings: [
            { type: "service", name: "APP", service: script },
            { type: "plain_text", name: "KEY", text: key },
          ],
        }),
      ],
      { type: "application/json" },
    ),
  )
  form.set(
    "index.mjs",
    new File(
      [
        `export default { async fetch(request, env) {
  if (request.headers.get("x-key") !== env.KEY) return new Response("forbidden", { status: 403 });
  const result = await env.APP.scheduled({ cron: ${JSON.stringify(cron)}, scheduledTime: Date.now() }).then((value) => ({ outcome: value?.outcome ?? "ok" }), (error) => ({ outcome: String(error) }));
  return Response.json(result);
} }`,
      ],
      "index.mjs",
      { type: "application/javascript+module" },
    ),
  )
  await api("PUT", `/workers/scripts/${name}`, form)
  await api("POST", `/workers/scripts/${name}/subdomain`, { enabled: true, previews_enabled: false })
  const subdomain = (await api<{ subdomain: string }>("GET", "/workers/subdomain")).subdomain
  // Its binding would keep the artifact's Worker from being deleted, so it goes as soon as it has fired.
  const fire = async (attempt: number): Promise<void> => {
    const response = await fetch(`https://${name}.${subdomain}.workers.dev/`, { headers: { "x-key": key } }).catch(
      () => undefined,
    )
    const body = response?.ok ? ((await response.json()) as { outcome: string }) : undefined
    if (body?.outcome === "ok") return
    if (body || attempt === 45) throw new Error(`scheduled() failed: ${body?.outcome ?? `HTTP ${response?.status}`}`)
    await Bun.sleep(2000)
    return fire(attempt + 1)
  }
  await fire(0).finally(() => api("DELETE", `/workers/scripts/${name}`))
}

/** Deletes every PREFIX Worker, database, namespace and bucket, then lists them again to show none are left. */
async function teardown() {
  const mine = (name: string) => name.startsWith(PREFIX)
  const scripts = (await api<{ id: string }[]>("GET", "/workers/scripts")).filter((item) => mine(item.id))
  // Cron probers first: their service bindings point at the artifacts' Workers.
  for (const item of scripts.toSorted((a, b) => Number(b.id.includes("-cron-")) - Number(a.id.includes("-cron-"))))
    await api("DELETE", `/workers/scripts/${item.id}?force=true`)
  for (const item of (
    await api<{ uuid: string; name: string }[]>("GET", `/d1/database?name=${PREFIX}&per_page=100`)
  ).filter((item) => mine(item.name)))
    await api("DELETE", `/d1/database/${item.uuid}`)
  for (const item of (await api<{ id: string; title: string }[]>("GET", "/storage/kv/namespaces?per_page=100")).filter(
    (item) => mine(item.title),
  ))
    await api("DELETE", `/storage/kv/namespaces/${item.id}`)
  for (const item of (
    await api<{ buckets: { name: string }[] }>("GET", `/r2/buckets?name_contains=${PREFIX}`)
  ).buckets.filter((item) => mine(item.name))) {
    await api("DELETE", `/r2/buckets/${item.name}/objects/probe.txt`).catch(() => undefined)
    await api("DELETE", `/r2/buckets/${item.name}`)
  }
  const left = [
    ...(await api<{ id: string }[]>("GET", "/workers/scripts")).map((item) => item.id),
    ...(await api<{ name: string }[]>("GET", `/d1/database?name=${PREFIX}&per_page=100`)).map((item) => item.name),
    ...(await api<{ title: string }[]>("GET", "/storage/kv/namespaces?per_page=100")).map((item) => item.title),
    ...(await api<{ buckets: { name: string }[] }>("GET", `/r2/buckets?name_contains=${PREFIX}`)).buckets.map(
      (item) => item.name,
    ),
  ].filter(mine)
  console.log(
    `teardown: ${left.length === 0 ? `no ${PREFIX}* Workers, D1, KV or R2 left` : `LEFT: ${left.join(", ")}`}`,
  )
  expect(left).toEqual([])
}
