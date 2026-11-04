import { expect, test } from "bun:test"
import {
  selectProviderConnectView,
  startProviderConnect,
  transitionProviderConnect,
  type ProviderAuthorization,
  type ProviderCatalog,
  type ProviderConnectEffect,
  type ProviderConnectEvent,
  type ProviderConnectMethod,
  type ProviderConnectState,
} from "./machine"

const key: ProviderConnectMethod = { type: "key", label: "API key" }
const oauth: ProviderConnectMethod = { id: "oauth", type: "oauth", label: "Sign in" }
const command: ProviderConnectMethod = { id: "cli", type: "command", label: "CLI", command: ["login"] }

const authorization = (mode: "auto" | "code", attemptID = "att_1"): ProviderAuthorization => ({
  attemptID,
  url: `https://auth.example.test/${attemptID}`,
  instructions: "",
  mode,
  time: { created: 0, expires: 1 },
})

function replay(events: ProviderConnectEvent[], from = startProviderConnect().state) {
  return events.reduce<{ state: ProviderConnectState; effects: ProviderConnectEffect[] }>(
    (result, event) => {
      const next = transitionProviderConnect(result.state, event)

      return { state: next.state, effects: [...next.effects] }
    },
    { state: from, effects: [] },
  )
}

const loaded = (methods: ReadonlyArray<ProviderConnectMethod>, manual = false): ProviderConnectEvent => ({
  type: "integration.loaded",
  attempt: 0,
  catalog: { methods } satisfies ProviderCatalog,
  manual,
})

// Lands on the key form with `sk-1` sent; returns the attempt the request carries.
function submittingKey() {
  const result = replay([loaded([key]), { type: "entry.submitted", value: "sk-1" }])
  const submit = result.effects.find((effect) => effect.type === "submit")

  if (submit?.type !== "submit") throw new Error("expected a submit effect")

  return { state: result.state, attempt: submit.attempt }
}

function enteringCode() {
  const started = replay([loaded([oauth]), { type: "method.selected", index: 0 }])
  const start = started.effects.find((effect) => effect.type === "start")

  if (start?.type !== "start") throw new Error("expected a start effect")

  return replay(
    [{ type: "oauth.started", attempt: start.attempt, authorization: authorization("code") }],
    started.state,
  )
}

function submittingCode() {
  const result = replay([{ type: "entry.submitted", value: "123456" }], enteringCode().state)
  const submit = result.effects.find((effect) => effect.type === "submit")

  if (submit?.type !== "submit") throw new Error("expected a submit effect")

  return { state: result.state, attempt: submit.attempt }
}

test.each([
  { name: "Back", leave: { type: "back" } as const, status: "choosing" },
  { name: "closing the connection", leave: { type: "disposed" } as const, status: "disposed" },
])("$name during an API key request ignores its late result", (row) => {
  const sent = submittingKey()
  expect(selectProviderConnectView(sent.state)).toMatchObject({ screen: "key", submitting: true })

  const left = transitionProviderConnect(sent.state, row.leave)
  expect(left.state.status).toBe(row.status)

  const succeeded = transitionProviderConnect(left.state, { type: "submit.succeeded", attempt: sent.attempt })
  expect(succeeded).toEqual({ state: left.state, effects: [] })
  expect(transitionProviderConnect(left.state, { type: "submit.failed", attempt: sent.attempt, error: "x" })).toEqual({
    state: left.state,
    effects: [],
  })
})

test("a request abandoned with Back does not settle the next request for the same method", () => {
  const first = submittingKey()
  const second = replay(
    [{ type: "back" }, { type: "method.selected", index: 0 }, { type: "entry.submitted", value: "sk-2" }],
    first.state,
  )
  expect(second.state.status).toBe("submitting")

  expect(transitionProviderConnect(second.state, { type: "submit.succeeded", attempt: first.attempt })).toEqual({
    state: second.state,
    effects: [],
  })
  expect(
    transitionProviderConnect(second.state, { type: "submit.failed", attempt: first.attempt, error: "late" }),
  ).toEqual({ state: second.state, effects: [] })
})

test("a rejected API key shows the server error and takes the next submit", () => {
  const sent = submittingKey()
  expect(transitionProviderConnect(sent.state, { type: "entry.submitted", value: "sk-2" })).toEqual({
    state: sent.state,
    effects: [],
  })

  const rejected = transitionProviderConnect(sent.state, {
    type: "submit.failed",
    attempt: sent.attempt,
    error: "Invalid API key",
  })
  expect(rejected.effects).toEqual([])
  expect(selectProviderConnectView(rejected.state)).toMatchObject({
    screen: "key",
    submitting: false,
    entryError: { type: "rejected", message: "Invalid API key" },
  })

  const retried = transitionProviderConnect(rejected.state, { type: "entry.submitted", value: "sk-2" })
  expect(retried.effects).toMatchObject([{ type: "submit", value: "sk-2" }])
})

test("a successful API key refreshes the catalogs before it reports the connection", () => {
  const sent = submittingKey()
  const stored = transitionProviderConnect(sent.state, { type: "submit.succeeded", attempt: sent.attempt })
  const refresh = stored.effects[0]

  if (refresh?.type !== "refresh") throw new Error("expected a refresh effect")
  expect(stored.state.status).toBe("refreshing")

  const done = transitionProviderConnect(stored.state, { type: "refresh.succeeded", attempt: refresh.attempt })
  expect(done.state.status).toBe("connected")
  expect(done.effects).toEqual([{ type: "complete", method: key }])
})

