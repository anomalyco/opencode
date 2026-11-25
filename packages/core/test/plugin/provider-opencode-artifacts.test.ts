import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { eq } from "drizzle-orm"
import { Artifact } from "@opencode/core/artifact"
import { ArtifactTable } from "@opencode/core/artifact/sql"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { Flag } from "@opencode/core/flag"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { OpencodeArtifacts } from "@opencode/core/plugin/provider/opencode-artifacts"
import { OpencodeWatches } from "@opencode/core/plugin/provider/opencode-watches"
import { ArtifactConformance } from "../lib/artifact-conformance"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, "artifacts,console_watches"))))

/** Console's artifact routes, in-process: it stores blobs by digest and answers `prepare` with the ones it lacks. */
function fakeConsole() {
  const state = {
    artifacts: true,
    watches: true,
    blobs: new Map<string, Uint8Array>(),
    blobReads: new Array<string>(),
    uploads: new Array<string>(),
    prepared: new Array<Record<string, unknown>>(),
    published: new Array<{ slug: string; body: Record<string, unknown> }>(),
    deleted: new Array<string>(),
    gone: false,
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const slug = url.pathname.split("/").at(-1) ?? ""
      if (url.pathname === "/api/v2/config")
        return Response.json(
          {},
          {
            headers: {
              ...(state.artifacts ? { [OpencodeArtifacts.header]: "1" } : {}),
              ...(state.watches ? { [OpencodeWatches.header]: "1" } : {}),
            },
          },
        )
      if (url.pathname === "/api/artifacts/prepare") {
        const body = (await request.json()) as { files: { sha256: string }[] }
        state.prepared.push(body)
        return Response.json({ missing: body.files.map((file) => file.sha256).filter((sha) => !state.blobs.has(sha)) })
      }
      if (url.pathname.startsWith("/api/artifacts/blobs/")) {
        const bytes = new Uint8Array(await request.arrayBuffer())
        state.uploads.push(slug)
        state.blobs.set(slug, bytes)
        return Response.json({ sha256: slug, bytes: bytes.byteLength })
      }
      // Lists the last published revision, inlining only index.html so other files download as blobs.
      if (url.pathname.endsWith("/files")) {
        if (state.gone) return new Response("Not found", { status: 404 })
        const published = state.published.at(-1)?.body as { files: { path: string; sha256: string }[] }
        return Response.json({
          revision: state.published.length,
          files: published.files.map((file) => ({
            ...file,
            ...(file.path === "index.html" ? { text: new TextDecoder().decode(state.blobs.get(file.sha256)) } : {}),
          })),
        })
      }
      if (url.pathname.includes("/blobs/")) {
        state.blobReads.push(`${slug}?${url.searchParams}`)
        return new Response(state.blobs.get(slug))
      }
      if (url.pathname.startsWith("/api/artifacts/") && request.method === "PUT") {
        const body = (await request.json()) as Record<string, unknown>
        state.published.push({ slug, body })
        return Response.json({ url: `https://opencode.ai/console/org_1/artifacts/${slug}`, watching: false })
      }
      if (url.pathname.startsWith("/api/artifacts/") && request.method === "DELETE") {
        state.deleted.push(slug)
        return new Response(null, { status: 204 })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  return { server, state }
}

const withConsole = <A, E, R>(use: (console: ReturnType<typeof fakeConsole>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeConsole), use, (console) => Effect.promise(() => console.server.stop(true)))

/** Signs in to the fake Console and starts the plugin. */
const start = Effect.fnUntraced(function* (
  console: ReturnType<typeof fakeConsole>,
  metadata: Record<string, unknown> = { orgID: "org_1" },
) {
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({
      type: "key",
      key: "secret",
      metadata: { server: console.server.url.origin, ...metadata },
    }),
  })
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* OpencodePlugin.effect(host)
  return host
})

