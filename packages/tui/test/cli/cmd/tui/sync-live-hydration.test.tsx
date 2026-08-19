/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hydration_race"
const messageID = "msg_hydration_race"
const partID = "prt_hydration_race"
const session = {
  id: sessionID,
  slug: "race",
  projectID: "proj_test",
  title: "race",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory: "/tmp/opencode/packages/opencode",
}
const assistant = {
  id: messageID,
  sessionID,
  role: "assistant" as const,
  agent: "build",
  modelID: "model",
  providerID: "test",
  mode: "build",
  parentID: "msg_user",
  path: { cwd: session.directory, root: session.directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, completed: 2 },
}
const olderLink = (before: string) => `<http://localhost/session/${sessionID}/message?before=${before}>; rel="next"`
const newerLink = (after: string) => `<http://localhost/session/${sessionID}/message?after=${after}>; rel="prev"`

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

test("session deletion clears the hydrated message window", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const part = { id: partID, sessionID, messageID, type: "text" as const, text: "hello" }
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`)
      return json([{ info: assistant, parts: [part], cursor: "cursor_message" }])
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    expect(sync.data.message[sessionID]?.map((message) => message.id)).toEqual([messageID])
    expect(sync.data.part[messageID]).toEqual([part])
    expect(sync.data.message_page[sessionID]).toBeDefined()

    emit(global({ id: "evt_delete", type: "session.deleted", properties: { sessionID, info: session } }))
    await wait(() => sync.data.message[sessionID] === undefined)

    expect(sync.data.part[messageID]).toBeUndefined()
    expect(sync.data.message_cursor[messageID]).toBeUndefined()
    expect(sync.data.message_page[sessionID]).toBeUndefined()
    expect(sync.data.todo[sessionID]).toBeUndefined()
    expect(sync.data.session_diff[sessionID]).toBeUndefined()

    emit(
      global({
        id: "evt_late_message",
        type: "message.updated",
        properties: { sessionID, info: { ...assistant, id: "msg_late" } },
      }),
    )
    emit(
      global({
        id: "evt_late_status",
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      }),
    )
    expect(sync.data.message[sessionID]).toBeUndefined()
    expect(sync.data.session_status[sessionID]).toBeUndefined()

    const recreated = { ...session, time: { created: 1, updated: 1 } }
    emit(global({ id: "evt_recreate", type: "session.created", properties: { sessionID, info: recreated } }))
    await wait(() => sync.session.get(sessionID)?.time.created === 1)
    expect(sync.session.get(sessionID)).toEqual(recreated)
  } finally {
    app.renderer.destroy()
  }
})

test("stale hydration cannot overwrite a recreated session with the same ID", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  const recreated = { ...session, title: "recreated", time: { created: 2, updated: 2 } }
  const staleMessage = { ...assistant, id: "msg_stale" }
  const recreatedMessage = { ...assistant, id: "msg_recreated", time: { created: 3, completed: 4 } }
  let resolveStaleMessages!: (response: Response) => void
  const staleMessages = new Promise<Response>((resolve) => {
    resolveStaleMessages = resolve
  })
  let messageRequests = 0
  let recreatedSession = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(recreatedSession ? recreated : session)
    if (url.pathname === `/session/${sessionID}/message`) {
      messageRequests += 1
      if (messageRequests === 1) return staleMessages
      return json([{ info: recreatedMessage, parts: [], cursor: "cursor_recreated" }])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const staleSync = sync.session.sync(sessionID)
    await wait(() => messageRequests === 1)

    emit(global({ id: "evt_delete", type: "session.deleted", properties: { sessionID, info: session } }))
    recreatedSession = true
    emit(global({ id: "evt_recreate", type: "session.created", properties: { sessionID, info: recreated } }))
    await wait(() => sync.session.get(sessionID)?.title === "recreated")
    await sync.session.sync(sessionID)

    resolveStaleMessages(json([{ info: staleMessage, parts: [], cursor: "cursor_stale" }]))
    await staleSync

    expect(sync.session.get(sessionID)?.title).toBe("recreated")
    expect(sync.data.message[sessionID]?.map((message) => message.id)).toEqual([recreatedMessage.id])
  } finally {
    app.renderer.destroy()
  }
})

test("live messages use creation time with an ID tie-break", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(undefined, tmp.path)
  const messages = [
    { ...assistant, id: "msg_a", time: { created: 30, completed: 31 } },
    { ...assistant, id: "msg_z", time: { created: 10, completed: 11 } },
    { ...assistant, id: "msg_m", time: { created: 20, completed: 21 } },
    { ...assistant, id: "msg_b", time: { created: 20, completed: 21 } },
  ]

  try {
    for (const info of messages) {
      emit(global({ id: `evt_${info.id}`, type: "message.updated", properties: { sessionID, info } }))
    }
    await wait(() => sync.data.message[sessionID]?.length === messages.length)

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_z", "msg_b", "msg_m", "msg_a"])
  } finally {
    app.renderer.destroy()
  }
})

test("stale session hydration does not overwrite live message parts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let requested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      requested = true
      return messages
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID, info: assistant } }))
    emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: {
          sessionID,
          time: 2,
          part: { id: partID, sessionID, messageID, type: "text", text: "visible live content" },
        },
      }),
    )
    await wait(() => sync.data.part[messageID]?.[0]?.type === "text")

    resolveMessages(
      json([
        {
          info: assistant,
          parts: [{ id: partID, sessionID, messageID, type: "text", text: "" }],
        },
      ]),
    )
    await hydrate

    expect(sync.data.part[messageID][0]).toMatchObject({ text: "visible live content" })
  } finally {
    app.renderer.destroy()
  }
})

test("orphan live deltas do not suppress hydrated parts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let requested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      requested = true
      return messages
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    emit(
      global({
        id: "evt_delta",
        type: "message.part.delta",
        properties: { sessionID, messageID, partID, field: "text", delta: "ignored until part exists" },
      }),
    )
    resolveMessages(
      json([{ info: assistant, parts: [{ id: partID, sessionID, messageID, type: "text", text: "hydrated" }] }]),
    )
    await hydrate

    expect(sync.data.part[messageID][0]).toMatchObject({ text: "hydrated" })
  } finally {
    app.renderer.destroy()
  }
})

test("orphan live part updates do not suppress hydrated parts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let requested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      requested = true
      return messages
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: {
          sessionID,
          time: 1,
          part: { id: partID, sessionID, messageID, type: "text", text: "orphan" },
        },
      }),
    )
    resolveMessages(
      json([{ info: assistant, parts: [{ id: partID, sessionID, messageID, type: "text", text: "hydrated" }] }]),
    )
    await hydrate

    expect(sync.data.part[messageID][0]).toMatchObject({ text: "hydrated" })
  } finally {
    app.renderer.destroy()
  }
})

test("stale session hydration does not overwrite a live revert update", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let requested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      requested = true
      return messages
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    const updated = { ...session, revert: { messageID: "msg_boundary" } }
    emit(global({ id: "evt_revert", type: "session.updated", properties: { sessionID, info: updated } }))
    resolveMessages(json([]))
    await hydrate

    expect(sync.session.get(sessionID)?.revert).toEqual(updated.revert)
  } finally {
    app.renderer.destroy()
  }
})

test("hydration does not clear text streamed before it starts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let requested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      requested = true
      return messages
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID, info: assistant } }))
    emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: {
          sessionID,
          time: 1,
          part: { id: partID, sessionID, messageID, type: "text", text: "" },
        },
      }),
    )
    emit(
      global({
        id: "evt_delta",
        type: "message.part.delta",
        properties: { sessionID, messageID, partID, field: "text", delta: "visible streamed content" },
      }),
    )
    await wait(() => sync.data.part[messageID]?.[0]?.type === "text" && sync.data.part[messageID][0].text !== "")
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    resolveMessages(json([{ info: assistant, parts: [{ id: partID, sessionID, messageID, type: "text", text: "" }] }]))
    await hydrate

    expect(sync.data.part[messageID][0]).toMatchObject({ text: "visible streamed content" })
  } finally {
    app.renderer.destroy()
  }
})

test("live messages trigger a fresh bounded latest page during hydration", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let loads = 0
  const live = { ...assistant, id: "msg_z_live" }
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      loads += 1
      if (loads === 1) return messages
      return json([
        ...Array.from({ length: 99 }, (_, offset) => {
          const id = `msg_${String(offset + 1).padStart(3, "0")}`
          return {
            info: { ...assistant, id },
            parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text: id }],
          }
        }),
        { info: live, parts: [] },
      ])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => loads === 1)
    emit(global({ id: "evt_live", type: "message.updated", properties: { sessionID, info: live } }))
    await wait(() => sync.data.message[sessionID]?.some((message) => message.id === live.id) ?? false)
    resolveMessages(
      json(
        Array.from({ length: 100 }, (_, index) => {
          const id = `msg_${String(index).padStart(3, "0")}`
          return {
            info: { ...assistant, id },
            parts: [{ id: `prt_${id}`, sessionID, messageID: id, type: "text", text: id }],
          }
        }),
      ),
    )
    await hydrate
    await wait(() => loads === 2)
    await wait(() => sync.data.message[sessionID]?.length === 100)

    expect(sync.data.message[sessionID]).toHaveLength(100)
    expect(sync.data.message[sessionID].at(-1)?.id).toBe(live.id)
    expect(sync.data.message[sessionID].some((message) => message.id === "msg_000")).toBe(false)
    expect(sync.data.part.msg_000).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("failed live reconciliation leaves initial hydration retryable", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let loads = 0
  const live = { ...assistant, id: "msg_live_retry", time: { created: 4 } }
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      loads += 1
      if (loads === 1) return messages
      if (loads === 2) return json({ message: "retry failed" }, { status: 500 })
      return json([{ info: live, parts: [] }])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => loads === 1)
    emit(global({ id: "evt_live", type: "message.updated", properties: { sessionID, info: live } }))
    await wait(() => sync.data.message[sessionID]?.some((message) => message.id === live.id) ?? false)
    resolveMessages(json([]))
    await hydrate
    await wait(() => loads === 2)
    await wait(() => !!sync.data.message_page[sessionID]?.error)

    await sync.session.sync(sessionID)
    await wait(() => loads === 3)

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([live.id])
  } finally {
    app.renderer.destroy()
  }
})

test("failed latest reconciliation invalidates a completed session sync", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let loads = 0
  const initial = { ...assistant, id: "msg_initial", time: { created: 1 } }
  const recovered = { ...assistant, id: "msg_recovered", time: { created: 2 } }
  const { app, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      loads += 1
      if (loads === 1) return json([{ info: initial, parts: [] }])
      if (loads === 2) return json({ message: "latest failed" }, { status: 500 })
      return json([{ info: recovered, parts: [] }])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    await sync.session.jumpToLatest(sessionID, { force: true })
    expect(sync.data.message_page[sessionID]?.error).toBeTruthy()

    await sync.session.sync(sessionID)
    await wait(() => loads === 3)

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([recovered.id])
  } finally {
    app.renderer.destroy()
  }
})

test("a message removed during hydration does not regain stale parts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let requested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      requested = true
      return messages
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID, info: assistant } }))
    await wait(() => sync.data.message[sessionID]?.length === 1)
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    emit(global({ id: "evt_removed", type: "message.removed", properties: { sessionID, messageID } }))
    await wait(() => sync.data.message[sessionID]?.length === 0)
    resolveMessages(
      json([{ info: assistant, parts: [{ id: partID, sessionID, messageID, type: "text", text: "stale" }] }]),
    )
    await hydrate

    expect(sync.data.message[sessionID]).toEqual([])
    expect(sync.data.part[messageID]).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("revert repair exposes a newer cursor when its bounded window drops messages", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  const previousUser = {
    id: "msg_previous_user",
    sessionID,
    role: "user" as const,
    agent: "build",
    model: { providerID: "test", modelID: "model" },
    time: { created: 0 },
  }
  const assistants = Array.from({ length: 150 }, (_, index) => ({
    ...assistant,
    id: `msg_gap_${String(index + 1).padStart(3, "0")}`,
    parentID: previousUser.id,
    time: { created: index + 1, completed: index + 1 },
  }))
  const boundary = {
    ...previousUser,
    id: "msg_boundary",
    time: { created: 151 },
  }
  const latestAssistant = assistants.at(-1)
  expect(latestAssistant).toBeDefined()
  if (!latestAssistant) return
  const item = (info: (typeof assistants)[number] | typeof previousUser | typeof boundary) => ({
    info,
    parts: [],
    cursor: `cursor_${info.id}`,
  })
  let newerCursor: string | undefined
  const { app, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: { messageID: boundary.id } })
    if (url.pathname === `/session/${sessionID}/message/${boundary.id}`) return json(item(boundary))
    if (url.pathname === `/session/${sessionID}/message`) {
      const before = url.searchParams.get("before")
      if (before === `cursor_${boundary.id}`)
        return json(assistants.slice(51).map(item), { headers: { link: olderLink("cursor_gap") } })
      if (before === "cursor_gap") return json([item(previousUser), ...assistants.slice(0, 51).map(item)])
      const after = url.searchParams.get("after")
      if (after) {
        newerCursor = after
        return json([item(latestAssistant)])
      }
      return json([item(boundary)])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    const page = sync.data.message_page[sessionID]
    expect(page.hasNewer).toBe(true)
    expect(page.newerCursor).toBeTruthy()

    await sync.session.loadNewer(sessionID)
    expect(newerCursor).toBe(page.newerCursor)
    expect(sync.data.message[sessionID].some((message) => message.id === latestAssistant.id)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("jump to latest preserves live messages received while the page loads", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let loads = 0
  const live = { ...assistant, id: "msg_live", time: { created: 4 } }
  let resolveLatest!: (response: Response) => void
  const latest = new Promise<Response>((resolve) => {
    resolveLatest = resolve
  })
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      loads += 1
      if (loads === 1)
        return json([{ info: { ...assistant, id: "msg_old" }, parts: [] }], {
          headers: { link: newerLink("newer") },
        })
      if (loads === 2) return latest
      return json([
        { info: { ...assistant, id: "msg_latest", time: { created: 3 } }, parts: [] },
        { info: live, parts: [{ id: "prt_live", sessionID, messageID: live.id, type: "text", text: "live" }] },
      ])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    const jump = sync.session.jumpToLatest(sessionID)
    await wait(() => loads === 2)
    emit(global({ id: "evt_live", type: "message.updated", properties: { sessionID, info: live } }))
    emit(
      global({
        id: "evt_live_part",
        type: "message.part.updated",
        properties: {
          sessionID,
          time: 4,
          part: { id: "prt_live", sessionID, messageID: live.id, type: "text", text: "live" },
        },
      }),
    )
    await wait(() => sync.data.part[live.id]?.length === 1)

    resolveLatest(json([{ info: { ...assistant, id: "msg_latest", time: { created: 3 } }, parts: [] }]))
    await jump
    await wait(() => loads === 3)
    await wait(() => sync.data.message[sessionID]?.at(-1)?.id === live.id)

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_latest", live.id])
    expect(sync.data.part[live.id]?.[0]).toMatchObject({ text: "live" })
  } finally {
    app.renderer.destroy()
  }
})

test("jump to oldest keeps the fetched window contiguous when live messages arrive", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveOldest!: (response: Response) => void
  const oldest = new Promise<Response>((resolve) => {
    resolveOldest = resolve
  })
  let oldestRequested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("oldest") === "true") {
      oldestRequested = true
      return oldest
    }
    if (url.pathname === `/session/${sessionID}/message`)
      return json([{ info: { ...assistant, id: "msg_latest", time: { created: 3 } }, parts: [] }], {
        headers: { link: olderLink("older") },
      })
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    const jump = sync.session.jumpToOldest(sessionID)
    await wait(() => oldestRequested)
    const live = { ...assistant, id: "msg_live", time: { created: 4 } }
    emit(global({ id: "evt_live", type: "message.updated", properties: { sessionID, info: live } }))
    emit(
      global({
        id: "evt_live_part",
        type: "message.part.updated",
        properties: {
          sessionID,
          time: 4,
          part: { id: "prt_live", sessionID, messageID: live.id, type: "text", text: "live" },
        },
      }),
    )
    await wait(() => sync.data.part[live.id]?.length === 1)

    resolveOldest(
      json([{ info: { ...assistant, id: "msg_oldest", time: { created: 1 } }, parts: [] }], {
        headers: { link: newerLink("newer") },
      }),
    )
    await jump

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_oldest"])
    expect(sync.data.part[live.id]).toBeUndefined()
    expect(sync.data.message_page[sessionID]).toMatchObject({
      newest: "msg_oldest",
      newerCursor: "newer",
    })
  } finally {
    app.renderer.destroy()
  }
})

test("jump to latest drops updated messages outside the fetched window", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let loads = 0
  let resolveLatest!: (response: Response) => void
  const latest = new Promise<Response>((resolve) => {
    resolveLatest = resolve
  })
  const old = { ...assistant, id: "msg_old", time: { created: 1 } }
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      loads += 1
      if (loads === 1) return json([{ info: old, parts: [] }], { headers: { link: newerLink("newer") } })
      return latest
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    const jump = sync.session.jumpToLatest(sessionID)
    await wait(() => loads === 2)
    emit(
      global({
        id: "evt_old",
        type: "message.updated",
        properties: { sessionID, info: { ...old, time: { created: 1, completed: 4 } } },
      }),
    )
    resolveLatest(json([{ info: { ...assistant, id: "msg_latest", time: { created: 3 } }, parts: [] }]))
    await jump

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_latest"])
  } finally {
    app.renderer.destroy()
  }
})

test("message remove and re-add does not restore stale hydrated parts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let loads = 0
  let resolveLatest!: (response: Response) => void
  const latest = new Promise<Response>((resolve) => {
    resolveLatest = resolve
  })
  const old = { ...assistant, id: "msg_readded", time: { created: 1 } }
  const stalePart = { id: "prt_stale", sessionID, messageID: old.id, type: "text" as const, text: "stale" }
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      loads += 1
      if (loads === 1) return json([{ info: old, parts: [stalePart] }], { headers: { link: newerLink("newer") } })
      return latest
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    const jump = sync.session.jumpToLatest(sessionID)
    await wait(() => loads === 2)
    emit(global({ id: "evt_removed", type: "message.removed", properties: { sessionID, messageID: old.id } }))
    emit(global({ id: "evt_readded", type: "message.updated", properties: { sessionID, info: old } }))
    await wait(() => sync.data.message[sessionID]?.some((message) => message.id === old.id) ?? false)
    resolveLatest(json([{ info: old, parts: [stalePart] }]))
    await jump

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([old.id])
    expect(sync.data.part[old.id]).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("jump to oldest drains a latest reconciliation queued by a revert update", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveOldest!: (response: Response) => void
  const oldest = new Promise<Response>((resolve) => {
    resolveOldest = resolve
  })
  let latestLoads = 0
  let oldestRequested = false
  const initial = { ...session, revert: undefined }
  const updated = { ...session, revert: { messageID: "msg_boundary" } }
  const boundary = {
    id: "msg_boundary",
    sessionID,
    role: "user" as const,
    agent: "build",
    model: { providerID: "test", modelID: "model" },
    time: { created: 2 },
  }
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(initial)
    if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("oldest") === "true") {
      oldestRequested = true
      return oldest
    }
    if (url.pathname === `/session/${sessionID}/message/${boundary.id}`) return json({ info: boundary, parts: [] })
    if (url.pathname === `/session/${sessionID}/message`) {
      latestLoads += 1
      if (latestLoads === 1)
        return json([{ info: { ...assistant, id: "msg_latest", time: { created: 3 } }, parts: [] }], {
          headers: { link: olderLink("older") },
        })
      return json([
        { info: boundary, parts: [] },
        { info: { ...assistant, id: "msg_after_revert", time: { created: 3 } }, parts: [] },
      ])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)
    const jump = sync.session.jumpToOldest(sessionID)
    await wait(() => oldestRequested)
    emit(global({ id: "evt_revert", type: "session.updated", properties: { sessionID, info: updated } }))
    resolveOldest(
      json([{ info: { ...assistant, id: "msg_oldest", time: { created: 1 } }, parts: [] }], {
        headers: { link: newerLink("newer") },
      }),
    )
    await jump
    await wait(() => latestLoads === 2)

    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([boundary.id, "msg_after_revert"])
  } finally {
    app.renderer.destroy()
  }
})
