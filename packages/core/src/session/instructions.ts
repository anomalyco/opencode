export * as SessionInstructions from "./instructions"

import { relative } from "path"
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { SessionEvent } from "./event"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"

const InjectedMetadata = Schema.Struct({
  instruction: Schema.Struct({ paths: Schema.Array(Schema.String) }),
})

export interface Interface {
  readonly load: (input: {
    readonly sessionID: SessionSchema.ID
    readonly paths: ReadonlyArray<string>
  }) => Effect.Effect<void, MessageDecodeError | FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    // Resolved once for the Location layer; the synthetic text and dedup ledger keep
    // absolute paths, but the human-facing description shows paths relative to the project
    // root so opening a subdirectory still describes paths from the project root.
    const root = FSUtil.resolve(location.project.directory)
    // Same-turn parallel reads settle concurrently, so an in-memory claim guards each
    // Session/path pair before any filesystem work. The durable history check below covers
    // paths injected in earlier turns after this Location layer was reopened.
    const injected = yield* Ref.make<Map<SessionSchema.ID, Set<string>>>(new Map())

    const load = Effect.fn("SessionInstructions.load")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly paths: ReadonlyArray<string>
    }) {
      const claimed = yield* Ref.modify(injected, (map) => {
        const existing = map.get(input.sessionID) ?? new Set<string>()
        const newlyClaimed = input.paths.filter((path) => !existing.has(path))
        if (newlyClaimed.length === 0) return [newlyClaimed, map]
        const next = new Map(map)
        next.set(input.sessionID, new Set([...existing, ...newlyClaimed]))
        return [newlyClaimed, next]
      })
      if (claimed.length === 0) return
      const alreadyInjected = yield* previouslyInjected(store, input.sessionID)
      const toInject = claimed.filter((path) => !alreadyInjected.has(path))
      if (toInject.length === 0) return
      const files = yield* Effect.forEach(
        toInject,
        (path) =>
          fs.readFileStringSafe(path).pipe(
            Effect.map((content) => (content === undefined ? undefined : { path, content })),
          ),
        { concurrency: "unbounded" },
      )
      const readable = files.filter((file): file is { path: string; content: string } => file !== undefined)
      if (readable.length === 0) return
      // Publish directly rather than through SessionV2.synthetic: a Location-scoped layer
      // cannot depend on SessionV2 (it routes through LocationServiceMap, forming a type
      // cycle with this node). The durable publish is what makes the synthetic visible on
      // the next projected history reload. The dedup ledger lives on the synthetic message
      // metadata so it survives across Location layer restarts.
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: input.sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        text: readable.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n"),
        description: `Loaded ${readable.map((file) => describePath(root, file.path)).join(", ")}`,
        metadata: { instruction: { paths: readable.map((file) => file.path) } },
      })
    })

    return Service.of({ load })
  }),
)

function previouslyInjected(store: SessionStore.Interface, sessionID: SessionSchema.ID) {
  return Effect.gen(function* () {
    const history = yield* store.context(sessionID)
    return new Set(
      history
        .filter((message): message is SessionMessage.Synthetic => message.type === "synthetic")
        .flatMap(
          (message) =>
            Option.getOrUndefined(Schema.decodeUnknownOption(InjectedMetadata)(message.metadata))?.instruction.paths ??
            [],
        ),
    )
  })
}

// Paths are normally discovered under the project root, so the description shows them
// relative to it. A directly-loaded path outside the root falls back to its absolute form
// rather than emitting `../..` chains.
function describePath(root: string, path: string) {
  return FSUtil.contains(root, path) ? relative(root, path) : path
}

export const node = makeLocationNode({
  name: "session-instructions",
  layer,
  deps: [EventV2.node, FSUtil.node, Location.node, SessionStore.node],
})
