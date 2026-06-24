import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(httpApiLayer))

describe("TUI routes removed (Phase 0 contract)", () => {
  it.instance(
    "POST /tui/select-session returns 404 (route removed)",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* requestInDirectory("/tui/select-session", tmp.directory, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: "ses_test" }),
        })
        expect(response.status).toBe(404)
      }),
    { git: true },
  )
})
