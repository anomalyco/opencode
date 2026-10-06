/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const directory = "/tmp/opencode/packages/opencode"

function session(id: string, parentID?: string) {
  return {
    id,
    slug: id,
    projectID: "proj_test",
    parentID,
    title: id,
    time: { created: 0, updated: 0 },
    version: "1.15.13",
    directory,
  }
}

function assistant(sessionID: string, id: string, created: number) {
  return {
    id,
    sessionID,
    role: "assistant" as const,
    agent: "build",
    modelID: "model",
    providerID: "test",
    mode: "build",
    parentID: "msg_user",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, completed: created },
  }
}

function text(sessionID: string, messageID: string) {
  return { id: `prt_${messageID}`, sessionID, messageID, type: "text" as const, text: "hi" }
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

async function mountSessions(sessions: Record<string, { parentID?: string; messages: number }>, path: string) {
  return mount((url) => {
    const [, , id, rest] = url.pathname.split("/")
    const entry = id ? sessions[id] : undefined
    if (!id || !entry) return undefined
    if (!rest) return json(session(id, entry.parentID))
    if (rest === "message") {
      return json(
        Array.from({ length: entry.messages }, (_, index) => {
          const info = assistant(id, `msg_${id}_${index}`, index)
          return { info, parts: [text(id, info.id)] }
        }),
      )
    }
    if (rest === "todo" || rest === "diff") return json([])
    return undefined
  }, path)
}

test("events for sessions that were not opened are not kept", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mountSessions({}, tmp.path)

  try {
    sync.session.open("ses_open")
    for (const id of ["ses_other", "ses_open"]) {
      emit(
        global({
          id: `evt_${id}`,
          type: "message.updated",
          properties: { sessionID: id, info: assistant(id, `msg_${id}`, 1) },
        }),
      )
      emit(
        global({
          id: `evt_${id}_part`,
          type: "message.part.updated",
          properties: { sessionID: id, time: 1, part: text(id, `msg_${id}`) },
        }),
      )
    }
    await wait(() => sync.data.part["msg_ses_open"]?.length === 1)

    expect(sync.data.message["ses_other"]).toBeUndefined()
    expect(sync.data.part["msg_ses_other"]).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("events for a subagent of an opened session are kept", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mountSessions({}, tmp.path)

  try {
    sync.session.open("ses_parent")
    emit(
      global({
        id: "evt_child",
        type: "session.updated",
        properties: { sessionID: "ses_child", info: session("ses_child", "ses_parent") },
      }),
    )
    emit(
      global({
        id: "evt_child_message",
        type: "message.updated",
        properties: { sessionID: "ses_child", info: assistant("ses_child", "msg_child", 1) },
      }),
    )
    await wait(() => sync.data.message["ses_child"]?.length === 1)
  } finally {
    app.renderer.destroy()
  }
})

test("opening more sessions drops the oldest but keeps the subagents of those still kept", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, sync } = await mountSessions(
    {
      ses_a: { messages: 3 },
      ses_b: { messages: 3 },
      ses_b_child: { parentID: "ses_b", messages: 2 },
      ses_c: { messages: 3 },
      ses_d: { messages: 3 },
      ses_e: { messages: 3 },
    },
    tmp.path,
  )
  const open = async (id: string) => {
    sync.session.open(id)
    await sync.session.sync(id)
  }

  try {
    await open("ses_a")
    await open("ses_b")
    await sync.session.sync("ses_b_child")
    await open("ses_c")
    await open("ses_d")
    expect(sync.data.message["ses_a"]?.length).toBe(3)

    await open("ses_e")
    expect(sync.data.message["ses_a"]).toBeUndefined()
    expect(sync.data.part["msg_ses_a_0"]).toBeUndefined()
    expect(sync.data.message["ses_b"]?.length).toBe(3)
    expect(sync.data.message["ses_b_child"]?.length).toBe(2)

    await open("ses_a")
    expect(sync.data.message["ses_a"]?.length).toBe(3)
    expect(sync.data.message["ses_b"]).toBeUndefined()
    expect(sync.data.message["ses_b_child"]).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})
