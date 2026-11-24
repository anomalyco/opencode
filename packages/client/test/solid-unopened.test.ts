import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo, type SessionMessageInfo } from "../src/promise"

const sessionID = "ses_quiet"
const model = { id: "model", providerID: "provider" }
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const info: SessionInfo = {
  id: sessionID,
  projectID: "project",
  cost: 0,
  tokens,
  time: { created: 0, updated: 0 },
  location: { directory: "/project" },
}

// One run of a session, as its events arrive: a prompt is delivered, a first step writes text and calls a tool, a
// second step answers, and the run ends.
function run(sessionID = "ses_quiet") {
  let seq = 0
  const durable = () => ({ aggregateID: sessionID, seq: ++seq, version: 1 as const })
  const at = () => ({ id: `evt_${seq + 1}`, created: seq + 1 })
  const step = (assistantMessageID: string) => ({ sessionID, assistantMessageID })

  const prompt: OpenCodeEvent[] = [
    {
      ...at(),
      type: "session.inbox.enqueued",
      durable: durable(),
      data: { sessionID, inboxID: "msg_prompt", item: { type: "user", delivery: "steer", payload: { text: "Go" } } },
    },
    { ...at(), type: "session.execution.started", durable: durable(), data: { sessionID } },
    { ...at(), type: "session.inbox.delivered", durable: durable(), data: { sessionID, inboxID: "msg_prompt" } },
  ]

  const first: OpenCodeEvent[] = [
    {
      ...at(),
      type: "session.step.started",
      durable: durable(),
      data: { ...step("msg_step_1"), agent: "build", model, started: 10 },
    },
    { ...at(), type: "session.text.started", durable: durable(), data: { ...step("msg_step_1"), ordinal: 0 } },
    { ...at(), type: "session.text.ended", durable: durable(), data: { ...step("msg_step_1"), ordinal: 0, text: "Hello" } },
    {
      ...at(),
      type: "session.tool.input.started",
      durable: durable(),
      data: { ...step("msg_step_1"), id: "call_1", name: "shell" },
    },
    {
      ...at(),
      type: "session.tool.called",
      durable: durable(),
      data: { ...step("msg_step_1"), id: "call_1", input: { command: "bun test" }, executed: true },
    },
  ]

  const settle: OpenCodeEvent[] = [
    {
      ...at(),
      type: "session.tool.success",
      durable: durable(),
      data: {
        ...step("msg_step_1"),
        id: "call_1",
        content: [{ type: "text", text: "ok" }],
        metadata: {},
        executed: true,
      },
    },
    {
      ...at(),
      type: "session.step.ended",
      durable: durable(),
      data: { ...step("msg_step_1"), finish: "tool-calls", cost: 0, tokens },
    },
  ]

  const second: OpenCodeEvent[] = [
    {
      ...at(),
      type: "session.step.started",
      durable: durable(),
      data: { ...step("msg_step_2"), agent: "build", model, started: 20 },
    },
    { ...at(), type: "session.text.started", durable: durable(), data: { ...step("msg_step_2"), ordinal: 0 } },
    { ...at(), type: "session.text.ended", durable: durable(), data: { ...step("msg_step_2"), ordinal: 0, text: "Done" } },
  ]

  const end: OpenCodeEvent[] = [
    {
      ...at(),
      type: "session.step.ended",
      durable: durable(),
      data: { ...step("msg_step_2"), finish: "stop", cost: 0, tokens },
    },
    { ...at(), type: "session.execution.succeeded", durable: durable(), data: { sessionID } },
  ]

  return { prompt, first, settle, second, end }
}

// The newest page as the server had it while the first step ran: the tool is still running there.
const page: SessionMessageInfo[] = [
  { id: "msg_earlier", type: "user", text: "Earlier", time: { created: 1 } },
  { id: "msg_prompt", type: "user", text: "Go", time: { created: 3 } },
  {
    id: "msg_step_1",
    type: "assistant",
    agent: "build",
    model,
    content: [
      { type: "text", text: "Hello" },
      {
        type: "tool",
        id: "call_1",
        name: "shell",
        time: { created: 7, ran: 8 },
        state: { status: "running", input: { command: "bun test" }, metadata: {} },
      },
    ],
    time: { created: 10 },
  },
]

function fixture(messages?: () => Response | Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const reads: string[] = []

  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const url = new URL((input instanceof Request ? input : new Request(input, init)).url)

      if (url.pathname.endsWith("/message")) {
        reads.push(url.pathname)

        return (await messages?.()) ?? Response.json({ data: [], cursor: {} })
      }

      if (url.pathname === `/api/session/${sessionID}`) return Response.json({ data: info })

      if (url.pathname === "/api/session/active") return Response.json({ data: {} })

      if (url.pathname === "/api/location") return Response.json({ directory: "/project" })

      return Response.json({ data: [] })
    },
  })

  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)

          return () => listeners.delete(handler)
        },
      },
      onError: () => {},
    })

    return {
      data,
      reads,
      dispose,
      emit: (events: OpenCodeEvent[]) =>
        events.forEach((event) => listeners.forEach((listener) => listener({ name: event.type, details: event }))),
      stored: () => data.session.message.list(sessionID).map((item) => item.id),
    }
  })
}

