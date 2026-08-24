export * as OpenCodeWorkerd from "./workerd"

import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { WorkerdProfile } from "../internal/workerd"
import { OpenCode } from "./opencode"

export { Service } from "./opencode"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions extends WorkerdProfile.Options {
  readonly log?: OpenCode.CreateOptions["log"]
  readonly workspaceProviders?: OpenCode.CreateOptions["workspaceProviders"]
}

export const create = (options: CreateOptions) => {
  const host = make(options)
  return OpenCode.create(host.options, host.embed)
}

export const layer = (options: CreateOptions): Layer.Layer<OpenCode.Service, Config.ConfigError | Error> =>
  Layer.effect(OpenCode.Service, create(options))

export const layerWith = <E, R>(
  registration: Layer.Layer<never, E, R>,
  options: CreateOptions,
): Layer.Layer<OpenCode.Service, Config.ConfigError | Error | E, Exclude<R, OpenCode.Service>> => {
  const host = make(options)
  return OpenCode.layerWith(registration, host.options, host.embed)
}

export type Interface = OpenCode.Interface
export type Requirements = Scope.Scope

function make({ log, workspaceProviders, ...options }: CreateOptions) {
  const profile = WorkerdProfile.make(options)
  return {
    options: { ...profile.options, log, workspaceProviders },
    embed: { overrides: profile.replacements },
  }
}
