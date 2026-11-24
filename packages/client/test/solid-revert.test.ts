import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import {
  OpenCode,
  type OpenCodeEvent,
  type SessionInboxItem,
  type SessionInfo,
  type SessionMessageInfo,
} from "../src/promise"

const sessionID = "ses_revert"

const note = (id: string): SessionMessageInfo => ({ id, type: "user", text: id, time: { created: 1 } })

const notes = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => note(`msg_${String(first + index).padStart(3, "0")}`))

const id = (number: number) => notes(number, number)[0]!.id

// The session as the server has it while a revert is staged at `boundary`.
const staged = (boundary: string): SessionInfo => ({
  id: sessionID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  location: { directory: "/project" },
  revert: { messageID: boundary },
})

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

test("a committed revert at the oldest loaded message reads the transcript again", async () => {
  const setup = fixture(notes(1, 40))
  try {
    await setup.data.session.message.sync(sessionID)
    expect(setup.ids()).toEqual(notes(21, 40).map((message) => message.id))

    setup.server.messages = notes(1, 20)
    setup.emit(committed(id(21)))
    // No loaded message came before the boundary, and the cursor named one that is gone.
    expect(setup.ids()).toEqual([])
    expect(setup.data.session.message.more(sessionID)).toBe(false)
    // Joins the read that the revert started.
    await setup.data.session.message.sync(sessionID)

    expect(setup.ids()).toEqual(notes(1, 20).map((message) => message.id))
    expect(setup.server.requests).toEqual(["message?limit=20&order=desc", "message?limit=20&order=desc"])
  } finally {
    setup.dispose()
  }
})

test("a committed revert whose boundary may be in an older page keeps what is loaded until it is read again", async () => {
  const setup = fixture(notes(1, 40))
  try {
    setup.data.session.remember(staged(id(10)))
    await setup.data.session.message.sync(sessionID)
    const loaded = notes(21, 40).map((message) => message.id)

    setup.server.messages = notes(1, 9)
    setup.emit(committed(id(10)))
    // Only the server knows whether these messages came after the boundary. They stay, and the pointer that hides
    // them stays, until the read lands.
    expect(setup.ids()).toEqual(loaded)
    expect(setup.data.session.get(sessionID)?.revert?.messageID).toBe(id(10))
    // Joins the read that the revert started.
    await setup.data.session.message.sync(sessionID)

    expect(setup.ids()).toEqual(notes(1, 9).map((message) => message.id))
    expect(setup.data.session.get(sessionID)?.revert).toBeUndefined()
    expect(setup.server.requests).toEqual(["message?limit=20&order=desc", "message?limit=20&order=desc"])
  } finally {
    setup.dispose()
  }
})

test("a read that applied a committed revert clears the pointer, and the late event changes nothing", async () => {
  const setup = fixture(notes(1, 40))
  try {
    setup.data.session.remember(staged(id(31)))
    await setup.data.session.message.sync(sessionID)

    // The server committed the revert. This read holds the message before the boundary and not the boundary.
    setup.server.messages = notes(1, 30)
    setup.data.session.message.invalidate(sessionID)
    await setup.data.session.message.sync(sessionID)
    const left = notes(11, 30).map((message) => message.id)
    expect(setup.ids()).toEqual(left)
    expect(setup.data.session.get(sessionID)?.revert).toBeUndefined()

    setup.emit(committed(id(31)))
    expect(setup.ids()).toEqual(left)
    expect(setup.data.session.message.more(sessionID)).toBe(true)
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
