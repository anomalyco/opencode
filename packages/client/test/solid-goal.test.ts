import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

const sessionID = "ses_goal"
const goalPath = `/api/session/${sessionID}/goal`

const state = {
  goal: {
    id: "goal_test",
    revision: 1,
    objective: "Ship the goal indicator",
    phase: "active" as const,
    maxGoalRounds: 8,
  },
  createdAt: 1_000,
  rounds: 0,
  maxGoalRounds: 8,
  armed: true,
  todo: [],
}

const events: OpenCodeEvent[] = [
  {
    id: "evt_goal_updated",
    created: 10,
    type: "session.goal.updated",
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: {
      sessionID,
      snapshot: {
        id: "goal_test",
        revision: 2,
        objective: "Ship the goal indicator",
        phase: "paused",
        maxGoalRounds: 8,
      },
    },
  },
  {
    id: "evt_goal_cleared",
    created: 11,
    type: "session.goal.cleared",
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    data: { sessionID, goalID: "goal_test", revision: 3 },
  },
  {
    id: "evt_todo_updated",
    created: 12,
    type: "session.todo.updated",
    durable: { aggregateID: sessionID, seq: 3, version: 1 },
    data: { sessionID, revision: 4, todos: [{ content: "Add the dock", status: "pending" }] },
  },
  {
    id: "evt_todo_verified",
    created: 13,
    type: "session.todo.verified",
    durable: { aggregateID: sessionID, seq: 4, version: 1 },
    data: { sessionID, revision: 5, items: [{ position: 0, status: "completed", feedback: "Verified" }] },
  },
]

test("re-reads the goal read model for every goal and todo event", async () => {
  using fixture = setup()
  await fixture.data.session.goal.sync(sessionID)
  expect(fixture.calls).toEqual([goalPath])
  expect(fixture.data.session.goal.list(sessionID)).toMatchObject({ rounds: 0, armed: true })

  for (const [index, event] of events.entries()) {
    fixture.emit(event)
    await wait(() => fixture.calls.length === index + 2)
  }
  expect(fixture.calls).toEqual(Array.from({ length: events.length + 1 }, () => goalPath))

  // The invalidated key is the one `sync` reads, so a settled read does not fetch again.
  await fixture.data.session.goal.sync(sessionID)
  expect(fixture.calls).toHaveLength(events.length + 1)
})

test("leaves a goal no reader has loaded alone", async () => {
  using fixture = setup()
  fixture.emit(events[0])
  await Bun.sleep(10)
  expect(fixture.calls).toEqual([])
})

function setup() {
  const calls: string[] = []
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const pathname = new URL(request.url).pathname
      calls.push(pathname)
      if (pathname === goalPath) return Response.json({ data: state })
      throw new Error(`Unexpected request: ${request.url}`)
    },
  })
  const root = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  return {
    ...root,
    calls,
    [Symbol.dispose]: root.dispose,
    emit(details: OpenCodeEvent) {
      listeners.forEach((listener) => listener({ name: details.type, details }))
    },
  }
}

async function wait(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("Timed out waiting for the goal read")
}
