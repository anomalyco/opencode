export * as OpenCodeWorkerd from "./workerd"

import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { WorkerdProfile } from "../internal/workerd"
import { OpenCode } from "./opencode"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions<R = never> extends WorkerdProfile.Options {
  readonly log?: OpenCode.CreateOptions["log"]
  readonly workspaceProviders?: OpenCode.CreateOptions["workspaceProviders"]
  readonly instances?: OpenCode.CreateOptions<R>["instances"]
}

export const create = <R = never>({ log, workspaceProviders, instances, ...options }: CreateOptions<R>) => {
  const profile = WorkerdProfile.make(options)
  return OpenCode.create(
    { ...profile.options, log, workspaceProviders, instances },
    { overrides: profile.replacements },
  )
}

export const layer = <R = never>(
  options: CreateOptions<R>,
): Layer.Layer<OpenCode.Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> =>
  Layer.effect(OpenCode.Service, create(options))

export type Interface = OpenCode.Interface
export type Requirements = Scope.Scope
