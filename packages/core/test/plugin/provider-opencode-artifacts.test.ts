import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Artifact } from "@opencode/core/artifact"
import { Credential } from "@opencode/core/credential"
import { Flag } from "@opencode/core/flag"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { OpencodeArtifacts } from "@opencode/core/plugin/provider/opencode-artifacts"
import { OpencodeWatches } from "@opencode/core/plugin/provider/opencode-watches"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, "artifacts,console_watches"))))

/** Console's artifact routes, in-process: it stores blobs by digest and answers `prepare` with the ones it lacks. */
function fakeConsole() {
  const state = {
    artifacts: true,
    watches: true,
    blobs: new Set<string>(),
    uploads: new Array<string>(),
    prepared: new Array<Record<string, unknown>>(),
    published: new Array<{ slug: string; body: Record<string, unknown> }>(),
    deleted: new Array<string>(),
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
        state.uploads.push(slug)
        state.blobs.add(slug)
        return Response.json({ sha256: slug, bytes: (await request.arrayBuffer()).byteLength })
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
const start = Effect.fnUntraced(function* (console: ReturnType<typeof fakeConsole>) {
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: console.server.url.origin } }),
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
          })
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
})