// Each session the server streams used to grow a transcript here, whether or not anything read it.
test("sessions nobody opened store the step each runs, and nothing once their runs end", () => {
  const setup = fixture()
  const sessions = [sessionID, "ses_quiet_2", "ses_quiet_3"]
  const runs = sessions.map((id) => run(id))

  // The lists that hold a message, and the messages in them.
  const count = () => {
    const lists = sessions.map((id) => setup.data.session.message.list(id)).filter((list) => list.length > 0)

    return { lists: lists.length, messages: lists.reduce((sum, list) => sum + list.length, 0) }
  }

  try {
    setup.emit(runs.flatMap((events) => [...events.prompt, ...events.first]))
    const during = count()
    // A permission prompt in the root's view shows the call that asks, from this message.
    const asking = setup.data.session.message.get(sessionID, "msg_step_1")
    setup.emit(runs.flatMap((events) => [...events.settle, ...events.second]))
    const next = setup.stored()
    setup.emit(runs.flatMap((events) => events.end))
    expect({ during, next, after: count() }).toEqual({
      during: { lists: 3, messages: 3 },
      next: ["msg_step_2"],
      after: { lists: 0, messages: 0 },
    })
    expect(asking?.type === "assistant" ? asking.content.at(-1) : undefined).toMatchObject({
      id: "call_1",
      state: { input: { command: "bun test" } },
    })
    expect(setup.reads).toEqual([])
  } finally {
    setup.dispose()
  }
})

test("a session that is open stores every message of its run", async () => {
  const setup = fixture()
  const events = run()

  try {
    await setup.data.session.message.sync(sessionID)
    setup.emit([...events.prompt, ...events.first, ...events.settle, ...events.second, ...events.end])
    expect(setup.data.session.message.list(sessionID).map((item) => item.type)).toEqual([
      "user",
      "assistant",
      "assistant",
      "idle",
    ])
  } finally {
    setup.dispose()
  }
})

// The page is read while the session runs. What events built from its start is newer than the page's copy, and
// what arrived after the page was read is not in it at all.
test.each(["made while connected", "known before"] as const)(
  "a session %s that is opened later shows its newest page and then follows its events",
  async (origin) => {
    const response = Promise.withResolvers<Response>()
    const setup = fixture(() => response.promise)
    const events = run()

    try {
      if (origin === "made while connected")
        setup.emit([
          {
            id: "evt_created",
            created: 0,
            type: "session.created",
            durable: { aggregateID: sessionID, seq: 0, version: 1 },
            data: { sessionID, projectID: info.projectID, location: info.location },
          },
        ])
      setup.emit([...events.prompt, ...events.first])
      const reading = setup.data.session.message.sync(sessionID)
      setup.emit([...events.settle, ...events.second])
      response.resolve(Response.json({ data: page.toReversed(), cursor: { next: "older" } }))
      await reading

      const step = setup.data.session.message.get(sessionID, "msg_step_1")
      expect({
        stored: setup.stored(),
        tool: step?.type === "assistant" ? step.content.at(-1) : undefined,
        completed: step?.type === "assistant" ? step.time.completed !== undefined : undefined,
        more: setup.data.session.message.more(sessionID),
        reads: setup.reads.length,
      }).toMatchObject({
        stored: ["msg_earlier", "msg_prompt", "msg_step_1", "msg_step_2"],
        tool: { id: "call_1", state: { status: "completed" } },
        completed: true,
        more: true,
        reads: 1,
      })

      setup.emit(events.end)
      expect(setup.data.session.message.list(sessionID).map((item) => item.type)).toEqual([
        "user",
        "user",
        "assistant",
        "assistant",
        "idle",
      ])
    } finally {
      response.resolve(Response.json({ data: [], cursor: {} }))
      setup.dispose()
    }
  },
)

// A session this client prompted stores its events without a read. It may hold more than a page by the time it is
// read; the messages before the page are then the cursor's, not rows after it.
test("a first read after more than a page of events keeps the page's order", async () => {
  const response = Promise.withResolvers<Response>()
  const setup = fixture(() => response.promise)
  const events = run()

  try {
    await setup.data.session.prompt({ sessionID, id: "msg_prompt", text: "Go" })
    setup.emit([...events.prompt, ...events.first, ...events.settle, ...events.second, ...events.end])
    const newest = setup.data.session.message.list(sessionID).slice(-2)
    const reading = setup.data.session.message.sync(sessionID)
    response.resolve(Response.json({ data: JSON.parse(JSON.stringify(newest.toReversed())), cursor: { next: "older" } }))
    await reading
    expect({ stored: setup.stored(), more: setup.data.session.message.more(sessionID) }).toEqual({
      stored: newest.map((item) => item.id),
      more: true,
    })
  } finally {
    response.resolve(Response.json({ data: [], cursor: {} }))
    setup.dispose()
  }
})

// After a reconnect the step may have missed events. It stays for a permission prompt, and a page that is read when
// the session is opened is the newer copy, also of a step that still runs.
test.each([
  { name: "is trusted over the page while the stream held", reconnect: false, text: "Hello" },
  { name: "gives way to the page after a reconnect", reconnect: true, text: "From the page" },
])("the step of a session nobody opened $name", async (item) => {
  const setup = fixture(() =>
    Response.json({
      data: [
        {
          id: "msg_step_1",
          type: "assistant",
          agent: "build",
          model,
          content: [{ type: "text", text: "From the page" }],
          time: { created: 10 },
        },
      ],
      cursor: {},
    }),
  )

  const events = run()

  try {
    setup.emit([...events.prompt, ...events.first])
    if (item.reconnect) setup.emit([{ id: "evt_connected", type: "server.connected", data: {} }])
    const kept = setup.stored()
    await setup.data.session.message.sync(sessionID)
    const step = setup.data.session.message.get(sessionID, "msg_step_1")
    expect({ kept, first: step?.type === "assistant" ? step.content[0] : undefined }).toEqual({
      kept: ["msg_step_1"],
      first: { type: "text", text: item.text },
    })
  } finally {
    setup.dispose()
  }
})
