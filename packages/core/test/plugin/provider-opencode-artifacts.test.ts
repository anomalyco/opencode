import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Credential } from "@opencode/core/credential"
import { Flag } from "@opencode/core/flag"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { OpencodeWatches } from "@opencode/core/plugin/provider/opencode-watches"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { testEffect } from "../lib/effect"
import { makePluginTestLayer } from "./fixture"

/** Every permission check the tool makes, allowed. */
const checks = new Array<{ action: string; resources: readonly string[] }>()
const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: (input) => Effect.sync(() => void checks.push({ action: input.action, resources: input.resources })),
    assertNotDenied: () => Effect.void,
    allows: () => Effect.succeed(false),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)
const it = testEffect(
  makePluginTestLayer(permission).pipe(Layer.provide(Layer.succeed(Flag.Overrides, "console_watches"))),
)

/** Console's artifact routes, in-process: it stores blobs by digest and answers `prepare` with the ones it lacks. */
function fakeConsole() {
  const state = {
    artifacts: true,
    watches: true,
    owner: undefined as string | undefined,
    blobs: new Set<string>(),
    uploads: new Array<string>(),
    published: new Array<Record<string, unknown>>(),
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v2/config")
        return Response.json(
          {},
          {
            headers: {
              ...(state.artifacts ? { "x-opencode-artifacts": "1" } : {}),
              ...(state.watches ? { [OpencodeWatches.header]: "1" } : {}),
            },
          },
        )
      if (url.pathname === "/api/artifacts/prepare") {
        const body = (await request.json()) as { files: { sha256: string }[]; replace?: boolean }
        if (state.owner && !body.replace)
          return Response.json({ _tag: "ArtifactOwned", owner: state.owner, message: "taken" }, { status: 409 })
        return Response.json({ missing: body.files.map((file) => file.sha256).filter((sha) => !state.blobs.has(sha)) })
      }
      if (url.pathname.startsWith("/api/artifacts/blobs/")) {
        const sha256 = url.pathname.split("/").at(-1) ?? ""
        state.uploads.push(sha256)
        state.blobs.add(sha256)
        return Response.json({ sha256, bytes: (await request.arrayBuffer()).byteLength })
      }
      if (url.pathname.startsWith("/api/artifacts/") && request.method === "PUT") {
        const body = (await request.json()) as Record<string, unknown>
        state.published.push(body)
        return Response.json({
          id: "art_1",
          slug: url.pathname.split("/").at(-1),
          title: body.title,
          url: "https://opencode.ai/console/org_1/artifacts/demo",
          revision: state.published.length,
          updated: state.published.length > 1,
          expiresAt: null,
          watching: body.sessionID !== undefined,
        })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  return { server, state }
}

const withConsole = <A, E, R>(use: (console: ReturnType<typeof fakeConsole>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeConsole), use, (console) => Effect.promise(() => console.server.stop(true)))

/** Signs in to the fake Console, writes a folder to share in the Location, and starts the plugin. */
const start = Effect.fnUntraced(function* (console: ReturnType<typeof fakeConsole>) {
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: console.server.url.origin } }),
  })
  const folder = path.join((yield* Location.Service).directory, "demo")
  yield* Effect.promise(() =>
    Promise.all([
      Bun.write(path.join(folder, "index.html"), "<title>Demo</title><h1>Hi</h1>"),
      Bun.write(path.join(folder, "assets/app.js"), "console.log(1)"),
      Bun.write(path.join(folder, "prod.env"), "TOKEN=1"),
      Bun.write(path.join(folder, ".env"), "SECRET=1"),
    ]),
  )
  yield* OpencodePlugin.effect(yield* PluginHost.make(yield* Plugin.Service, "test"))
  checks.length = 0
  return folder
})

const share = Effect.gen(function* () {
  const tools = yield* Tool.Service
  return (yield* tools.list()).find((tool) => tool.options?.namespace === "artifacts" && tool.name === "share")
})

const sessionID = Session.ID.make("ses_artifacts")
const context: Tool.Context = {
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("call_1"),
  progress: () => Effect.void,
}

describe("OpencodePlugin artifacts", () => {
  it.effect("offers no share tool while the Console config doesn't advertise artifacts", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        console.state.artifacts = false
        yield* start(console)
        expect(yield* share).toBeUndefined()
      }),
    ),
  )

  it.effect("offers artifacts.share while the Console config advertises artifacts", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* start(console)
        expect((yield* share)?.options).toMatchObject({ namespace: "artifacts", codemode: true })
      }),
    ),
  )

  it.effect("publishes with the calling session, and a re-share uploads only the files Console lacks", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const folder = yield* start(console)
        const tool = yield* Effect.fromNullishOr(yield* share)
        expect(tool.description).toContain("This session wakes when someone comments.")
        const first = yield* tool.execute({ folder: "demo" }, context)
        expect(first.output).toEqual({
          url: "https://opencode.ai/console/org_1/artifacts/demo",
          slug: "demo",
          updated: false,
          revision: 1,
          expiresAt: null,
          watching: true,
        })
        expect(console.state.uploads).toHaveLength(3)
        expect(console.state.published[0]).toMatchObject({ title: "Demo", sessionID })
        expect((console.state.published[0]?.files as { path: string }[]).map((file) => file.path).toSorted()).toEqual([
          "assets/app.js",
          "index.html",
          "prod.env",
        ])
        // Each file's own read rules are checked, not only the folder's.
        expect(
          checks
            .filter((check) => check.action === "read")
            .flatMap((check) => check.resources)
            .toSorted(),
        ).toEqual(["demo", "demo/assets/app.js", "demo/index.html", "demo/prod.env"])

        yield* Effect.promise(() => Bun.write(path.join(folder, "index.html"), "<title>Demo</title><h1>Bye</h1>"))
        const second = yield* tool.execute({ folder: "demo", ttl: "7d" }, context)
        expect(second.output).toMatchObject({ updated: true, revision: 2 })
        expect(console.state.uploads).toHaveLength(4)
        expect(console.state.published[1]).toMatchObject({ ttlSeconds: 7 * 86_400, sessionID })
      }),
    ),
  )

  it.effect("without event watches, publishes without the session and promises no wake", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        console.state.watches = false
        yield* start(console)
        const tool = yield* Effect.fromNullishOr(yield* share)
        expect(tool.description).not.toContain("wakes")
        const shared = yield* tool.execute({ folder: "demo" }, context)
        expect(shared.output).toMatchObject({ watching: false })
        expect(console.state.published[0]).not.toHaveProperty("sessionID")
      }),
    ),
  )

  it.effect("names who shared the name already and says to pass replace", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        console.state.owner = "dax@example.com"
        yield* start(console)
        const tool = yield* Effect.fromNullishOr(yield* share)
        const refused = yield* tool.execute({ folder: "demo" }, context).pipe(Effect.flip)
        expect(refused.message).toBe(
          "dax@example.com already shared demo. Pick another name, or pass replace: true to share over it.",
        )
        expect(console.state.published).toEqual([])
        yield* tool.execute({ folder: "demo", replace: true }, context)
        expect(console.state.published[0]).toMatchObject({ replace: true })
      }),
    ),
  )
})
