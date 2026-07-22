#!/usr/bin/env bun

import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Observability } from "@opencode-ai/util/observability"
import { Updater } from "./services/updater"
import { OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "./version"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { Config } from "./config"
import { Npm } from "@opencode-ai/util/npm"

const Handlers = Runtime.handlers(Commands, {
  $: () => import("./commands/handlers/default"),
  acp: () => import("./commands/handlers/acp"),
  api: () => import("./commands/handlers/api"),
  auth: {
    connect: () => import("./commands/handlers/auth/connect"),
  },
  debug: {
    agents: () => import("./commands/handlers/debug/agents"),
  },
  console: {
    login: () => import("./commands/handlers/console/login"),
  },
  mcp: {
    list: () => import("./commands/handlers/mcp/list"),
    add: () => import("./commands/handlers/mcp/add"),
    auth: () => import("./commands/handlers/mcp/auth"),
    logout: () => import("./commands/handlers/mcp/logout"),
  },
  plugin: {
    list: () => import("./commands/handlers/plugin/list"),
  },
  migrate: () => import("./commands/handlers/migrate"),
  mini: () => import("./commands/handlers/mini"),
  run: () => import("./commands/handlers/run"),
  pair: () => import("./commands/handlers/pair"),
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

Effect.logInfo("cli starting", {
  version: OPENCODE_VERSION,
  channel: OPENCODE_CHANNEL,
  local: OPENCODE_LOCAL,
  args: process.argv.slice(2),
}).pipe(
  Effect.flatMap(() => Runtime.run(Commands, Handlers, { version: OPENCODE_VERSION })),
  Effect.annotateLogs({ role: "cli" }),
  Effect.provide(Config.layer),
  Effect.provide(Updater.layer),
  Effect.provide(
    LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, Npm.node]), [
      [
        Global.node,
        Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
      ],
    ]),
  ),
  Effect.provide(
    Observability.layer({
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
      client: process.env.OPENCODE_CLIENT ?? "cli",
      version: OPENCODE_VERSION,
      channel: OPENCODE_CHANNEL,
    }),
  ),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  Effect.tap(() => Effect.sync(() => process.exit(process.exitCode ?? 0))),
  NodeRuntime.runMain,
)
