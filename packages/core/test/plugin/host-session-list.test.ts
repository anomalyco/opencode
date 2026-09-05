import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { SessionListInputError } from "@opencode-ai/plugin/effect/session"
import type { SessionList } from "@opencode-ai/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const list = Effect.fn(function* (input?: SessionList) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  return yield* host.session.list(input)
})

describe("PluginHost session.list validation", () => {
  it.effect("rejects relative directories", () =>
    Effect.gen(function* () {
      expect(yield* list({ directory: "relative/path" }).pipe(Effect.flip)).toEqual(
        new SessionListInputError({
          field: "directory",
          message: "session.list directory must be absolute: relative/path",
        }),
      )
    }),
  )

  it.effect("rejects unknown orders", () =>
    Effect.gen(function* () {
      expect(yield* list({ order: "sideways" as "asc" }).pipe(Effect.flip)).toEqual(
        new SessionListInputError({
          field: "order",
          message: 'session.list order must be "asc" or "desc": sideways',
        }),
      )
    }),
  )

  it.effect("rejects non-positive limits", () =>
    Effect.gen(function* () {
      expect(yield* list({ limit: -3 }).pipe(Effect.flip)).toEqual(
        new SessionListInputError({
          field: "limit",
          message: "session.list limit must be a positive integer: -3",
        }),
      )
    }),
  )
})
