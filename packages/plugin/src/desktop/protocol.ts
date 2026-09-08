export * as DesktopExtension from "./protocol.js"
import { Schema } from "effect"

const id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
export const Endpoint = Schema.Struct({
  id,
  url: Schema.String,
  username: Schema.optionalKey(Schema.String),
  password: Schema.optionalKey(Schema.String),
})
export type Endpoint = typeof Endpoint.Type
export const Layout = Schema.Struct({
  visible: Schema.Boolean,
  bounds: Schema.optionalKey(
    Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite }),
  ),
  background: Schema.optionalKey(Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number])),
  radius: Schema.optionalKey(Schema.Number),
})
export type Layout = typeof Layout.Type
export const Call = Schema.Struct({ extensionID: id, rpcID: id, method: id, requestID: id, input: Schema.Json })
export type Call = typeof Call.Type
export const Event = Schema.Struct({ extensionID: id, rpcID: id, name: id, data: Schema.Json })
export type Event = typeof Event.Type

export interface Transport {
  call(input: Call, signal?: AbortSignal): Promise<unknown>
  onEvent(listener: (event: Event) => void): () => void
  surface(extensionID: string, surfaceID: string, layout?: Layout): void
  configure(servers: readonly Endpoint[]): void
  release(extensionID: string): void
}
