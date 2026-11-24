import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInboxItem, type SessionMessageInfo } from "../src/promise"

const sessionID = "ses_revert"

const note = (id: string): SessionMessageInfo => ({ id, type: "user", text: id, time: { created: 1 } })

const notes = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => note(`msg_${String(first + index).padStart(3, "0")}`))

const waiting = (id: string): SessionInboxItem => ({
  id,
  sessionID,
  type: "user",
  delivery: "queue",
  time: { created: 1 },
  payload: { text: id },
})

// A server whose transcript and inbox a test changes between reads. Pages follow the server's rules: newest first, and
// a cursor names the message that a page continues from.
function fixture(messages: SessionMessageInfo[]) {
  const server: { messages: SessionMessageInfo[]; inbox: SessionInboxItem[]; requests: string[] } = {
    messages,
    inbox: [],
    requests: [],
  }
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const url = new URL((input instanceof Request ? input : new Request(input, init)).url)
      const path = url.pathname.replace(`/api/session/${sessionID}/`, "")
      server.requests.push(path + decodeURIComponent(url.search))
      if (path === "inbox") return Response.json({ data: server.inbox })
      const cursor = url.searchParams.get("cursor")
      const end = cursor ? server.messages.findIndex((message) => message.id === cursor) : server.messages.length
      const page = server.messages.slice(Math.max(0, end - Number(url.searchParams.get("limit"))), end).toReversed()
      return Response.json({ data: page, cursor: page.length > 0 ? { next: page.at(-1)?.id } : {} })
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
    })
    return {
      data,
      server,
      ids: () => data.session.message.list(sessionID).map((message) => message.id),
      emit: (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event })),
      dispose,
    }
  })
}

const committed = (to: string): OpenCodeEvent => ({
  id: "evt_committed",
  type: "session.revert.committed",
  created: 9,
  durable: { aggregateID: sessionID, seq: 9, version: 1 },
  data: { sessionID, to },
})

const enqueued = (item: SessionInboxItem, seq: number): OpenCodeEvent => ({
  id: `evt_enqueued_${seq}`,
  type: "session.inbox.enqueued",
  created: seq,
  durable: { aggregateID: sessionID, seq, version: 1 },
  data: { sessionID, inboxID: item.id, item: { type: item.type, delivery: item.delivery, payload: item.payload } },
})

test("a committed revert removes the boundary message and those after it, whatever their IDs sort like", async () => {
  // A scheduled prompt sorts after every later message, and a prompt sent before its turn ended sorts before it.
  const setup = fixture([note("msg_sch_first"), note("msg_010"), note("msg_030"), note("msg_020"), note("msg_040")])
  try {
    await setup.data.session.message.sync(sessionID)
    setup.emit(committed("msg_030"))

    expect(setup.ids()).toEqual(["msg_sch_first", "msg_010"])
    // The boundary was loaded, so nothing is read again.
    expect(setup.server.requests).toEqual(["message?limit=20&order=desc"])
  } finally {
    setup.dispose()
  }
})

test.each([
  { name: "is not loaded", boundary: 10 },
  { name: "is the oldest loaded message", boundary: 21 },
])("a committed revert whose boundary $name reads the transcript again", async (item) => {
  const setup = fixture(notes(1, 40))
  try {
    await setup.data.session.message.sync(sessionID)
    expect(setup.ids()).toEqual(notes(21, 40).map((message) => message.id))

    setup.server.messages = notes(1, item.boundary - 1)
    setup.emit(committed(notes(item.boundary, item.boundary)[0]!.id))
    // No loaded message came before the boundary, and the cursor named one that is gone.
    expect(setup.ids()).toEqual([])
    expect(setup.data.session.message.more(sessionID)).toBe(false)
    // Joins the read that the revert started.
    await setup.data.session.message.sync(sessionID)

    expect(setup.ids()).toEqual(setup.server.messages.slice(-20).map((message) => message.id))
    expect(setup.server.requests).toEqual(["message?limit=20&order=desc", "message?limit=20&order=desc"])
  } finally {
    setup.dispose()
  }
})

test("a committed revert that a read already applied removes nothing from a whole transcript", async () => {
  const setup = fixture(notes(1, 5))
  try {
    await setup.data.session.message.sync(sessionID)
    // The page before the oldest message is empty, so no older message is left to load.
    await setup.data.session.message.loadMore(sessionID)
    expect(setup.data.session.message.more(sessionID)).toBe(false)

    // The session no longer has the boundary: the transcript that was read is the one the revert left.
    setup.emit(committed("msg_006"))

    expect(setup.ids()).toEqual(notes(1, 5).map((message) => message.id))
    expect(setup.server.requests).toEqual(["message?limit=20&order=desc", "message?limit=20&cursor=msg_001"])
  } finally {
    setup.dispose()
  }
})

test("a committed revert keeps a waiting input that came before the boundary, and reads the inbox again", async () => {
  const early = waiting("msg_900_early")
  const late = waiting("msg_050_late")
  const setup = fixture(notes(1, 2))
  try {
    await setup.data.session.message.sync(sessionID)
    await setup.data.session.pending.sync(sessionID)
    setup.emit(enqueued(early, 3))
    setup.emit({
      id: "evt_100",
      type: "session.synthetic",
      created: 4,
      durable: { aggregateID: sessionID, seq: 4, version: 1 },
      data: { sessionID, text: "Boundary" },
    })
    setup.emit(enqueued(late, 5))
    expect(setup.ids()).toEqual(["msg_001", "msg_002", "msg_900_early", "msg_100", "msg_050_late"])

    // The server keeps what was enqueued before the boundary.
    setup.server.inbox = [early]
    setup.emit(committed("msg_100"))
    expect(setup.ids()).toEqual(["msg_001", "msg_002", "msg_900_early"])
    expect(setup.data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["msg_900_early"])
    // Joins the read that the revert started.
    await setup.data.session.pending.sync(sessionID)

    expect(setup.data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["msg_900_early"])
    expect(setup.ids()).toEqual(["msg_001", "msg_002", "msg_900_early"])
    expect(setup.server.requests).toEqual(["message?limit=20&order=desc", "inbox", "inbox"])
  } finally {
    setup.dispose()
  }
})
