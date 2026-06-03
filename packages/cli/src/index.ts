#!/usr/bin/env bun

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { Api } from "./api"
import { CliBuilder } from "./cli-builder"

const Handlers = CliBuilder.handlers(Api, {
  debug: {
    agents: () => import("./handlers/debug/agents"),
  },
  migrate: () => import("./handlers/migrate"),
})

CliBuilder.run(Api, Handlers, { version: "local" }).pipe(
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
)
