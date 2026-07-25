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

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

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

test("live messages merged during hydration retain the 100 message window", async () => {
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
    const live = { ...assistant, id: "msg_z_live" }
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

    expect(sync.data.message[sessionID]).toHaveLength(100)
    expect(sync.data.message[sessionID].at(-1)?.id).toBe(live.id)
    expect(sync.data.message[sessionID].some((message) => message.id === "msg_000")).toBe(false)
    expect(sync.data.part.msg_000).toBeUndefined()
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

test("hydrates pending prompts without overwriting live prompt changes", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolvePermissions!: (response: Response) => void
  const permissions = new Promise<Response>((resolve) => {
    resolvePermissions = resolve
  })
  let resolveQuestions!: (response: Response) => void
  const questions = new Promise<Response>((resolve) => {
    resolveQuestions = resolve
  })
  let requestedPermissions = false
  let requestedQuestions = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return json([])
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname === "/permission") {
      requestedPermissions = true
      return permissions
    }
    if (url.pathname === "/question") {
      requestedQuestions = true
      return questions
    }
    return undefined
  }, tmp.path)

  try {
    emit(
      global({
        id: "evt_permission_pending",
        type: "permission.asked",
        properties: { id: "permission_pending", sessionID, permission: "bash", patterns: [], metadata: {}, always: [] },
      }),
    )
    emit(
      global({
        id: "evt_question_pending",
        type: "question.asked",
        properties: { id: "question_pending", sessionID, questions: [{ header: "Pending", question: "pending", options: [] }] },
      }),
    )
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requestedPermissions && requestedQuestions)
    emit(
      global({
        id: "evt_permission_replied",
        type: "permission.replied",
        properties: { sessionID, requestID: "permission_pending", reply: "once" },
      }),
    )
    emit(
      global({
        id: "evt_question_rejected",
        type: "question.rejected",
        properties: { sessionID, requestID: "question_pending" },
      }),
    )
    emit(
      global({
        id: "evt_permission",
        type: "permission.asked",
        properties: { id: "permission_live", sessionID, permission: "bash", patterns: ["live"], metadata: {}, always: [] },
      }),
    )
    emit(
      global({
        id: "evt_question",
        type: "question.asked",
        properties: { id: "question_live", sessionID, questions: [{ header: "Live", question: "live", options: [] }] },
      }),
    )
    await wait(
      () =>
        sync.data.permission[sessionID]?.some((request) => request.id === "permission_live") &&
        !sync.data.permission[sessionID]?.some((request) => request.id === "permission_pending") &&
        sync.data.question[sessionID]?.some((request) => request.id === "question_live") &&
        !sync.data.question[sessionID]?.some((request) => request.id === "question_pending"),
    )
    resolvePermissions(
      json([
        { id: "permission_server", sessionID, permission: "read", patterns: ["server"], metadata: {}, always: [] },
        { id: "permission_live", sessionID, permission: "bash", patterns: ["stale"], metadata: {}, always: [] },
        { id: "permission_pending", sessionID, permission: "bash", patterns: [], metadata: {}, always: [] },
        { id: "permission_other", sessionID: "ses_other", permission: "read", patterns: [], metadata: {}, always: [] },
      ]),
    )
    resolveQuestions(
      json([
        { id: "question_server", sessionID, questions: [{ header: "Server", question: "server", options: [] }] },
        { id: "question_live", sessionID, questions: [{ header: "Stale", question: "stale", options: [] }] },
        { id: "question_pending", sessionID, questions: [{ header: "Pending", question: "pending", options: [] }] },
        { id: "question_other", sessionID: "ses_other", questions: [] },
      ]),
    )
    await hydrate

    expect(sync.data.permission[sessionID].map((request) => request.id)).toEqual(["permission_live", "permission_server"])
    expect(sync.data.question[sessionID].map((request) => request.id)).toEqual(["question_live", "question_server"])
    expect(sync.data.permission[sessionID][0].patterns).toEqual(["live"])
    expect(sync.data.permission[sessionID][1].patterns).toEqual(["server"])
    expect(sync.data.question[sessionID][0].questions[0].question).toBe("live")
    expect(sync.data.question[sessionID][1].questions[0].question).toBe("server")
  } finally {
    app.renderer.destroy()
  }
})

test("undefined prompt lists do not clear pending prompts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return json([])
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname === "/permission" || url.pathname === "/question") return json({}, { status: 500 })
    return undefined
  }, tmp.path)

  try {
    emit(
      global({
        id: "evt_permission",
        type: "permission.asked",
        properties: { id: "permission_live", sessionID, permission: "bash", patterns: ["live"], metadata: {}, always: [] },
      }),
    )
    emit(
      global({
        id: "evt_question",
        type: "question.asked",
        properties: { id: "question_live", sessionID, questions: [{ header: "Live", question: "live", options: [] }] },
      }),
    )
    await wait(() => sync.data.permission[sessionID]?.length === 1 && sync.data.question[sessionID]?.length === 1)
    await sync.session.sync(sessionID)

    expect(sync.data.permission[sessionID][0].id).toBe("permission_live")
    expect(sync.data.question[sessionID][0].id).toBe("question_live")
  } finally {
    app.renderer.destroy()
  }
})
