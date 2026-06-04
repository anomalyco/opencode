#!/usr/bin/env bun

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Daemon } from "./services/daemon"

const Handlers = Runtime.handlers(Commands, {
  debug: {
    agents: () => import("./commands/handlers/debug/agents"),
  },
  migrate: () => import("./commands/handlers/migrate"),
  service: {
    start: () => import("./commands/handlers/service/start"),
    restart: () => import("./commands/handlers/service/restart"),
    status: () => import("./commands/handlers/service/status"),
    stop: () => import("./commands/handlers/service/stop"),
    password: () => import("./commands/handlers/service/password"),
  },
  serve: () => import("./commands/handlers/serve"),
})

Runtime.run(Commands, Handlers, { version: "local" }).pipe(
  Effect.provide(Daemon.defaultLayer),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
)
