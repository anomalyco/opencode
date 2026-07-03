#!/usr/bin/env bun

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { NodeFileSystem } from "@effect/platform-node"
import * as Effect from "effect/Effect"
import { Layer, Logger, References } from "effect"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Logging } from "@opencode-ai/core/observability/logging"
import { Updater } from "./services/updater"
import { InstallationChannel, InstallationVersion, InstallationLocal } from "@opencode-ai/core/installation/version"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { AppProcess } from "@opencode-ai/core/process"

const LoggingLayer = Logger.layer(Logging.loggers(), { mergeWithExisting: false }).pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.orDie,
  Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
)

const Handlers = Runtime.handlers(Commands, {
  $: () => import("./commands/handlers/default"),
  api: () => import("./commands/handlers/api"),
  debug: {
    agents: () => import("./commands/handlers/debug/agents"),
  },
  mcp: {
    list: () => import("./commands/handlers/mcp/list"),
    add: () => import("./commands/handlers/mcp/add"),
    auth: () => import("./commands/handlers/mcp/auth"),
    logout: () => import("./commands/handlers/mcp/logout"),
  },
  migrate: () => import("./commands/handlers/migrate"),
  service: {
    start: () => import("./commands/handlers/service/start"),
    restart: () => import("./commands/handlers/service/restart"),
    status: () => import("./commands/handlers/service/status"),
    stop: () => import("./commands/handlers/service/stop"),
    get: () => import("./commands/handlers/service/get"),
    set: () => import("./commands/handlers/service/set"),
    unset: () => import("./commands/handlers/service/unset"),
  },
  serve: () => import("./commands/handlers/serve"),
})

Effect.logInfo("cli starting", { version: InstallationVersion, channel: InstallationChannel, local: InstallationLocal }).pipe(
  Effect.flatMap(() => Runtime.run(Commands, Handlers, { version: InstallationVersion })),
  Effect.annotateLogs({ role: "cli" }),
  Effect.provide(Updater.layer),
  Effect.provide(AppNodeBuilder.build(LayerNode.group([Global.node, AppProcess.node]))),
  Effect.provide(LoggingLayer),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  Effect.tap(() => Effect.sync(() => process.exit(0))),
  NodeRuntime.runMain,
)
