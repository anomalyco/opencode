import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { SessionGoal } from "@opencode/schema/session-goal"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const GoalState = Schema.Struct({ data: SessionGoal.State })
const GoalSnapshot = Schema.Struct({ data: SessionGoal.Snapshot })

it.live("serves the session goal and todo endpoints", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (path: string, method: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
      })

    const created = Schema.decodeUnknownSync(SessionResponse)(
      (yield* request("/api/session", "POST", { title: "Goal" })).body,
    )
    const goal = `/api/session/${created.data.id}/goal`
    const todo = `/api/session/${created.data.id}/todo`

    // A fresh session has no goal, is disarmed, and has an empty todo list.
    const empty = Schema.decodeUnknownSync(GoalState)((yield* request(goal, "GET")).body)
    expect(empty.data).toMatchObject({ rounds: 0, maxGoalRounds: 8, armed: false, todo: [] })
    expect(empty.data.goal).toBeUndefined()

    // `set` creates the goal and arms it in this process.
    const set = Schema.decodeUnknownSync(GoalSnapshot)(
      (yield* request(goal, "POST", { action: "set", objective: "ship it" })).body,
    )
    expect(set.data).toMatchObject({ revision: 1, objective: "ship it", phase: "active" })
    expect(Schema.decodeUnknownSync(GoalState)((yield* request(goal, "GET")).body).data.armed).toBe(true)

    // `resume` on an active goal is a phase conflict.
    expect((yield* request(goal, "POST", { action: "resume" })).status).toBe(409)

    // The todo list is replaced wholesale.
    expect(
      (yield* request(todo, "PUT", { todos: [{ content: "first", status: "pending", acceptance: "tests pass" }] }))
        .status,
    ).toBe(204)
    expect(Schema.decodeUnknownSync(GoalState)((yield* request(goal, "GET")).body).data.todo).toEqual([
      { position: 0, content: "first", status: "pending", acceptance: "tests pass" },
    ])

    // A stale CAS token on the todo path is a conflict.
    expect(
      (yield* request(todo, "PUT", { todos: [], expectedRevision: 1, expectedGoalID: set.data.id })).status,
    ).toBe(409)

    // `pause` is the user's cancel: it disarms and bumps the revision.
    const paused = Schema.decodeUnknownSync(GoalSnapshot)((yield* request(goal, "POST", { action: "pause" })).body)
    expect(paused.data).toMatchObject({ revision: 3, phase: "paused" })
    expect(Schema.decodeUnknownSync(GoalState)((yield* request(goal, "GET")).body).data.armed).toBe(false)

    // `pause` on a paused goal is a phase conflict.
    expect((yield* request(goal, "POST", { action: "pause" })).status).toBe(409)

    // `resume` re-arms.
    const resumed = Schema.decodeUnknownSync(GoalSnapshot)((yield* request(goal, "POST", { action: "resume" })).body)
    expect(resumed.data).toMatchObject({ revision: 4, phase: "active" })
    expect(Schema.decodeUnknownSync(GoalState)((yield* request(goal, "GET")).body).data.armed).toBe(true)

    // `clear` removes the goal and its todo list.
    yield* request(goal, "POST", { action: "clear" })
    const cleared = Schema.decodeUnknownSync(GoalState)((yield* request(goal, "GET")).body)
    expect(cleared.data).toMatchObject({ armed: false, todo: [] })
    expect(cleared.data.goal).toBeUndefined()

    // `edit` without a goal is a conflict, and so is a stale `expectedRevision`.
    expect((yield* request(goal, "POST", { action: "edit", objective: "x" })).status).toBe(409)
    yield* request(goal, "POST", { action: "set", objective: "ship it" })
    expect((yield* request(goal, "POST", { action: "edit", objective: "x", expectedRevision: 99 })).status).toBe(409)

    // A CAS token from the previous goal is rejected even at the same revision.
    const first = Schema.decodeUnknownSync(GoalSnapshot)(
      (yield* request(goal, "POST", { action: "set", objective: "first" })).body,
    )
    const second = Schema.decodeUnknownSync(GoalSnapshot)(
      (yield* request(goal, "POST", { action: "set", objective: "second" })).body,
    )
    expect(second.data.revision).toBe(1)
    expect(
      (yield* request(goal, "POST", {
        action: "edit",
        objective: "x",
        expectedRevision: 1,
        expectedGoalID: first.data.id,
      })).status,
    ).toBe(409)

    // An unknown session is not found.
    expect((yield* request(`/api/session/${Session.ID.create()}/goal`, "GET")).status).toBe(404)
  }).pipe(Effect.scoped),
)
