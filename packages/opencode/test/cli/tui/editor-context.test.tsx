import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, spyOn, test } from "bun:test"
import { createRoot } from "solid-js"
import { EditorContextProvider, useEditorContext } from "../../../src/cli/cmd/tui/context/editor"
import { tmpdir } from "../../fixture/fixture"
import { FakeWebSocket } from "../../lib/websocket"

const originalClaudePort = process.env.CLAUDE_CODE_SSE_PORT
const originalOpencodePort = process.env.OPENCODE_EDITOR_SSE_PORT

afterEach(() => {
  process.env.CLAUDE_CODE_SSE_PORT = originalClaudePort
  process.env.OPENCODE_EDITOR_SSE_PORT = originalOpencodePort
})

function nextTick() {
  return new Promise<void>((resolve) => queueMicrotask(resolve))
}

function mountEditorContext(WebSocketImpl?: typeof WebSocket) {
  let editor!: ReturnType<typeof useEditorContext>
  let dispose!: () => void

  createRoot((nextDispose) => {
    dispose = nextDispose

    const Consumer = () => {
      editor = useEditorContext()
      return null
    }

    return (
      <EditorContextProvider WebSocketImpl={WebSocketImpl}>
        <Consumer />
      </EditorContextProvider>
    )
  })

  return {
    editor,
    dispose,
  }
}

function createWebSocketImpl(...sockets: FakeWebSocket[]) {
  let index = 0

  return class {
    constructor(url: string, options?: { headers?: Record<string, string> }) {
      const socket = sockets[index]
      index += 1
      expect(socket).toBeDefined()
      expect(url).toBe(socket!.url)
      expect(options).toEqual(socket!.options)
      return socket as unknown as object
    }
  } as unknown as typeof WebSocket
}

function sendSelection(socket: FakeWebSocket, filePath: string, text = "foo") {
  socket.message(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "selection_changed",
      params: {
        text,
        filePath,
        selection: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
        },
      },
    }),
  )
}

function expectedSelection(filePath: string, text = "foo") {
  return {
    filePath,
    source: "websocket" as const,
    ranges: [
      {
        text,
        selection: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
        },
      },
    ],
  }
}

test("useEditorContext reconnect switches editor server by session directory", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const sessionDirectory = path.join(tmp.path, "session")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(sessionDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )
  await writeFile(
    path.join(ideDirectory, "3002.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [sessionDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const firstSocket = new FakeWebSocket("ws://127.0.0.1:3001")
  const secondSocket = new FakeWebSocket("ws://127.0.0.1:3002")

  const mounted = mountEditorContext(createWebSocketImpl(firstSocket, secondSocket))
  await nextTick()

  expect(firstSocket.closed).toBeFalse()
  sendSelection(firstSocket, path.join(startupDirectory, "file.ts"))

  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))
  expect(mounted.editor.labelState()).toBe("pending")

  mounted.editor.reconnect(sessionDirectory)
  await nextTick()

  expect(firstSocket.closed).toBeTrue()
  expect(secondSocket.closed).toBeFalse()
  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.labelState()).toBe("none")

  mounted.dispose()
})

test("useEditorContext favors configured port over lock files", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = "4010"
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:4010")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  expect(socket.closed).toBeFalse()

  mounted.dispose()
})

test("useEditorContext clears selection when reconnecting", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:3001")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  expect(socket.closed).toBeFalse()
  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.connected()).toBeFalse()

  socket.open()
  socket.message(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "test", version: "0.0.0" },
      },
    }),
  )
  sendSelection(socket, path.join(startupDirectory, "file.ts"))

  expect(mounted.editor.connected()).toBeTrue()
  expect(mounted.editor.server()).toEqual({
    protocolVersion: "2025-11-25",
    serverInfo: { name: "test", version: "0.0.0" },
  })
  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))
  expect(mounted.editor.labelState()).toBe("pending")
  mounted.editor.markSelectionSent()
  expect(mounted.editor.labelState()).toBe("sent")

  mounted.editor.reconnect(startupDirectory)

  expect(socket.closed).toBeFalse()
  expect(mounted.editor.connected()).toBeTrue()
  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.labelState()).toBe("none")

  mounted.dispose()
})

test("useEditorContext preserves selection for the next reconnect when requested", async () => {
  await using tmp = await tmpdir()
  const startupDirectory = path.join(tmp.path, "startup")
  const ideDirectory = path.join(tmp.path, ".claude", "ide")
  await mkdir(startupDirectory, { recursive: true })
  await mkdir(ideDirectory, { recursive: true })
  await writeFile(
    path.join(ideDirectory, "3001.lock"),
    JSON.stringify({
      transport: "ws",
      workspaceFolders: [startupDirectory],
    }),
  )

  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = undefined
  spyOn(process, "cwd").mockImplementation(() => startupDirectory)
  spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:3001")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  sendSelection(socket, path.join(startupDirectory, "file.ts"))
  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))

  mounted.editor.markSelectionSent()
  mounted.editor.preserveSelectionFromNewSession()
  mounted.editor.reconnect(startupDirectory)

  expect(socket.closed).toBeFalse()
  expect(mounted.editor.selection()).toEqual(expectedSelection(path.join(startupDirectory, "file.ts")))
  expect(mounted.editor.labelState()).toBe("sent")

  mounted.editor.reconnect(startupDirectory)

  expect(mounted.editor.selection()).toBeUndefined()
  expect(mounted.editor.labelState()).toBe("none")

  mounted.dispose()
})

test("useEditorContext connects with OPENCODE_EDITOR_SSE_PORT", async () => {
  await using tmp = await tmpdir()
  process.env.CLAUDE_CODE_SSE_PORT = undefined
  process.env.OPENCODE_EDITOR_SSE_PORT = "4020"
  spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const socket = new FakeWebSocket("ws://127.0.0.1:4020")

  const mounted = mountEditorContext(createWebSocketImpl(socket))
  await nextTick()

  expect(socket.closed).toBeFalse()

  mounted.dispose()
})
