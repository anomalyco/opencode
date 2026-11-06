import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Session } from "@opencode/core/session"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTunnel } from "@opencode/core/session/tunnel"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Deferred, Effect, Layer } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

it.live("refuses agent tunnel reads while the agent_tunnel flag is disabled", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-agent-tunnel-off-")).path
    const global = path.join(dir, "global")
    yield* Effect.promise(() => fs.mkdir(global, { recursive: true }))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: false, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = client(handler)

    yield* Effect.promise(async () => {
      await expect(api.experimental.agentTunnel.list({ sessionID: Session.ID.create() })).rejects.toMatchObject({
        _tag: "ServiceUnavailableError",
      })
      const iterator = api.experimental.agentTunnel.log({ sessionID: Session.ID.create() })[Symbol.asyncIterator]()
      await expect(iterator.next()).rejects.toMatchObject({ _tag: "ServiceUnavailableError" })
    })
  }),
)

it.live("lists and follows agent tunnel messages for a session family while enabled", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-agent-tunnel-api-")).path
    const global = path.join(dir, "global")
    const project = path.join(dir, "project")
    yield* Effect.promise(() => Promise.all([global, project].map((item) => fs.mkdir(item, { recursive: true }))))

    const captured = yield* Deferred.make<SessionTunnel.Interface>()
    const tunnelNode = makeGlobalNode({
      service: SessionTunnel.Service,
      layer: Layer.effect(
        SessionTunnel.Service,
        SessionTunnel.make.pipe(Effect.tap((service) => Deferred.succeed(captured, service))),
      ),
      deps: [Session.node, SessionStore.node, Database.node, Bus.node],
    })
    const handler = yield* ServerFetch.make(
      {
        // The local channel keeps the agent_tunnel flag on by default, as in a dev build.
        app: { version: "test", channel: "local" },
        database: { path: path.join(dir, "opencode.db") },
        config: { directory: global, project: false, claude: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      },
      { overrides: [SessionTunnel.node.replace(tunnelNode)] },
    )
    const tunnel = yield* Deferred.await(captured)
    const api = client(handler)

    yield* Effect.promise(async () => {
      await expect(api.experimental.agentTunnel.list({ sessionID: Session.ID.create() })).rejects.toMatchObject({
        _tag: "SessionNotFoundError",
      })
    })

    const root = yield* Effect.promise(() => api.session.create({ location: { directory: project } }))
    const child = yield* Effect.promise(() => api.session.create({ parentID: root.id }))
    const rootID = Session.ID.make(root.id)
    const childID = Session.ID.make(child.id)
    const fromChild = { sessionID: childID }

    // A send to an idle recipient predicts its own durable sequence, but the stored row carries the
    // assigned one, so the row is what reads serve and what the assertions treat as authoritative.
    const first = yield* tunnel.send({ from: childID, to: rootID, kind: "report", body: "first report" })
    const listed = yield* Effect.promise(() => api.experimental.agentTunnel.list({ sessionID: root.id }))
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: first.id, body: "first report", kind: "report", from: fromChild })
    expect(
      yield* Effect.promise(() => api.experimental.agentTunnel.list({ sessionID: root.id, after: listed[0].sequence })),
    ).toEqual([])

    // Without follow, the log replays the family and closes after the synced marker.
    yield* Effect.promise(async () => {
      const replayed: unknown[] = []
      for await (const item of api.experimental.agentTunnel.log({ sessionID: root.id })) replayed.push(item)
      expect(replayed).toEqual([listed[0], { type: "agent-tunnel.synced", sessionID: root.id }])
    })

    const second = yield* tunnel.send({ from: childID, to: rootID, kind: "message", body: "second message" })
    // The after cursor keeps earlier messages out of both the list and the log replay.
    const afterFirst = yield* Effect.promise(() =>
      api.experimental.agentTunnel.list({ sessionID: root.id, after: listed[0].sequence }),
    )
    expect(afterFirst.map((message) => message.id)).toEqual([second.id])

    const iterator = api.experimental.agentTunnel.log({ sessionID: root.id, after: listed[0].sequence, follow: true })[
      Symbol.asyncIterator
    ]()
    yield* Effect.promise(async () => {
      expect(await iterator.next()).toMatchObject({ done: false, value: afterFirst[0] })
      expect(await iterator.next()).toEqual({
        done: false,
        value: { type: "agent-tunnel.synced", sessionID: root.id },
      })
    })
    // Past the marker the subscription is live: a send made now streams through.
    const live = yield* tunnel.send({ from: rootID, to: childID, kind: "message", body: "live message" })
    yield* Effect.promise(async () => {
      expect(await iterator.next()).toMatchObject({ done: false, value: { id: live.id, body: "live message" } })
      // Releasing the generator cancels the response stream instead of leaking it.
      await iterator.return?.()
    })
  }),
)
