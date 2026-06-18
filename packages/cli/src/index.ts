#!/usr/bin/env bun

// Bun hardcodes a 5-minute timeout on globalThis.fetch (oven-sh/bun#16682).
// Monkey-patch it once at startup so ALL fetch calls (including Effect's
// FetchHttpClient) use timeout: false.
const _origFetch = globalThis.fetch
globalThis.fetch = ((input: URL | RequestInfo, init?: RequestInit) => {
  return _origFetch(input, { ...init, timeout: false } as RequestInit & { timeout?: boolean })
}) as typeof globalThis.fetch

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Daemon } from "./services/daemon"

const Handlers = Runtime.handlers(Commands, {
  $: () => import("./commands/handlers/default"),
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
