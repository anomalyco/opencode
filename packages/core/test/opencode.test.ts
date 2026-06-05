import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { OpenCode } from "@opencode-ai/core/opencode"
import { testEffect } from "./lib/effect"

const it = testEffect(OpenCode.layer)

describe("OpenCode.layer", () => {
  it.effect("exposes Sessions through the public embedded API", () =>
    Effect.gen(function* () {
      const opencode = yield* OpenCode.Service

      expect(yield* opencode.sessions.list()).toBeArray()
    }),
  )
})
