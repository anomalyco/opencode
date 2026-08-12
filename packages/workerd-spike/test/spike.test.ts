import { env, fetchMock, runInDurableObject } from "cloudflare:test"
import { afterEach, beforeAll, expect, it } from "vitest"
import { FAKE_LLM_ORIGIN, PASSWORD, SLOW_LLM_ORIGIN } from "../src/worker"

// A4 boot spike: the full opencode core + server stack running inside a REAL
// Durable Object under workerd (@cloudflare/vitest-pool-workers), over real DO
// SQLite, with the LLM provider faked at the network edge via fetchMock.

const AUTH = { authorization: `Basic ${btoa(`opencode:${PASSWORD}`)}` }
const BASE = "https://opencode.spike"

const stub = () => env.OPENCODE.getByName("spike")

const request = (path: string, init?: RequestInit) =>
  stub().fetch(
    new Request(`${BASE}${path}`, {
      ...init,
      headers: { ...AUTH, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    }),
  )

const timed = async <T>(label: string, work: () => Promise<T>) => {
  const started = Date.now()
  const result = await work()
  console.log(`[timing] ${label}: ${Date.now() - started}ms`)
  return result
}

// One SSE turn from the fake provider: a short assistant message, then stop.
const FAKE_SSE = [
  `data: ${JSON.stringify({
    id: "chatcmpl-spike",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "Hello from a Durable Object!" } }],
  })}`,
  `data: ${JSON.stringify({
    id: "chatcmpl-spike",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
  })}`,
  "data: [DONE]",
  "",
].join("\n\n")

beforeAll(() => {
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

afterEach(() => {
  fetchMock.assertNoPendingInterceptors()
})

const completions = (origin: string) =>
  fetchMock
    .get(origin)
    .intercept({ method: "POST", path: (path) => path.endsWith("/chat/completions") })
    .reply(200, FAKE_SSE, { headers: { "content-type": "text/event-stream" } })

// Persisted once: tests run sequentially in one runtime (isolatedStorage:false)
// and the same interceptor serves every completed turn in the file.
const mocked = { llm: false }
const mockLLM = () => {
  if (mocked.llm) return
  mocked.llm = true
  completions(FAKE_LLM_ORIGIN).persist()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type LogItem = { type?: string; seq?: number; durable?: { seq?: number }; [key: string]: unknown }

// Durable events carry their aggregate sequence in the envelope; the trailing
// log.synced marker carries the replay watermark at top level.
const seqOf = (item: LogItem) => item.durable?.seq ?? item.seq ?? 0

const readLog = async (sessionID: string, after = 0) => {
  const response = await request(`/api/experimental/session/${sessionID}/log?after=${after}&follow=false`)
  expect(response.status).toBe(200)
  const sse = await response.text()
  return sse
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as LogItem)
}

const createSession = async (model: { providerID: string; id: string } = { providerID: "fake", id: "spike-model" }) => {
  const response = await timed("session create", () =>
    request("/api/session", {
      method: "POST",
      body: JSON.stringify({
        title: "spike session",
        model,
        location: { directory: "/tmp/project" },
      }),
    }),
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: { id: string } }
  expect(body.data.id).toMatch(/^ses/)
  return body.data.id
}

it("boots the DO: migrations on real DO SQLite and an authed health 200", async () => {
  const health = await timed("cold boot + health", () => request("/api/health"))
  expect(health.status).toBe(200)
  expect(await health.json()).toMatchObject({ healthy: true, version: "workerd-spike" })

  const unauthorized = await request("/api/health", { headers: { authorization: "" } })
  expect(unauthorized.status).toBe(401)

  const warm = await timed("warm health", () => request("/api/health"))
  expect(warm.status).toBe(200)

  const tables = await runInDurableObject(stub(), async (_instance, state) =>
    state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .toArray()
      .map((row) => row.name),
  )
  expect(tables).toContain("session_v2")
  expect(tables).toContain("migration")

  const migrations = await runInDurableObject(stub(), async (_instance, state) =>
    state.storage.sql.exec("SELECT count(*) AS count FROM migration").one(),
  )
  console.log(`[info] migration journal rows: ${migrations.count}`)
  expect(Number(migrations.count)).toBeGreaterThan(0)
})

it("creates a session through the API and persists the row", async () => {
  await timed("boot before session create", () => request("/api/health"))
  const sessionID = await createSession()

  const rows = await runInDurableObject(stub(), async (_instance, state) =>
    state.storage.sql.exec("SELECT id, title, directory FROM session_v2").toArray(),
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: sessionID, title: "spike session", directory: "/tmp/project" })
})

it("runs a full prompt turn against a fake provider and reads the durable log", async () => {
  mockLLM()
  await timed("boot before turn", () => request("/api/health"))
  const sessionID = await createSession()

  await timed("full fake turn (prompt + wait)", async () => {
    const prompt = await request(`/api/session/${sessionID}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text: "Say hello" }),
    })
    expect(prompt.status).toBe(200)
    const pending = (await prompt.json()) as { data: { type: string } }
    expect(pending.data.type).toBe("user")

    const wait = await request(`/api/session/${sessionID}/wait`, { method: "POST" })
    expect(wait.status).toBe(204)
  })

  const messages = await runInDurableObject(stub(), async (_instance, state) =>
    state.storage.sql
      .exec("SELECT id, type FROM session_message WHERE session_id = ? ORDER BY seq", sessionID)
      .toArray(),
  )
  console.log(`[info] session_message rows: ${JSON.stringify(messages)}`)
  const types = messages.map((row) => row.type)
  expect(types).toContain("user")
  expect(types).toContain("assistant")

  const events = await runInDurableObject(stub(), async (_instance, state) =>
    state.storage.sql.exec("SELECT count(*) AS count FROM event WHERE aggregate_id = ?", sessionID).one(),
  )
  expect(Number(events.count)).toBeGreaterThan(0)

  // Durable log over the cursor route (non-follow): SSE body that ends once
  // the reader catches up with the aggregate sequence.
  const items = await timed("session log read", () => readLog(sessionID))
  console.log(`[info] durable log events: ${JSON.stringify(items.map((item) => item.type))}`)
  const eventTypes = items.map((item) => item.type)
  expect(eventTypes).toContain("session.input.admitted")
  expect(eventTypes).toContain("session.text.ended")
  expect(eventTypes).toContain("session.execution.succeeded")
  expect(eventTypes).toContain("log.synced")
})

// A5 question 1 (ack-then-continue): the Slack flow returns the prompt request
// immediately and lets the turn continue inside the DO with no request held
// open. The turn runs on the coordinator's background fiber in the app layer
// runtime; under workerd an actor (Durable Object) owns one long-lived
// IoContext spanning requests, so pending work started during one request may
// keep running after its response is sent. This test proves the turn completes
// with NO request in flight: prompt, return, sleep (no polling), then read.
it("completes a turn in the background after the prompt request has returned", async () => {
  mockLLM()
  await request("/api/health")
  const sessionID = await createSession()

  const promptReturned = Date.now()
  const prompt = await request(`/api/session/${sessionID}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text: "Say hello in the background" }),
  })
  expect(prompt.status).toBe(200)
  // No /wait, no polling: nothing touches the DO while the turn runs.
  await sleep(1_000)

  const items = await readLog(sessionID)
  const eventTypes = items.map((item) => item.type)
  console.log(`[info] background turn events: ${JSON.stringify(eventTypes)}`)
  console.log(`[timing] background turn observed complete ${Date.now() - promptReturned}ms after prompt returned`)
  expect(eventTypes).toContain("session.execution.succeeded")

  const messages = await runInDurableObject(stub(), async (_instance, state) =>
    state.storage.sql
      .exec("SELECT type FROM session_message WHERE session_id = ? ORDER BY seq", sessionID)
      .toArray()
      .map((row) => row.type),
  )
  expect(messages).toEqual(["user", "assistant"])
})

// Eviction mid-turn + durable log integrity: kill the DO instance between
// prompt-accepted and turn-complete via DurableObjectState.abort(), then let a
// fresh instance boot over the SAME persisted storage. Starting a turn writes
// a durable execution claim, and the workerd profile resumes claimed Sessions
// on boot, so the orphaned turn must replay from durable history and complete;
// a log consumer that checkpointed a cursor pre-eviction must be able to
// continue without gaps or duplicates.
it("recovers an evicted mid-turn session by replay on the next boot", async () => {
  mockLLM()
  // Hold the slow provider's first call open long enough to evict mid-call,
  // then serve the replayed call instantly.
  completions(SLOW_LLM_ORIGIN).delay(60_000)
  completions(SLOW_LLM_ORIGIN).persist()

  await request("/api/health")
  const sessionID = await createSession({ providerID: "slow", id: "slow-model" })

  const prompt = await request(`/api/session/${sessionID}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text: "Say hello before the eviction" }),
  })
  expect(prompt.status).toBe(200)

  // Wait for the turn to pass admission and promotion: the pending row is
  // consumed and the user message is projected, so the eviction lands inside
  // the in-flight model call — the representative mid-turn point where no
  // pending row is left to mark the unfinished work.
  const snapshot = async () =>
    runInDurableObject(stub(), async (_instance, state) => ({
      messages: state.storage.sql
        .exec("SELECT type FROM session_message WHERE session_id = ? ORDER BY seq", sessionID)
        .toArray()
        .map((row) => row.type),
      pending: Number(state.storage.sql.exec("SELECT count(*) AS count FROM session_pending").one().count),
      suspended: state.storage.sql.exec("SELECT time_suspended FROM session_v2 WHERE id = ?", sessionID).one()
        .time_suspended,
    }))
  const promotedBy = Date.now() + 5_000
  while ((await snapshot()).messages.length === 0 && Date.now() < promotedBy) await sleep(50)
  const before = await snapshot()
  console.log(`[info] state before eviction: ${JSON.stringify(before)}`)
  expect(before.messages).toEqual(["user"])
  expect(before.pending).toBe(0)
  // The write-ahead claim: Started committed the marker, so this hard death
  // leaves durable evidence of the in-flight turn.
  expect(before.suspended).not.toBeNull()

  // A consumer checkpoints its durable log cursor before the eviction.
  const preEviction = await readLog(sessionID)
  const cursor = Math.max(...preEviction.map(seqOf))
  console.log(`[info] pre-eviction log: ${JSON.stringify(preEviction.map((item) => [seqOf(item), item.type]))}`)

  // Evict: forcibly reset the Durable Object instance. Storage survives; the
  // in-flight model call and every fiber in the app layer die with the isolate.
  await runInDurableObject(stub(), async (_instance, state) => {
    state.abort("simulated eviction")
  }).then(
    () => {
      throw new Error("abort() should break the instance")
    },
    (error) => console.log(`[info] abort outcome: ${error}`),
  )

  // A fresh instance boots over the same persisted storage; boot resumes the
  // claimed execution, which replays the drain from durable history.
  const health = await timed("boot after eviction", () => request("/api/health"))
  expect(health.status).toBe(200)

  // Resuming injects a synthetic continuation message ("the server restarted
  // while you were working") ahead of the replayed drain, so a recovered turn
  // settles as user -> synthetic -> assistant.
  const recoveredBy = Date.now() + 10_000
  while ((await snapshot()).messages.length < 3 && Date.now() < recoveredBy) await sleep(50)
  const after = await snapshot()
  console.log(`[info] state after recovery: ${JSON.stringify(after)}`)
  expect(after.messages).toEqual(["user", "synthetic", "assistant"])
  expect(after.pending).toBe(0)
  // The claim is consumed: settled executions leave no marker behind.
  expect(after.suspended).toBeNull()

  // Question 3: the full log replays a consistent, strictly gapless sequence...
  const full = await readLog(sessionID)
  const fullSeqs = full.filter((item) => item.type !== "log.synced").map(seqOf)
  console.log(`[info] post-recovery log: ${JSON.stringify(full.map((item) => [seqOf(item), item.type]))}`)
  expect(fullSeqs).toEqual(Array.from({ length: fullSeqs.length }, (_, index) => index + 1))
  const fullTypes = full.map((item) => item.type)
  expect(fullTypes).toContain("session.execution.succeeded")
  expect(fullTypes).toContain("session.text.ended")

  // ...and a consumer resuming from its pre-eviction checkpoint sees exactly
  // the events after its cursor: no gaps, no duplicates.
  const resumed = await readLog(sessionID, cursor)
  const resumedSeqs = resumed.filter((item) => item.type !== "log.synced").map(seqOf)
  expect(resumedSeqs[0]).toBe(cursor + 1)
  expect(resumedSeqs).toEqual(fullSeqs.slice(fullSeqs.indexOf(cursor + 1)))

  // The recovered session stays usable: one more full turn on the same session.
  const followUp = await request(`/api/session/${sessionID}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text: "Say hello after the recovery" }),
  })
  expect(followUp.status).toBe(200)
  const wait = await request(`/api/session/${sessionID}/wait`, { method: "POST" })
  expect(wait.status).toBe(204)
  expect((await snapshot()).messages).toEqual(["user", "synthetic", "assistant", "user", "assistant"])
})
