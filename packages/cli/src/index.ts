#!/usr/bin/env bun

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Command from "effect/unstable/cli/Command"
import { DebugCommand } from "./debug"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"

const cli = Command.make("opencode", {}, () => Effect.void).pipe(
  Command.withDescription("OpenCode command line interface"),
  Command.withSubcommands([DebugCommand]),
)

const layer = Layer.mergeAll(LocationServiceMap.layer, NodeServices.layer)

Command.run(cli, { version: "local" }).pipe(Effect.provide(layer), Effect.scoped, NodeRuntime.runMain)
