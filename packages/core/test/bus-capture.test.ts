import { describe, expect } from "bun:test"
import { Context, Effect, Fiber, Scope, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Credential } from "@opencode-ai/schema/credential"
import { Event } from "@opencode-ai/schema/event"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { IntegrationID } from "@opencode-ai/schema/integration-id"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Plugin } from "@opencode-ai/schema/plugin"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionID } from "@opencode-ai/schema/session-id"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [[Bus.node, Bus.configured({ persist: true })]]),
)
const here = Location.Ref.make({ directory: AbsolutePath.make("/capture") })
const elsewhere = Location.Ref.make({ directory: AbsolutePath.make("/elsewhere") })

describe("Bus.capture", () => {
  ;(["wildcard", "typed", "multiple"] as const).forEach((mode) => {
    it.effect(`restores private ownership for ${mode} streams in foreign and trimmed contexts`, () =>
      Effect.gen(function* () {
        const root = yield* Bus.Service
        const owner = Symbol()
        const first = Bus.capture(root, Symbol())
        const second = Bus.capture(root, owner)
        const foreign = (yield* Effect.context<Scope.Scope>()).pipe(Context.add(Bus.PrivateOwner, owner))
        const trimmed = foreign.pipe(Context.pick(Scope.Scope))
        const doneID = Event.ID.create()
        const watch = (bus: Bus.Interface, context: Context.Context<Scope.Scope>) => {
          const stream =
            mode === "wildcard"
              ? bus.subscribe()
              : mode === "typed"
                ? bus.subscribe(McpEvent.ToolsChanged)
                : bus.subscribe([McpEvent.ToolsChanged, Plugin.Event.Added])
          return stream.pipe(
            Stream.takeUntil((event) => event.id === doneID),
            Stream.runCollect,
            Effect.setContext(context),
            Effect.forkScoped({ startImmediately: true }),
          )
        }
        expect(Context.get(trimmed, Bus.PrivateOwner)).toBeUndefined()
        const inForeign = yield* watch(first, foreign)
        const inTrimmed = yield* watch(first, trimmed)
        const other = yield* watch(second, trimmed)
        const shared = yield* watch(root, trimmed)

        const one = yield* first.publish(McpEvent.ToolsChanged, { server: "foreign" }).pipe(Effect.setContext(foreign))
        const two = yield* first.publish(McpEvent.ToolsChanged, { server: "trimmed" }).pipe(Effect.setContext(trimmed))
        const added = yield* first.publish(Plugin.Event.Added, { id: Plugin.ID.make("capture-plugin") })
        const privateOther = yield* second.publish(McpEvent.ToolsChanged, { server: "other" })
        const unowned = yield* root.publish(McpEvent.ToolsChanged, { server: "shared" })
        const done = yield* root.publish(McpEvent.ToolsChanged, { server: "done" }, { id: doneID, global: true })

        const expected = mode === "typed" ? [one, two, done] : [one, two, added, done]
        expect(Array.from(yield* Fiber.join(inForeign))).toEqual(expected)
        expect(Array.from(yield* Fiber.join(inTrimmed))).toEqual(expected)
        expect(Array.from(yield* Fiber.join(other))).toEqual([privateOther, done])
        expect(Array.from(yield* Fiber.join(shared))).toEqual([unowned, done])
        expect(Object.keys(one).sort()).toEqual(["created", "data", "id", "type"])
      }),
    )
  })

  it.effect("honors explicit global audiences and leaves credential notifications shared", () =>
    Effect.gen(function* () {
      const root = yield* Bus.Service
      const first = Bus.capture(root, Symbol())
      const second = Bus.capture(root, Symbol())
      const doneID = Event.ID.create()
      const watchers = yield* Effect.forEach([first, second, root], (bus, index) =>
        bus.subscribe().pipe(
          Stream.takeUntil((event) => event.id === doneID),
          Stream.runCollect,
          Effect.provideService(Location.Service, location(index === 0 ? here : elsewhere)),
          Effect.forkScoped({ startImmediately: true }),
        ),
      )
      const broadcast = yield* first
        .publish(McpEvent.ToolsChanged, { server: "global" }, { global: true, location: here })
        .pipe(Effect.provideService(Location.Service, location(here)))
      const updated = yield* first.publish(Credential.Event.Updated, {})
      const switched = yield* second.publish(Credential.Event.Switched, {
        integrationID: IntegrationID.make("capture-integration"),
        credentialID: null,
      })
      const done = yield* root.publish(McpEvent.ToolsChanged, { server: "done" }, { id: doneID, global: true })

      expect(broadcast).not.toHaveProperty("location")
      yield* Effect.forEach(watchers, (fiber) =>
        Fiber.join(fiber).pipe(
          Effect.tap((events) =>
            Effect.sync(() => expect(Array.from(events)).toEqual([broadcast, updated, switched, done])),
          ),
        ),
      )
    }),
  )

  it.effect("keeps filesystem and VCS notifications placement-scoped rather than private", () =>
    Effect.gen(function* () {
      const root = yield* Bus.Service
      const first = Bus.capture(root, Symbol())
      const second = Bus.capture(root, Symbol())
      const doneID = Event.ID.create()
      const watch = (bus: Bus.Interface, ref: Location.Ref) =>
        bus.subscribe().pipe(
          Stream.takeUntil((event) => event.id === doneID),
          Stream.runCollect,
          Effect.provideService(Location.Service, location(ref)),
          Effect.forkScoped({ startImmediately: true }),
        )
      const local = yield* watch(first, here)
      const colocated = yield* watch(second, here)
      const remote = yield* watch(second, elsewhere)
      const shared = yield* watch(root, here)
      const changed = yield* first.publish(
        FileSystem.Event.Changed,
        { file: "/capture/file", event: "change" },
        { location: here },
      )
      const branch = yield* first.publish(VcsEvent.BranchUpdated, { branch: "capture-branch" }, { location: here })
      const privateEvent = yield* first.publish(McpEvent.ToolsChanged, { server: "private" }, { location: here })
      const wrongLocation = yield* first.publish(
        McpEvent.ToolsChanged,
        { server: "elsewhere" },
        { location: elsewhere },
      )
      const done = yield* root.publish(McpEvent.ToolsChanged, { server: "done" }, { id: doneID, global: true })

      expect(Array.from(yield* Fiber.join(local))).toEqual([changed, branch, privateEvent, done])
      expect(Array.from(yield* Fiber.join(colocated))).toEqual([changed, branch, done])
      expect(Array.from(yield* Fiber.join(remote))).toEqual([done])
      expect(Array.from(yield* Fiber.join(shared))).toEqual([changed, branch, done])
      expect(wrongLocation.location).toEqual(elsewhere)
    }),
  )

  it.effect("delegates durable authority and Session audiences to the shared root", () =>
    Effect.gen(function* () {
      const root = yield* Bus.Service
      const first = Bus.capture(root, Symbol())
      const second = Bus.capture(root, Symbol())
      ;(["publishAll", "observe", "project", "replay", "log", "claim", "remove", "listen"] as const).forEach((key) => {
        expect(first[key]).toBe(root[key])
        expect(second[key]).toBe(root[key])
      })
      const sessionID = SessionID.create()
      const observer = yield* second.observe(sessionID)
      const watchers = yield* Effect.forEach([first, second, root], (bus) =>
        bus
          .subscribe(SessionEvent.Renamed)
          .pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped({ startImmediately: true })),
      )
      const one = yield* first.publish(SessionEvent.Renamed, { sessionID, title: "first" })
      const batch = yield* second.publishAll([
        [SessionEvent.Renamed, { sessionID, title: "second" }],
        [SessionEvent.Renamed, { sessionID, title: "third" }],
      ])
      const last = yield* root.publish(SessionEvent.Renamed, { sessionID, title: "fourth" })
      const events = [one, ...batch, last]

      expect(events.map((event) => event.durable.seq)).toEqual([0, 1, 2, 3].map((seq) => Event.Seq.make(seq)))
      expect(Array.from(yield* observer.pipe(Stream.take(4), Stream.runCollect))).toEqual(events)
      yield* Effect.forEach(watchers, (fiber) =>
        Fiber.join(fiber).pipe(
          Effect.tap((received) => Effect.sync(() => expect(Array.from(received)).toEqual(events))),
        ),
      )
      expect(Array.from(yield* first.log({ aggregateID: sessionID }).pipe(Stream.runCollect))).toEqual([
        ...events,
        { type: "log.synced", aggregateID: sessionID, seq: Event.Seq.make(3) },
      ])
    }),
  )
})
