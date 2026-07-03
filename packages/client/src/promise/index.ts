export * from "./generated/index"
export type { Transport } from "../effect/service.js"
export type { EventSubscribeOutput as OpenCodeEvent } from "./generated/types"
export type OpenCodeClient = ReturnType<typeof import("./generated/client").make>
