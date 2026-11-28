export * as WorkerdProfile from "./workerd"

import type { Config } from "@opencode/schema/config"
import { ServerWorkerd } from "@opencode/server/workerd"

export type Configuration = Omit<typeof Config.Info.Encoded, "plugins">
export type ImageLimits = ServerWorkerd.ImageLimits
export type ImageResizerInput = ServerWorkerd.ImageResizerInput
export type ImageResizerOutput = ServerWorkerd.ImageResizerOutput
export type ImageResizer = ServerWorkerd.ImageResizer

export interface Options extends Omit<ServerWorkerd.Options, "password" | "config"> {
  readonly config?: Configuration
}

export function make({ config, ...options }: Options) {
  const server = {
    ...options,
    config: config === undefined ? undefined : { content: JSON.stringify(config) },
  }
  return {
    options: ServerWorkerd.serverOptions(server),
    replacements: ServerWorkerd.replacements(server),
  }
}
