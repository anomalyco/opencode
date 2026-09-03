export * as OpenCode from "./client.js"

import { SharedEvents } from "../shared-events.js"
import { OpenCode } from "./generated/index.js"
import type { ClientOptions } from "./generated/client.js"
import { makeRpc } from "./rpc.js"

export type { ClientOptions, RequestOptions } from "./generated/client.js"

export function make(options: ClientOptions) {
  const raw = OpenCode.make(options)
  const events = SharedEvents.make((signal) => raw.event.subscribe({ signal }))
  return {
    ...raw,
    rpc: Object.assign(makeRpc(raw, events), raw.rpc),
    event: events,
  }
}
