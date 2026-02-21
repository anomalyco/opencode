import { create } from "@bufbuild/protobuf"
import type { JsonObject } from "@bufbuild/protobuf"
import { Config } from "../../config/config"
import { ConfigSchema, type GetConfigRequest, type UpdateConfigRequest } from "../gen/opencode/v1/config_pb"

function toProtoConfig(info: Config.Info) {
  return create(ConfigSchema, {
    theme: info.theme,
    model: info.model,
    smallModel: info.small_model,
    username: info.username,
    share: info.share,
    snapshot: info.snapshot,
    disabledProviders: info.disabled_providers ?? [],
    enabledProviders: info.enabled_providers ?? [],
    plugin: info.plugin ?? [],
    instructions: info.instructions ?? [],
    defaultAgent: info.default_agent,
    logLevel: info.logLevel,
    agent: info.agent as JsonObject,
    provider: info.provider as JsonObject,
    mcp: info.mcp as JsonObject,
    keybinds: info.keybinds as unknown as JsonObject,
    tui: info.tui as unknown as JsonObject,
    server: info.server as unknown as JsonObject,
    compaction: info.compaction as unknown as JsonObject,
    experimental: info.experimental as unknown as JsonObject,
    permission: info.permission as unknown as JsonObject,
    command: info.command as unknown as JsonObject,
    skills: info.skills as unknown as JsonObject,
    lsp: info.lsp as unknown as JsonObject,
    formatter: info.formatter as unknown as JsonObject,
  })
}

function fromProtoConfig(proto: ReturnType<typeof toProtoConfig>): Config.Info {
  const share = proto.share
  const logLevel = proto.logLevel
  return {
    theme: proto.theme,
    model: proto.model,
    small_model: proto.smallModel,
    username: proto.username,
    share: share === "manual" || share === "auto" || share === "disabled" ? share : undefined,
    snapshot: proto.snapshot,
    disabled_providers: proto.disabledProviders,
    enabled_providers: proto.enabledProviders,
    plugin: proto.plugin,
    instructions: proto.instructions,
    default_agent: proto.defaultAgent,
    logLevel:
      logLevel === "DEBUG" || logLevel === "INFO" || logLevel === "WARN" || logLevel === "ERROR" ? logLevel : undefined,
    agent: proto.agent as Config.Info["agent"],
    provider: proto.provider as Config.Info["provider"],
    mcp: proto.mcp as Config.Info["mcp"],
    keybinds: proto.keybinds as unknown as Config.Info["keybinds"],
    tui: proto.tui as unknown as Config.Info["tui"],
    server: proto.server as unknown as Config.Info["server"],
    compaction: proto.compaction as unknown as Config.Info["compaction"],
    experimental: proto.experimental as unknown as Config.Info["experimental"],
    permission: proto.permission as unknown as Config.Info["permission"],
    command: proto.command as unknown as Config.Info["command"],
    skills: proto.skills as unknown as Config.Info["skills"],
    lsp: proto.lsp as unknown as Config.Info["lsp"],
    formatter: proto.formatter as unknown as Config.Info["formatter"],
  }
}

export const config = {
  async get(_req: GetConfigRequest) {
    const info = await Config.get()
    return toProtoConfig(info)
  },

  async update(req: UpdateConfigRequest) {
    if (!req.config) {
      throw new Error("Config is required in UpdateConfigRequest")
    }
    const configInfo = fromProtoConfig(req.config)
    await Config.update(configInfo)
    return req.config
  },
}
