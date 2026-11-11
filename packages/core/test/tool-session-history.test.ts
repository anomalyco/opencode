import { expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity } from "./lib/tool"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, Bus.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

it.live("finds a location-scoped hit and reads its adjacent transcript pages", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const other = yield* tmpdirScoped()
    const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    yield* Effect.promise(() =>
      Bun.write(
        path.join(dir.path, "opencode.json"),
        JSON.stringify({
          experimental: { session_search: true },
          permissions: ["sessions_search", "sessions_inspect"].map((action) => ({
            action,
            resource: "*",
            effect: "allow",
          })),
        }),
      ),
    )

    const sessions = yield* Session.Service
    const caller = yield* sessions.create({ location, title: "Caller" })
    const target = yield* sessions.create({ location, title: "Release notes" })
    const foreign = yield* sessions.create({
      location: Location.Ref.make({ directory: AbsolutePath.make(other.path) }),
      title: "Other project's notes",
    })
    const bus = yield* Bus.Service
    // Deliver through the real projections without waking a model runner.
    const message = Effect.fnUntraced(function* (sessionID: Session.ID, text: string) {
      const inboxID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID,
        inboxID,
        item: { type: "user", payload: { text }, delivery: "steer" },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID })
      return inboxID
    })
    const query = "release.100%_ready"
    yield* message(target.id, "Before the checkpoint")
    const hit = yield* message(target.id, `Checkpoint: ${query}`)
    yield* message(target.id, "After the checkpoint")
    yield* message(foreign.id, query)

    const locations = yield* LocationServiceMap.Service
    yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      const registry = yield* Tool.Service
      const tools = yield* registry.snapshot()
      const call = Effect.fnUntraced(function* (name: "search" | "inspect", input: Record<string, unknown>) {
        const result = yield* tools.execute({
          ...toolIdentity,
          sessionID: caller.id,
          call: {
            type: "tool-call",
            id: `call-${name}`,
            name: "execute",
            input: {
              code: `return await tools.sessions.${name}(${JSON.stringify(input)})`,
            },
          },
        })
        const part = result.content?.[0]
        if (part?.type !== "text" || result.metadata?.error)
          throw new Error(`Failed ${name}: ${JSON.stringify(result)}`)
        return JSON.parse(part.text)
      })
      const groups = []
      let cursor: string | undefined
      do {
        const result = yield* call("search", cursor ? { cursor } : { query })
        groups.push(...result.sessions)
        cursor = result.nextCursor
      } while (cursor)
      expect(groups).toMatchObject([{ sessionID: target.id, hits: [{ messageID: hit }] }])
      expect(typeof groups[0].hits[0].cursor).toBe("string")
      const inspect = (cursor: string) => call("inspect", { sessionID: target.id, cursor, limit: 1 })
      const page = yield* inspect(groups[0].hits[0].cursor)
      expect(page).toMatchObject({
        messages: [{ id: hit, text: `Checkpoint: ${query}` }],
      })
      expect((yield* inspect(page.nextCursor)).messages).toMatchObject([{ text: "After the checkpoint" }])
      expect((yield* inspect(page.previousCursor)).messages).toMatchObject([{ text: "Before the checkpoint" }])
    }).pipe(Effect.provide(locations.get(location)))
  }),
)
