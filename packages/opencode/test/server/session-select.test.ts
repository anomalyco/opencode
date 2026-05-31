import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

void Log.init({ print: false })

const it = testEffect(Layer.mergeAll(Session.defaultLayer, httpApiLayer))

describe("tui.selectSession endpoint", () => {
  it.instance(
    "should return 200 when called with valid session",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const session = yield* Session.use.create({})

        const response = yield* requestInDirectory("/tui/select-session", tmp.directory, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: session.id }),
        })

        expect(response.status).toBe(200)
        const body = yield* response.json
        expect(body).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "should return 404 when session does not exist",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const nonExistentSessionID = "ses_nonexistent123"

        const response = yield* requestInDirectory("/tui/select-session", tmp.directory, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: nonExistentSessionID }),
        })

        expect(response.status).toBe(404)
      }),
    { git: true },
  )

  it.instance(
    "should return 400 when session ID format is invalid",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const invalidSessionID = "invalid_session_id"

        const response = yield* requestInDirectory("/tui/select-session", tmp.directory, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: invalidSessionID }),
        })

        expect(response.status).toBe(400)
      }),
    { git: true },
  )
})
