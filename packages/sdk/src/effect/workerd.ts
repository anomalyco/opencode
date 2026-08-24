export * as OpenCodeWorkerd from "./workerd"

import { ServerWorkerd } from "@opencode-ai/server/workerd"
import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { OpenCode } from "./opencode"

export interface CreateOptions extends Omit<ServerWorkerd.Options, "password"> {
  readonly log?: OpenCode.CreateOptions["log"]
  readonly workspaceProviders?: OpenCode.CreateOptions["workspaceProviders"]
}

export const create = ({ log, workspaceProviders, ...options }: CreateOptions) =>
  OpenCode.create(
    { ...ServerWorkerd.serverOptions(options), log, workspaceProviders },
    { overrides: ServerWorkerd.replacements(options) },
  )

export const layer = (options: CreateOptions): Layer.Layer<OpenCode.Service, Config.ConfigError | Error> =>
  Layer.effect(OpenCode.Service, create(options))

export type Interface = OpenCode.Interface
export type Requirements = Scope.Scope
