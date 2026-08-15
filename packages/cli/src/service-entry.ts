#!/usr/bin/env bun

import { NodeRuntime } from "@effect/platform-node"
import { Observability } from "@opencode-ai/util/observability"
import { Effect } from "effect"
import { ServerProcess } from "./server-process"
import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "./version"

Effect.logInfo("cli starting", {
  version: OPENCODE_VERSION,
  channel: OPENCODE_CHANNEL,
  local: true,
  args: ["serve", "--service"],
}).pipe(
  Effect.annotateLogs({ role: "cli" }),
  Effect.andThen(ServerProcess.run({ mode: "service" })),
  Effect.provide(
    Observability.layer({
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
      client: process.env.OPENCODE_CLIENT ?? "cli",
      version: OPENCODE_VERSION,
      channel: OPENCODE_CHANNEL,
    }),
  ),
  Effect.scoped,
  NodeRuntime.runMain,
)
