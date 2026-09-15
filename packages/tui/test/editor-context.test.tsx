import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
  EditorContextProvider,
  editorSelectionKey,
  useEditorContext,
  type EditorSelection,
} from "../src/context/editor"
import { TuiPathsProvider } from "../src/context/runtime"

class FakeWebSocket extends EventTarget {
  static current: FakeWebSocket | undefined
  readyState = 0

  constructor(_url: string) {
    super()
    FakeWebSocket.current = this
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event("open"))
  }

  message(value: unknown) {
    const event = new Event("message")
    Object.defineProperty(event, "data", { value: JSON.stringify(value) })
    this.dispatchEvent(event)
  }

  send(_data: string) {}

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event("close"))
  }
}

const selection = (text: string, line: number): EditorSelection => ({
  filePath: "/work/src/index.ts",
  ranges: [
    {
      text,
      selection: {
        start: { line, character: 0 },
        end: { line, character: text.length },
      },
    },
  ],
  source: "websocket",
})

test("does not acknowledge an editor selection that changed while prompt admission was pending", async () => {
  const mounted = Promise.withResolvers<ReturnType<typeof useEditorContext>>()

  function Probe() {
    const editor = useEditorContext()
    mounted.resolve(editor)
    return <text>{editor.labelState()}</text>
  }

  const app = await testRender(
    () => (
      <TuiPathsProvider value={{ cwd: "/work", home: "/home", state: "/state", worktree: "/worktree" }}>
        <EditorContextProvider
          integration={{ connection: () => ({ url: "ws://editor.test", source: "test" }) }}
          WebSocketImpl={FakeWebSocket as never}
        >
          <Probe />
        </EditorContextProvider>
      </TuiPathsProvider>
    ),
    { width: 40, height: 3 },
  )

  try {
    const editor = await mounted.promise
    const socket = FakeWebSocket.current
    if (!socket) throw new Error("Editor socket was not created")
    socket.open()
    socket.message({ method: "selection_changed", params: selection("first", 1) })
    const submitted = editorSelectionKey(editor.selection())
    if (!submitted) throw new Error("Editor selection was not received")

    socket.message({ method: "selection_changed", params: selection("second", 2) })
    editor.markSelectionSent(submitted)

    expect(editor.selection()).toEqual(selection("second", 2))
    expect(editor.labelState()).toBe("pending")
  } finally {
    app.renderer.destroy()
    FakeWebSocket.current = undefined
  }
})
