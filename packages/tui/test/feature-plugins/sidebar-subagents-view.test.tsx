/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { createSignal } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message, Part, SessionStatus } from "@opencode-ai/sdk/v2"
import { View } from "../../src/feature-plugins/sidebar/subagents"

const color = RGBA.fromInts(200, 200, 200)
const fakeTheme = {
  current: new Proxy({} as Record<string, RGBA>, { get: () => color }),
} as unknown as TuiPluginApi["theme"]

function fakeApi(opts: {
  parentMessages: ReadonlyArray<Message>
  parentParts: (messageID: string) => ReadonlyArray<Part>
  childParts: (messageID: string) => ReadonlyArray<Part>
  childMessages: (sessionID: string) => ReadonlyArray<Message>
  childStatuses: (sessionID: string) => SessionStatus | undefined
  values?: Map<string, boolean>
}): TuiPluginApi {
  const values = opts.values ?? new Map<string, boolean>()
  const [revision, setRevision] = createSignal(0)
  return {
    state: {
      session: {
        messages: (id: string) => (id === "parent" ? opts.parentMessages : opts.childMessages(id)),
        status: (id: string) => (id === "parent" ? undefined : opts.childStatuses(id)),
        get: () => undefined,
        diff: () => [],
        todo: () => [],
        permission: () => [],
        question: () => [],
        count: () => 0,
      },
      part: (id: string) => {
        const parent = opts.parentParts(id)
        if (parent.length > 0) return parent
        return opts.childParts(id)
      },
      lsp: () => [],
      mcp: () => [],
      ready: true,
    },
    theme: fakeTheme,
    route: {
      navigate: () => {},
      register: () => () => {},
      current: { name: "session", params: {} },
    },
    kv: {
      get: (key: string, fallback: boolean) => (revision(), values.get(key) ?? fallback),
      set: (key: string, value: boolean) => {
        values.set(key, value)
        setRevision(revision() + 1)
      },
      ready: true,
    },
  } as unknown as TuiPluginApi
}

async function renderOnceSettled(app: Awaited<ReturnType<typeof testRender>>) {
  await app.renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 25))
  await app.renderOnce()
}

async function captureSettledFrame(app: Awaited<ReturnType<typeof testRender>>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const frame = app.captureCharFrame()
    if (frame.trim().length > 0) return frame
    await new Promise((resolve) => setTimeout(resolve, 25))
    await app.renderOnce()
  }
  return app.captureCharFrame()
}

const busy = { type: "busy" as const } as unknown as SessionStatus

function apiForSubagents(parentMessages: ReadonlyArray<Message>, parts: Map<string, Part[]>): TuiPluginApi {
  return fakeApi({
    parentMessages,
    parentParts: (id) => parts.get(id) ?? [],
    childParts: () => [],
    childMessages: () => [],
    childStatuses: () => busy,
  })
}

test("active section toggles collapse with more than one row", async () => {
  const parentMessages = [
    { id: "user-1" } as unknown as Message,
    { id: "assistant-1", role: "assistant" } as unknown as Message,
  ]
  const parts = new Map<string, Part[]>([
    [
      "assistant-1",
      [
        {
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: { description: "Worker one" },
            metadata: { sessionId: "child-1" },
            time: { start: 0 },
          },
        } as unknown as Part,
        {
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: { description: "Worker two" },
            metadata: { sessionId: "child-2" },
            time: { start: 0 },
          },
        } as unknown as Part,
      ],
    ],
  ])

  // Build the API once: a prop expression is re-evaluated on every read, which would hand the view a fresh KV.
  const api = apiForSubagents(parentMessages, parts)
  const app = await testRender(() => <View api={api} session_id="parent" />, {
    width: 60,
    height: 12,
  })
  try {
    await renderOnceSettled(app)
    let frame = await captureSettledFrame(app)
    expect(frame).toContain("Subagents")
    expect(frame).toContain("Worker one")
    expect(frame).toContain("Worker two")
    expect(frame).not.toContain("(2)")
    expect(frame).toContain("▼")

    await app.mockMouse.pressDown(2, 0)
    await renderOnceSettled(app)
    frame = await captureSettledFrame(app)
    expect(frame).toContain("Subagents (2)")
    expect(frame).toContain("▶")
    expect(frame).not.toContain("Worker one")
    expect(frame).not.toContain("Worker two")

    await app.mockMouse.pressDown(2, 0)
    await renderOnceSettled(app)
    frame = await captureSettledFrame(app)
    expect(frame).toContain("Subagents")
    expect(frame).toContain("Worker one")
    expect(frame).toContain("Worker two")
    expect(frame).not.toContain("(2)")
    expect(frame).toContain("▼")
  } finally {
    app.renderer.destroy()
  }
})

