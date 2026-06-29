export * from "./generated/index"
export type { EventsSubscribeOutput as OpenCodeEvent } from "./generated/types"
export type OpenCodeClient = ReturnType<typeof import("./generated/client").make>