const defaultProvider = Effect.gen(function* () {
  const artifacts = yield* Artifact.Service
  return (yield* artifacts.providers()).find((provider) => provider.default)?.id
})

const files = { "index.html": "<h1>Hi</h1>", "app.js": "console.log(1)" }

describe("OpencodePlugin artifacts", () => {
  it.effect("adds no Console provider while the Console config doesn't advertise artifacts", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        console.state.artifacts = false
        yield* start(console)
        expect(yield* defaultProvider).toBe(Artifact.LocalProviderID)
      }),
    ),
  )

  it.effect("makes Console the default provider while advertised, and removes it when the header goes", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(console)
        expect(yield* artifacts.providers()).toContainEqual(
          Artifact.Provider.make({
            id: Artifact.ProviderID.make("console"),
            name: "OpenCode Console",
            capabilities: ["static"],
            audiences: ["private"],
            defaultAudience: "private",
            default: true,
          }),
        )
        expect((yield* artifacts.prompts()).defaultProvider.prompt).toContain("Comments wake this session.")

        console.state.artifacts = false
        yield* TestClock.adjust("1 minute")
        const providers = yield* eventually(artifacts.providers(), (list) => list.length === 1)
        expect(providers.map((provider) => [provider.id, provider.default])).toEqual([[Artifact.LocalProviderID, true]])
      }),
    ),
  )

  it.effect(
    "publishes with the session and returns Console's URL; an update keeps the slug and uploads only new files",
    () =>
      withConsole((console) =>
        Effect.gen(function* () {
          const artifacts = yield* Artifact.Service
          const session = yield* (yield* start(console)).session.create({})
          const created = yield* artifacts.create({ title: "Q3 Report!", files, sessionID: session.id })
          const slug = console.state.published[0]?.slug ?? ""
          expect(slug).toMatch(/^q3-report-[a-z0-9]{6}$/)
          expect(created).toMatchObject({
            provider: "console",
            url: `https://opencode.ai/console/org_1/artifacts/${slug}`,
            visibility: "private",
          })
          const database = yield* Database.Service
          expect(
            (yield* database.db.select().from(ArtifactTable).where(eq(ArtifactTable.id, created.id)).get())
              ?.destination,
          ).toBe(`console:${console.server.url.host}:org_1`)
          expect(console.state.uploads).toHaveLength(2)
          expect(console.state.prepared[0]).not.toHaveProperty("replace")
          expect(console.state.published[0]).toMatchObject({
            slug,
            body: { title: "Q3 Report!", sessionID: session.id },
          })

          const updated = yield* artifacts.update(created.id, {
            title: "Q4 Report",
            files: { ...files, "index.html": "<h1>Bye</h1>" },
          })
          expect(updated.url).toBe(`https://opencode.ai/console/org_1/artifacts/${slug}`)
          expect(console.state.uploads).toHaveLength(3)
          expect(console.state.prepared[1]).toMatchObject({ slug, replace: true })
          expect(console.state.published[1]).toMatchObject({
            slug,
            body: { title: "Q4 Report", replace: true },
          })

          yield* artifacts.remove(created.id)
          expect(console.state.deleted).toEqual([slug])
        }),
      ),
  )

  it.effect("reads the files back, downloading the ones Console doesn't inline from the listed revision", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(console)
        const created = yield* artifacts.create({ title: "Report", files })
        const content = yield* artifacts.get(created.id)
        expect(content.files).toEqual(files)
        expect(console.state.blobReads).toEqual([expect.stringMatching(/^[0-9a-f]{64}\?revision=1$/)])
      }),
    ),
  )

  it.effect("says Console has no such artifact when it was deleted there", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(console)
        const created = yield* artifacts.create({ title: "Report", files })
        console.state.gone = true
        const error = yield* Effect.flip(artifacts.get(created.id))
        expect(String(error)).toContain(`OpenCode Console has no artifact named ${console.state.published[0]?.slug}`)
      }),
    ),
  )

  it.effect("gives two artifacts with one title their own Console artifacts", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(console)
        yield* artifacts.create({ title: "Report", files })
        yield* artifacts.create({ title: "Report", files })
        const slugs = console.state.published.map((item) => item.slug)
        expect(slugs[0]).toMatch(/^report-[a-z0-9]{6}$/)
        expect(new Set(slugs).size).toBe(2)
      }),
    ),
  )

  it.effect("without event watches, publishes without the session and promises no wake", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        console.state.watches = false
        const artifacts = yield* Artifact.Service
        const session = yield* (yield* start(console)).session.create({})
        expect((yield* artifacts.prompts()).defaultProvider.prompt).not.toContain("wake")
        yield* artifacts.create({ title: "Demo", files, sessionID: session.id })
        expect(console.state.published[0]?.body).not.toHaveProperty("sessionID")
      }),
    ),
  )

  it.effect("meets the Console provider's pinned conformance matrix", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* start(console)
        yield* ArtifactConformance.run(
          {
            provider: Artifact.ProviderID.make("console"),
            fetch: (info, filePath) =>
              Effect.sync(() => {
                const slug = info.url.split("/").at(-1) ?? ""
                if (console.state.deleted.includes(slug)) return undefined
                const published = console.state.published.findLast((item) => item.slug === slug)?.body as
                  | { files: { path: string; sha256: string }[] }
                  | undefined
                const file = published?.files.find((item) => item.path === filePath)
                return file && console.state.blobs.get(file.sha256)
              }),
            calls: () =>
              console.state.prepared.length +
              console.state.uploads.length +
              console.state.published.length +
              console.state.deleted.length,
          },
          ArtifactConformance.expected.console,
        )
      }),
    ),
  )

  it.effect("pins a key's fingerprint, never the key, when the sign-in names no workspace", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const database = yield* Database.Service
        yield* start(console, {})
        const created = yield* artifacts.create({ title: "Report", files })
        const row = yield* database.db.select().from(ArtifactTable).where(eq(ArtifactTable.id, created.id)).get()
        expect(row?.destination).toBe(
          `console:${console.server.url.host}:key-${createHash("sha256").update("secret").digest("hex").slice(0, 12)}`,
        )
      }),
    ),
  )

  it.effect("adopts a destination for an artifact published before pinning only once Console has it", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        const database = yield* Database.Service
        yield* start(console)
        const created = yield* artifacts.create({ title: "Report", files })
        const pin = (destination: string | null) =>
          database.db.update(ArtifactTable).set({ destination }).where(eq(ArtifactTable.id, created.id)).run()
        yield* pin(null)
        console.state.gone = true
        expect(yield* artifacts.update(created.id, { files }).pipe(Effect.flip)).toBeInstanceOf(Artifact.InvalidError)
        expect(yield* artifacts.remove(created.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.InvalidError)
        expect(console.state.deleted).toEqual([])
        expect((yield* artifacts.info(created.id)).id).toBe(created.id)

        console.state.gone = false
        yield* artifacts.update(created.id, { files })
        const row = yield* database.db.select().from(ArtifactTable).where(eq(ArtifactTable.id, created.id)).get()
        expect(row?.destination).toBe(`console:${console.server.url.host}:org_1`)
      }),
    ),
  )

  it.effect("refreshes only the public files from Console's live copy, keeping artifact.json", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const artifacts = yield* Artifact.Service
        yield* start(console)
        const created = yield* artifacts.create({
          title: "Site",
          files: { "artifact.json": JSON.stringify({ assets: "public" }), "public/index.html": "<h1>Hi</h1>" },
        })
        expect(console.state.published[0]?.body).toMatchObject({ files: [{ path: "index.html" }] })
        const content = yield* artifacts.get(created.id)
        expect(content).toMatchObject({ source: "live" })
        expect(Object.keys(content.files).toSorted()).toEqual(["artifact.json", "public/index.html"])
      }),
    ),
  )
})
