import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const it = testEffect(Session.defaultLayer)

describe("tui.selectSession endpoint", () => {
  it.instance(
    "should return 200 when called with valid session",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const session = yield* Session.Service.use((svc) => svc.create({}))

        const app = Server.Default().app
        const response = yield* Effect.promise(() =>
          Promise.resolve(
            app.request("/tui/select-session", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-opencode-directory": tmp.directory,
              },
              body: JSON.stringify({ sessionID: session.id }),
            }),
          ),
        )

        expect(response.status).toBe(200)
        const body = yield* Effect.promise(() => response.json())
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

        const app = Server.Default().app
        const response = yield* Effect.promise(() =>
          Promise.resolve(
            app.request("/tui/select-session", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-opencode-directory": tmp.directory,
              },
              body: JSON.stringify({ sessionID: nonExistentSessionID }),
            }),
          ),
        )

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

        const app = Server.Default().app
        const response = yield* Effect.promise(() =>
          Promise.resolve(
            app.request("/tui/select-session", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-opencode-directory": tmp.directory,
              },
              body: JSON.stringify({ sessionID: invalidSessionID }),
            }),
          ),
        )

        expect(response.status).toBe(400)
      }),
    { git: true },
  )
})
