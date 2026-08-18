import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import {
  promptInputV2Cursor,
  promptInputV2Offset,
  promptInputV2SelectionRange,
} from "@opencode-ai/session-ui/v2/prompt-input/editor"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import type { PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input/types"

function editorElement(html?: string) {
  const editor = document.createElement("div")
  editor.contentEditable = "true"
  if (html !== undefined) editor.innerHTML = html
  document.body.appendChild(editor)
  return editor
}

function select(node: Node, start: number, end = start, endNode: Node = node) {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(endNode, end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

function pasteEvent(text: string) {
  const transfer = new DataTransfer()
  transfer.setData("text/plain", text)
  return new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer })
}

function controller(state: PromptInputV2PersistedState, editor: HTMLElement) {
  return createRoot((dispose) => {
    const store = createStore<PromptInputV2PersistedState>(state)
    const instance = createPromptInputV2Controller({
      store,
      commands: () => [],
      context: () => [],
      searchContextFiles: () => [],
      view: { submit: { stopping: () => false, onSubmit: () => undefined, onStop: () => undefined } },
    })
    instance.setEditor(editor)
    return { instance, dispose }
  })
}

function content(part: PromptInputV2PersistedState["prompt"][number] | undefined) {
  return part && "content" in part ? part.content : ""
}

function state(content: string): PromptInputV2PersistedState {
  return {
    prompt: [{ type: "text", content, start: 0, end: content.length }],
    cursor: content.length,
    context: { items: [] },
  }
}

describe("prompt input v2 editor offsets", () => {
  test("counts text, line breaks and mentions without materializing the document", () => {
    const editor = editorElement('one<br>two<span data-mention="file" data-path="a.ts">@a.ts</span>tail')
    const nodes = Array.from(editor.childNodes)

    expect(promptInputV2Offset(editor, nodes[0], 3)).toBe(3)
    expect(promptInputV2Offset(editor, nodes[2], 0)).toBe(4)
    expect(promptInputV2Offset(editor, nodes[2], 3)).toBe(7)
    expect(promptInputV2Offset(editor, editor, 3)).toBe(7)
    expect(promptInputV2Offset(editor, editor, 4)).toBe(12)
    expect(promptInputV2Offset(editor, nodes[4], 4)).toBe(16)
  })

  test("treats block siblings of the editor as line breaks", () => {
    const editor = editorElement("<div>one</div><div>two</div><div>three</div>")
    const last = editor.childNodes[2].firstChild as Node

    expect(promptInputV2Offset(editor, last, 0)).toBe(8)
  })

  test("reports a caret in a million character node without copying it", () => {
    const editor = editorElement()
    const node = document.createTextNode("x".repeat(1_000_000))
    editor.appendChild(node)
    select(node, 999_999)

    const started = performance.now()
    expect(promptInputV2Cursor(editor)).toBe(999_999)
    // Range.toString() on this editor allocates a megabyte on every keystroke.
    expect(performance.now() - started).toBeLessThan(50)
  })

  test("reports collapsed and expanded selections", () => {
    const editor = editorElement("hello world")
    const node = editor.firstChild as Node

    select(node, 4)
    expect(promptInputV2SelectionRange(editor)).toEqual({ start: 4, end: 4 })

    select(node, 2, 7)
    expect(promptInputV2SelectionRange(editor)).toEqual({ start: 2, end: 7 })
  })

  test("ignores a selection that is outside the editor", () => {
    const editor = editorElement("inside")
    const outside = editorElement("outside")
    select(outside.firstChild as Node, 3)

    expect(promptInputV2SelectionRange(editor)).toBeUndefined()
  })
})

describe("prompt input v2 large paste", () => {
  test("applies a large paste to the prompt model instead of the editor DOM", () => {
    const editor = editorElement("start")
    const initial = state("start")
    const { instance, dispose } = controller(initial, editor)
    const text = Array.from({ length: 12_000 }, (_, index) => `${index} ${"log line ".repeat(9)}`).join("\n")

    select(editor.firstChild as Node, 5)
    const event = pasteEvent(text)
    instance.onPaste(event)

    expect(event.defaultPrevented).toBe(true)
    expect(instance.parts().length).toBe(1)
    expect(instance.parts()[0]).toMatchObject({ type: "text", content: `start${text}` })
    // The browser never saw the payload, so the editor still holds its single text node.
    expect(editor.querySelectorAll("*").length).toBe(0)
    dispose()
  })

  test("replaces the selected range rather than appending", () => {
    const editor = editorElement("keep REPLACE keep")
    const { instance, dispose } = controller(state("keep REPLACE keep"), editor)
    const text = "y".repeat(9_000)

    select(editor.firstChild as Node, 5, 12)
    instance.onPaste(pasteEvent(text))

    expect(instance.parts()[0]).toMatchObject({ type: "text", content: `keep ${text} keep` })
    dispose()
  })

  test("inserts at the caret in the middle of an existing draft", () => {
    const editor = editorElement("abcdef")
    const { instance, dispose } = controller(state("abcdef"), editor)
    const text = "z".repeat(8_000)

    select(editor.firstChild as Node, 3)
    instance.onPaste(pasteEvent(text))

    expect(instance.parts()[0]).toMatchObject({ type: "text", content: `abc${text}def` })
    dispose()
  })

  test("normalizes CRLF and keeps the payload lossless", () => {
    const editor = editorElement()
    const { instance, dispose } = controller(state(""), editor)
    const source = Array.from({ length: 400 }, (_, index) => `${index} value`).join("\r\n")

    select(editor, 0)
    instance.onPaste(pasteEvent(source))

    const pasted = content(instance.parts()[0])
    expect(pasted).not.toContain("\r")
    expect(pasted).toBe(source.replace(/\r\n/g, "\n"))
    expect(pasted.split("\n").length).toBe(400)
    dispose()
  })

  test("keeps a structured mention that the paste does not touch", () => {
    const editor = editorElement('see <span data-mention="file" data-path="src/a.ts">@src/a.ts</span> now')
    const { instance, dispose } = controller(
      {
        prompt: [
          { type: "text", content: "see ", start: 0, end: 4 },
          { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 4, end: 13 },
          { type: "text", content: " now", start: 13, end: 17 },
        ],
        cursor: 17,
        context: { items: [] },
      },
      editor,
    )
    const text = "q".repeat(8_000)

    select(editor.childNodes[2], 4)
    instance.onPaste(pasteEvent(text))

    expect(instance.parts().map((part) => part.type)).toEqual(["text", "file", "text"])
    expect(instance.parts()[1]).toMatchObject({ type: "file", path: "src/a.ts", content: "@src/a.ts" })
    expect(instance.parts()[2]).toMatchObject({ content: ` now${text}` })
    dispose()
  })

  test("removes a mention that the replaced selection covers", () => {
    const editor = editorElement('see <span data-mention="file" data-path="src/a.ts">@src/a.ts</span> now')
    const { instance, dispose } = controller(
      {
        prompt: [
          { type: "text", content: "see ", start: 0, end: 4 },
          { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 4, end: 13 },
          { type: "text", content: " now", start: 13, end: 17 },
        ],
        cursor: 17,
        context: { items: [] },
      },
      editor,
    )
    const text = "r".repeat(8_000)

    select(editor.childNodes[0], 2, 2, editor.childNodes[2])
    instance.onPaste(pasteEvent(text))

    expect(instance.parts().map((part) => part.type)).toEqual(["text", "text"])
    expect(instance.parts()[0]).toMatchObject({ content: `se${text}` })
    expect(instance.parts()[1]).toMatchObject({ content: "ow" })
    dispose()
  })

  test("leaves short single-line pastes to the browser", () => {
    const editor = editorElement("abc")
    const { instance, dispose } = controller(state("abc"), editor)

    select(editor.firstChild as Node, 3)
    instance.onPaste(pasteEvent("short"))

    // The native path must not write the model itself, or the paste would land twice.
    expect(instance.parts()[0]).toMatchObject({ content: "abc" })
    dispose()
  })

  test("applies a megabyte paste in a single model transaction", () => {
    const editor = editorElement()
    const { instance, dispose } = controller(state(""), editor)
    const text = "m".repeat(1024 * 1024)

    select(editor, 0)
    const started = performance.now()
    instance.onPaste(pasteEvent(text))
    const elapsed = performance.now() - started

    expect(content(instance.parts()[0]).length).toBe(1024 * 1024)
    expect(instance.parts().length).toBe(1)
    expect(elapsed).toBeLessThan(500)
    dispose()
  })
})
