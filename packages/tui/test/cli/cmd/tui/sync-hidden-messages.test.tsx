/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent, Message } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hidden"
const session = {
  id: sessionID,
  title: "hidden",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory: "/tmp/opencode/packages/opencode",
}

const id = (index: number) => `msg_${String(index).padStart(4, "0")}`

function message(index: number): Message {
  if (index % 2 === 0)
    return {
      id: id(index),
      sessionID,
      role: "user",
      agent: "build",
      model: { providerID: "test", modelID: "model" },
      time: { created: 1000 + index },
    }
  return {
    id: id(index),
    sessionID,
    role: "assistant",
    agent: "build",
    modelID: "model",
    providerID: "test",
    mode: "build",
    parentID: id(index - 1),
    path: { cwd: session.directory, root: session.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1000 + index, completed: 1000 + index },
  }
}

// Serves GET /session/:id/message the way the server pages it: newest `limit`
// by default, oldest with order=asc, strictly older/newer than a message ID.
function serve(count: number, requests: URL[] = []) {
  const all = Array.from({ length: count }, (_, index) => ({ info: message(index), parts: [] }))
  return (url: URL) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname !== `/session/${sessionID}/message`) return undefined
    requests.push(url)
    const limit = Number(url.searchParams.get("limit") ?? 0)
    const before = url.searchParams.get("before")
    const after = url.searchParams.get("after")
    if (!limit) return json(all)
    const items = after
      ? all.filter((item) => item.info.id > after).slice(0, limit)
      : url.searchParams.get("order") === "asc"
        ? all.slice(0, limit)
        : all.filter((item) => !before || item.info.id < before).slice(-limit)
    return json(items, { headers: { "x-total-count": String(all.length) } })
  }
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

const ids = (messages: Message[]) => messages.map((item) => Number(item.id.slice(4)))
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index)

test("a cropped session keeps its first prompt above the hidden gap", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, sync } = await mount(serve(60), tmp.path, { transcript: { max_messages: 3 } })
  try {
    await sync.session.sync(sessionID)
    expect(ids(sync.data.message[sessionID])).toEqual([0, 57, 58, 59])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 1, count: 56 })
  } finally {
    app.renderer.destroy()
  }
})

test("keep_first_prompt off crops from the top only", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const requests: URL[] = []
  const { app, sync } = await mount(serve(60, requests), tmp.path, {
    transcript: { max_messages: 3, keep_first_prompt: false },
  })
  try {
    await sync.session.sync(sessionID)
    expect(ids(sync.data.message[sessionID])).toEqual([57, 58, 59])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 0, count: 57 })
    expect(requests.some((url) => url.searchParams.get("order") === "asc")).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("an uncropped session asks for nothing beyond its page", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const requests: URL[] = []
  const { app, sync } = await mount(serve(5, requests), tmp.path, { transcript: { max_messages: 10 } })
  try {
    await sync.session.sync(sessionID)
    expect(ids(sync.data.message[sessionID])).toEqual(range(0, 5))
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 0, count: 0 })
    expect(requests).toHaveLength(1)
  } finally {
    app.renderer.destroy()
  }
})

test("loading below then above fills the gap from both edges", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const requests: URL[] = []
  const { app, sync } = await mount(serve(60, requests), tmp.path, { transcript: { max_messages: 3 } })
  try {
    await sync.session.sync(sessionID)

    await sync.session.load(sessionID, "below")
    expect(requests.at(-1)?.searchParams.get("before")).toBe(id(57))
    expect(ids(sync.data.message[sessionID])).toEqual([0, ...range(7, 60)])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 1, count: 6 })

    await sync.session.load(sessionID, "above")
    expect(requests.at(-1)?.searchParams.get("after")).toBe(id(0))
    expect(ids(sync.data.message[sessionID])).toEqual(range(0, 60))
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 0, count: 0 })
  } finally {
    app.renderer.destroy()
  }
})

