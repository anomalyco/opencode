export * as App from "./app.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Info {
  readonly name: string
  readonly version: string
  readonly channel: string
  readonly server?: {
    readonly url: string
    readonly password: string
  }
}

export const Metadata = Context.Reference<Info>("@opencode/App", {
  defaultValue: () => make(),
})

export function make(input: Partial<Info> = {}): Info {
  return {
    name: input.name ?? "opencode",
    version: input.version ?? "unknown",
    channel: input.channel ?? "unknown",
    server: input.server,
  }
}

export function useragent(app: Info) {
  return `opencode/${app.channel}/${app.version}/${app.name}`
}

export const layer = (input?: Partial<Info>) => Layer.succeed(Metadata, make(input))

export const configured = (input?: Partial<Info>) =>
  makeGlobalNode({ service: Metadata, layer: layer(input), deps: [] })

export const node = configured()
