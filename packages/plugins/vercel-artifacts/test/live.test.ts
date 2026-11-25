import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Artifact } from "@opencode/core/artifact"
import { ArtifactTable } from "@opencode/core/artifact/sql"
import { Database } from "@opencode/core/database/database"
import { Flag } from "@opencode/core/flag"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { ArtifactConformance } from "../../../core/test/lib/artifact-conformance"
import { testEffect } from "../../../core/test/lib/effect"
import { PluginTestLayer } from "../../../core/test/plugin/fixture"
import VercelArtifacts from "../index"

// Publishes to a real Vercel team and deletes what it made. Use a dedicated test team on the Pro plan: the cron fixture
// runs hourly, which Hobby refuses, and private artifacts protect every deployment.
const token = process.env.VERCEL_TOKEN
const team = process.env.VERCEL_TEAM_ID
if (!token)
  console.log(
    "Skipping the live Vercel run: set VERCEL_TOKEN (and VERCEL_TEAM_ID when the token reaches several teams) to run it.",
  )

const it = testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, "artifacts"))))
const provider = Artifact.ProviderID.make("vercel")
const timeout = 30 * 60_000

const start = Effect.fnUntraced(function* () {
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* PluginPromise.fromPromise(VercelArtifacts).effect({ ...host, options: { token, teamId: team } })
})

/** What an anonymous reader gets. Vercel Authentication answers with a redirect or 401, never the page. */
const get = (url: string) =>
  Effect.promise(async () => {
    const response = await fetch(url, { redirect: "manual" })
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) }
  })

const at = (info: Artifact.Info, filePath: string) => new URL(filePath, `https://${new URL(info.url).host}/`).href

describe.skipIf(!token)("Vercel artifacts, live", () => {
  it.live(
    "meets the pinned conformance matrix on real Vercel",
    () =>
      Effect.gen(function* () {
        yield* start()
        yield* ArtifactConformance.run(
          {
            provider,
            fetch: (info, filePath) =>
              get(at(info, filePath)).pipe(
                Effect.map((response) => (response.status === 200 ? response.bytes : undefined)),
              ),
            calls: () => 0,
          },
          {
            "markdown-doc": "accept",
            "static-binary": "accept",
            "nested-entry": "accept",
            "spa-index": "accept",
            "fetch-echo": "accept",
            sqlite: "refuse",
            blob: "accept",
            cron: "accept",
          },
        )
      }),
    timeout,
  )

  it.live(
    "gives the server its public URL and runs a cron's path only for Vercel",
    () =>
      Effect.gen(function* () {
        yield* start()
        const artifacts = yield* Artifact.Service
        const info = yield* artifacts.create({ title: "Live cron", provider, ...ArtifactConformance.fixtures.cron })
        const echo = yield* get(at(info, "deep/path?q=1&b=two"))
        expect(JSON.parse(new TextDecoder().decode(echo.bytes)).url).toBe(at(info, "deep/path?q=1&b=two"))
        expect((yield* get(at(info, "tasks/hourly"))).status).toBe(401)
        yield* artifacts.remove(info.id)
      }),
    timeout,
  )

  it.live(
    "keeps a private artifact from anonymous readers at its domain and its deployment URL",
    () =>
      Effect.gen(function* () {
        yield* start()
        const artifacts = yield* Artifact.Service
        const database = yield* Database.Service
        const marker = `private-${crypto.randomUUID()}`
        const info = yield* artifacts.create({
          title: "Live private",
          provider,
          visibility: "private",
          files: { "index.html": `<p>${marker}</p>` },
        })
        const row = yield* database.db.select().from(ArtifactTable).where(eq(ArtifactTable.id, info.id)).get()
        const deployment = yield* Effect.promise(async () => {
          const url = new URL("https://api.vercel.com/v6/deployments")
          url.searchParams.set("projectId", (row?.receipt as { projectId: string }).projectId)
          url.searchParams.set("limit", "1")
          if (team) url.searchParams.set("teamId", team)
          const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
          return ((await response.json()) as { deployments: { url: string }[] }).deployments[0]?.url
        })
        expect(deployment).toBeString()
        for (const url of [info.url, `https://${deployment}/`]) {
          const response = yield* get(url)
          expect(response.status, url).not.toBe(200)
          expect(new TextDecoder().decode(response.bytes), url).not.toContain(marker)
        }
        yield* artifacts.remove(info.id)
      }),
    timeout,
  )
})
