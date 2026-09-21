export * as TabStorage from "./schema"

import { Codec } from "@/runtime/persistence/codec"
import { ServerKey } from "@/runtime/server/key"

export { ServerKey }

export const Session = Codec.struct({
  type: Codec.literal("session"),
  server: ServerKey,
  sessionId: Codec.string,
  routeSessionId: Codec.lenientOptional(Codec.string),
  routeParentId: Codec.lenientOptional(Codec.string),
})

export const Draft = Codec.struct({
  type: Codec.literal("draft"),
  draftID: Codec.string,
  server: ServerKey,
  directory: Codec.string,
  worktree: Codec.lenientOptional(Codec.string),
  branch: Codec.lenientOptional(Codec.string),
  mcp: Codec.lenientOptional(Codec.struct({ target: Codec.string, states: Codec.lenientRecord(Codec.boolean) })),
})

// A stored route that only repeats the session id carries nothing; drop it and its parent.
const SessionCodec = Codec.transform(Session, {
  decode: (tab) => ({
    type: tab.type,
    server: tab.server,
    sessionId: tab.sessionId,
    ...(tab.routeSessionId && tab.routeSessionId !== tab.sessionId
      ? { routeSessionId: tab.routeSessionId, ...(tab.routeParentId ? { routeParentId: tab.routeParentId } : {}) }
      : {}),
  }),
  encode: (tab) => tab,
})

export const Tab = Codec.union([Session, Draft])
export const Tabs = Codec.lenientArray(Codec.union([SessionCodec, Draft]))
export const Recent = Codec.struct({
  key: Codec.optional(Codec.string),
})
export const Info = Codec.struct({
  title: Codec.optional(Codec.string),
  directory: Codec.optional(Codec.string),
})
export const Infos = Codec.record(Info)
export const Panes = Codec.record(
  Codec.struct({
    terminal: Codec.optional(Codec.boolean),
    review: Codec.optional(Codec.boolean),
    terminalHeight: Codec.optional(Codec.number),
    sessionWidth: Codec.optional(Codec.number),
  }),
)
export const ClosedTab = Codec.struct({ tab: SessionCodec, index: Codec.nonNegativeInt })
export const Closed = Codec.lenientArray(ClosedTab)
