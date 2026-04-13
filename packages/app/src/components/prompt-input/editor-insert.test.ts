import { afterEach, describe, expect, mock, test } from "bun:test"
import type { AgentPart, FileAttachmentPart } from "@/context/prompt"
import { insertAtomicPartAtSelection, serializeAtomicPartHtml } from "./editor-insert"

const originalExecCommand = document.execCommand

afterEach(() => {
  document.body.innerHTML = ""
  if (originalExecCommand) {
    document.execCommand = originalExecCommand
  } else {
    // @ts-expect-error happy-dom doesn't declare deletable execCommand
    delete document.execCommand
  }
})

describe("prompt-input editor insert", () => {
  test("serializeAtomicPartHtml preserves file metadata for pill parsing", () => {
    const part: FileAttachmentPart = {
      type: "file",
      content: "src/index.ts",
      path: "/workspace/src/index.ts",
      start: 0,
      end: 12,
    }

    const html = serializeAtomicPartHtml(part)
    expect(html).toContain('data-type="file"')
    expect(html).toContain('data-path="/workspace/src/index.ts"')
    expect(html).toContain('contenteditable="false"')
    expect(html).toContain("src/index.ts")
  })

  test("serializeAtomicPartHtml preserves agent metadata", () => {
    const part: AgentPart = {
      type: "agent",
      content: "codegen",
      name: "codegen",
      start: 0,
      end: 7,
    }

    const html = serializeAtomicPartHtml(part)
    expect(html).toContain('data-type="agent"')
    expect(html).toContain('data-name="codegen"')
  })

  test("serializeAtomicPartHtml escapes HTML special characters", () => {
    const part: FileAttachmentPart = {
      type: "file",
      content: '<script>alert("xss")</script>',
      path: 'path/with"quotes',
      start: 0,
      end: 10,
    }

    const html = serializeAtomicPartHtml(part)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  test("insertAtomicPartAtSelection prefers execCommand so the browser keeps undo history", () => {
    const editor = document.createElement("div")
    editor.setAttribute("contenteditable", "true")
    editor.textContent = "hello @"
    document.body.appendChild(editor)

    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(editor.firstChild!, editor.textContent!.length)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)

    const execCommand = mock((_command: string, _showUi: boolean, _value: string) => true)
    document.execCommand = execCommand as typeof document.execCommand

    const part: FileAttachmentPart = {
      type: "file",
      content: "README.md",
      path: "/workspace/README.md",
      start: 0,
      end: 9,
    }

    expect(insertAtomicPartAtSelection(part)).toBe(true)
    expect(execCommand).toHaveBeenCalledTimes(1)
    expect(execCommand.mock.calls[0]?.[0]).toBe("insertHTML")
    expect(String(execCommand.mock.calls[0]?.[2] ?? "")).toContain('data-type="file"')
  })

  test("insertAtomicPartAtSelection returns false when execCommand is unavailable", () => {
    // @ts-expect-error testing unavailable execCommand
    document.execCommand = undefined

    const part: AgentPart = {
      type: "agent",
      content: "codegen",
      name: "codegen",
      start: 0,
      end: 7,
    }

    expect(insertAtomicPartAtSelection(part)).toBe(false)
  })
})