test("active collapse survives remount through session KV", async () => {
  const parentMessages = [{ id: "assistant-1", role: "assistant" } as unknown as Message]
  const parts = new Map<string, Part[]>([
    [
      "assistant-1",
      ["one", "two"].map(
        (description) =>
          ({
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              input: { description },
              metadata: { sessionId: description },
              time: { start: 0 },
            },
          }) as unknown as Part,
      ),
    ],
  ])
  const values = new Map<string, boolean>()
  const render = () =>
    testRender(
      () => (
        <View
          api={fakeApi({
            parentMessages,
            parentParts: (id) => parts.get(id) ?? [],
            childParts: () => [],
            childMessages: () => [],
            childStatuses: () => busy,
            values,
          })}
          session_id="parent"
        />
      ),
      { width: 60, height: 12 },
    )
  const app = await render()
  await renderOnceSettled(app)
  await app.mockMouse.click(2, 0)
  await renderOnceSettled(app)
  expect(values.get("sidebar:subagents:open")).toBe(false)
  app.renderer.destroy()

  const remounted = await render()
  try {
    await renderOnceSettled(remounted)
    const frame = await captureSettledFrame(remounted)
    expect(frame).toContain("Subagents (2)")
    expect(frame).not.toContain("one")
  } finally {
    remounted.renderer.destroy()
  }
})

test("recent collapse survives remount through session KV", async () => {
  const parentMessages = [{ id: "assistant-1", role: "assistant" } as unknown as Message]
  const parts = new Map<string, Part[]>([
    [
      "assistant-1",
      ["one", "two", "three"].map(
        (description, i) =>
          ({
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { description },
              title: description,
              output: "",
              metadata: { sessionId: description },
              time: { start: i, end: i + 1 },
            },
          }) as unknown as Part,
      ),
    ],
  ])
  const values = new Map<string, boolean>()
  const render = () =>
    testRender(
      () => (
        <View
          api={fakeApi({
            parentMessages,
            parentParts: (id) => parts.get(id) ?? [],
            childParts: () => [],
            childMessages: () => [],
            childStatuses: () => undefined,
            values,
          })}
          session_id="parent"
        />
      ),
      { width: 60, height: 12 },
    )
  const app = await render()
  await renderOnceSettled(app)
  await app.mockMouse.click(2, 0)
  await renderOnceSettled(app)
  expect(values.get("sidebar:subagents:recent:open")).toBe(false)
  app.renderer.destroy()

  const remounted = await render()
  try {
    await renderOnceSettled(remounted)
    expect(await captureSettledFrame(remounted)).toContain("Recent subagents (3)")
  } finally {
    remounted.renderer.destroy()
  }
})

test("active section with a single row shows no chevron or count and ignores clicks", async () => {
  const parentMessages = [
    { id: "user-1" } as unknown as Message,
    { id: "assistant-1", role: "assistant" } as unknown as Message,
  ]
  const parts = new Map<string, Part[]>([
    [
      "assistant-1",
      [
        {
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: { description: "Solo worker" },
            metadata: { sessionId: "child-solo" },
            time: { start: 0 },
          },
        } as unknown as Part,
      ],
    ],
  ])

  const app = await testRender(() => <View api={apiForSubagents(parentMessages, parts)} session_id="parent" />, {
    width: 60,
    height: 12,
  })
  try {
    await renderOnceSettled(app)
    let frame = await captureSettledFrame(app)
    expect(frame).toContain("Subagents")
    expect(frame).toContain("Solo worker")
    expect(frame).not.toContain("(1)")
    expect(frame).not.toContain("▼")
    expect(frame).not.toContain("▶")

    await app.mockMouse.pressDown(2, 0)
    await renderOnceSettled(app)
    frame = await captureSettledFrame(app)
    expect(frame).toContain("Solo worker")
  } finally {
    app.renderer.destroy()
  }
})
