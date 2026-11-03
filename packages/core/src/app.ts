export * as App from "./app.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import pkg from "../package.json"

export interface Info {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export const Metadata = Context.Reference<Info>("@opencode/App", {
  defaultValue: () => make(),
})

export function make(input: Partial<Info> = {}): Info {
  return {
    name: input.name ?? "opencode",
    version:
      input.version && input.version !== "local" && input.version !== "unknown"
        ? input.version
        : (process.env.OPENCODE_VERSION ?? pkg.version),
    channel: input.channel ?? "unknown",
  }
}

export function useragent(app: Info) {
  const version =
    app.version && app.version !== "local" && app.version !== "unknown"
      ? app.version
      : (process.env.OPENCODE_VERSION ?? pkg.version)
  const channel = app.channel && app.channel !== "unknown" ? app.channel : "latest"
  return `opencode/${channel}/${version}/${app.name}`
}

export const layer = (input?: Partial<Info>) => Layer.succeed(Metadata, make(input))

export const configured = (input?: Partial<Info>) =>
  makeGlobalNode({ service: Metadata, layer: layer(input), deps: [] })

export const node = configured()