test("a 100-message page loads 100 from the edge it names", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const requests: URL[] = []
  const { app, sync } = await mount(serve(300, requests), tmp.path, { transcript: { max_messages: 3 } })
  try {
    await sync.session.sync(sessionID)

    await sync.session.load(sessionID, "below", 100)
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("100")
    expect(ids(sync.data.message[sessionID])).toEqual([0, ...range(197, 300)])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 1, count: 196 })

    await sync.session.load(sessionID, "above", 100)
    expect(ids(sync.data.message[sessionID])).toEqual([...range(0, 101), ...range(197, 300)])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 101, count: 96 })
  } finally {
    app.renderer.destroy()
  }
})

test("loading above without a pinned prompt starts from the session's oldest message", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const requests: URL[] = []
  const { app, sync } = await mount(serve(60, requests), tmp.path, {
    transcript: { max_messages: 3, keep_first_prompt: false },
  })
  try {
    await sync.session.sync(sessionID)
    await sync.session.load(sessionID, "above")
    expect(requests.at(-1)?.searchParams.get("order")).toBe("asc")
    expect(ids(sync.data.message[sessionID])).toEqual([...range(0, 50), 57, 58, 59])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 50, count: 7 })
  } finally {
    app.renderer.destroy()
  }
})

test("new messages hide the oldest recent message, never the pinned prompt", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(serve(60), tmp.path, { transcript: { max_messages: 3 } })
  try {
    await sync.session.sync(sessionID)
    emit(global({ id: "evt_new", type: "message.updated", properties: { sessionID, info: message(60) } }))
    await wait(() => sync.data.message[sessionID].at(-1)?.id === id(60))
    expect(ids(sync.data.message[sessionID])).toEqual([0, 58, 59, 60])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 1, count: 57 })

    // A hidden message being updated must stay hidden rather than reappear in the gap.
    emit(global({ id: "evt_old", type: "message.updated", properties: { sessionID, info: message(30) } }))
    emit(global({ id: "evt_new2", type: "message.updated", properties: { sessionID, info: message(61) } }))
    await wait(() => sync.data.message[sessionID].at(-1)?.id === id(61))
    expect(ids(sync.data.message[sessionID])).toEqual([0, 59, 60, 61])
  } finally {
    app.renderer.destroy()
  }
})

test("an uncropped session starts pinning its first prompt once it outgrows the limit", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(serve(3), tmp.path, { transcript: { max_messages: 3 } })
  try {
    await sync.session.sync(sessionID)
    emit(global({ id: "evt_3", type: "message.updated", properties: { sessionID, info: message(3) } }))
    await wait(() => sync.data.message[sessionID].at(-1)?.id === id(3))
    expect(ids(sync.data.message[sessionID])).toEqual([0, 1, 2, 3])
    emit(global({ id: "evt_4", type: "message.updated", properties: { sessionID, info: message(4) } }))
    await wait(() => sync.data.message[sessionID].at(-1)?.id === id(4))
    expect(ids(sync.data.message[sessionID])).toEqual([0, 2, 3, 4])
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 1, count: 1 })
  } finally {
    app.renderer.destroy()
  }
})

test("loading all keeps every later message loaded too", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(serve(60), tmp.path, { transcript: { max_messages: 3 } })
  try {
    await sync.session.sync(sessionID)
    await sync.session.load(sessionID, "all")
    expect(ids(sync.data.message[sessionID])).toEqual(range(0, 60))
    expect(sync.session.hidden(sessionID)).toMatchObject({ head: 0, count: 0 })

    emit(global({ id: "evt_new", type: "message.updated", properties: { sessionID, info: message(60) } }))
    await wait(() => sync.data.message[sessionID].at(-1)?.id === id(60))
    expect(ids(sync.data.message[sessionID])).toEqual(range(0, 61))
  } finally {
    app.renderer.destroy()
  }
})
