export * as App from "./app.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@Mackery6969/util/effect/app-node"

export interface Info {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export const Metadata = Context.Reference<Info>("@Mackery6969/App", {
  defaultValue: () => make(),
})

export class Service extends Context.Service<Service, Info>()("@opencode/App") {}

export function make(input: Partial<Info> = {}): Info {
  return {
    name: input.name ?? "opencode",
    version: input.version ?? "unknown",
    channel: input.channel ?? "unknown",
  }
}

export function useragent(app: Info) {
  return `opencode/${app.channel}/${app.version}/${app.name}`
}

export const layer = (input?: Partial<Info>) => Layer.succeed(Service, make(input))

export const configured = (input?: Partial<Info>) =>
  makeGlobalNode({ service: Service, layer: layer(input), deps: [] })

export const node = configured()
