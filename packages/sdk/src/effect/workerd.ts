export * as OpenCodeWorkerd from "./workerd"

import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { WorkerdProfile } from "../internal/workerd"
import { OpenCode } from "./opencode"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions extends WorkerdProfile.Options {
  readonly log?: OpenCode.CreateOptions["log"]
  readonly workspaceProviders?: OpenCode.CreateOptions["workspaceProviders"]
}

export const create = ({ log, workspaceProviders, ...options }: CreateOptions) => {
  const profile = WorkerdProfile.make(options)
  return OpenCode.create({ ...profile.options, log, workspaceProviders }, { overrides: profile.replacements })
}

export const layer = (options: CreateOptions): Layer.Layer<OpenCode.Service, Config.ConfigError | Error> =>
  Layer.effect(OpenCode.Service, create(options))

export type Interface = OpenCode.Interface
export type Requirements = Scope.Scope