test("Back during a pasted code request cancels the open attempt and ignores its late result", () => {
  const sent = submittingCode()
  const back = transitionProviderConnect(sent.state, { type: "back" })
  expect(back.state.status).toBe("choosing")
  expect(back.effects).toEqual([{ type: "cancel", target: "oauth", attemptID: "att_1" }])
  expect(transitionProviderConnect(back.state, { type: "submit.succeeded", attempt: sent.attempt }).effects).toEqual([])
})

test("a rejected code keeps the attempt open for another code", () => {
  const sent = submittingCode()
  const rejected = transitionProviderConnect(sent.state, {
    type: "submit.failed",
    attempt: sent.attempt,
    error: "Invalid code",
  })
  expect(rejected.effects).toEqual([])
  expect(selectProviderConnectView(rejected.state)).toMatchObject({
    screen: "code",
    authorizing: true,
    entryError: { type: "rejected", message: "Invalid code" },
  })
})

test.each([
  { name: "API key", from: () => replay([loaded([key])]).state },
  { name: "code", from: () => enteringCode().state },
])("an empty $name asks for a value without a request", (row) => {
  const result = transitionProviderConnect(row.from(), { type: "entry.submitted", value: "   " })
  expect(result.effects).toEqual([])
  expect(selectProviderConnectView(result.state).entryError).toEqual({ type: "required" })
})

test.each([
  {
    name: "OAuth",
    late: (attempt: number): ProviderConnectEvent => ({
      type: "oauth.started",
      attempt,
      authorization: authorization("auto", "att_late"),
    }),
    cancel: { type: "cancel", target: "oauth", attemptID: "att_late" },
  },
  {
    name: "command",
    late: (attempt: number): ProviderConnectEvent => ({
      type: "command.started",
      attempt,
      command: { attemptID: "cmd_late", time: { created: 0, expires: 1 } },
    }),
    cancel: { type: "cancel", target: "command", attemptID: "cmd_late" },
  },
])("an $name attempt that starts after Back is cancelled", (row) => {
  const starting = replay([loaded([oauth, command]), { type: "method.selected", index: row.name === "OAuth" ? 0 : 1 }])
  const start = starting.effects.find((effect) => effect.type === "start")

  if (start?.type !== "start") throw new Error("expected a start effect")
  const back = transitionProviderConnect(starting.state, { type: "back" })
  expect(transitionProviderConnect(back.state, row.late(start.attempt))).toEqual({
    state: back.state,
    effects: [row.cancel],
  })
})

test.each([
  { name: "a lone method starts on its own", methods: [key], manual: false, status: "entering" },
  { name: "a manual lone method waits for the user", methods: [key], manual: true, status: "choosing" },
  { name: "several methods wait for the user", methods: [oauth, key], manual: false, status: "choosing" },
])("$name", (row) => {
  const result = replay([loaded(row.methods, row.manual)])
  expect(result.state.status).toBe(row.status)
  expect(transitionProviderConnect(result.state, { type: "back" }).state.status).toBe("choosing")
})

test("an unreachable OAuth status resumes the same attempt, and Back from it cancels the attempt", () => {
  const starting = replay([loaded([oauth]), { type: "method.selected", index: 0 }])
  const start = starting.effects.find((effect) => effect.type === "start")

  if (start?.type !== "start") throw new Error("expected a start effect")
  const waiting = transitionProviderConnect(starting.state, {
    type: "oauth.started",
    attempt: start.attempt,
    authorization: authorization("auto"),
  })
  expect(waiting.effects.map((effect) => effect.type)).toEqual(["open.browser", "poll"])

  const failed = transitionProviderConnect(waiting.state, {
    type: "polled",
    attempt: start.attempt,
    outcome: { status: "unreachable", error: "offline" },
  })
  expect(selectProviderConnectView(failed.state)).toMatchObject({ screen: "failed", error: "offline" })

  const resumed = transitionProviderConnect(failed.state, { type: "retry" })
  expect(resumed.state.status).toBe("waiting")
  expect(resumed.effects).toMatchObject([
    { type: "poll", delay: false, signIn: { authorization: { attemptID: "att_1" } } },
  ])

  expect(transitionProviderConnect(failed.state, { type: "back" }).effects).toEqual([
    { type: "cancel", target: "oauth", attemptID: "att_1" },
  ])
})

test("a failed refresh retries the refresh, not the sign-in", () => {
  const sent = submittingKey()
  const stored = transitionProviderConnect(sent.state, { type: "submit.succeeded", attempt: sent.attempt })
  const refresh = stored.effects[0]

  if (refresh?.type !== "refresh") throw new Error("expected a refresh effect")
  const failed = transitionProviderConnect(stored.state, {
    type: "refresh.failed",
    attempt: refresh.attempt,
    error: "Could not load",
  })
  expect(failed.state.status).toBe("failed")
  expect(transitionProviderConnect(failed.state, { type: "retry" }).effects).toMatchObject([
    { type: "refresh", method: key },
  ])
})
