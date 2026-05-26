import { describe, expect, test } from "bun:test"
import { watchCursorLabels } from "./cursor-labels"

type Widget = HTMLElement & {
  requestUpdate?: () => unknown
}
type Slot = {
  callback?: () => void
  on: (fn: () => void) => { dispose: () => void }
  emit: () => void
}
type Doc = {
  callback?: () => void
  on: (name: "update", fn: () => void) => void
  off: (name: "update", fn: () => void) => void
  emit: () => void
}
type Editor = HTMLElement & {
  std?: {
    doc?: {
      spaceDoc?: Doc
    }
    selection?: {
      slots?: {
        remoteChanged?: Slot
      }
    }
  }
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 30))

const slot = (): Slot => ({
  on(fn) {
    this.callback = fn
    return {
      dispose: () => {
        this.callback = undefined
      },
    }
  },
  emit() {
    this.callback?.()
  },
})

const doc = (): Doc => ({
  on(_name, fn) {
    this.callback = fn
  },
  off(_name, fn) {
    if (this.callback !== fn) return
    this.callback = undefined
  },
  emit() {
    this.callback?.()
  },
})

describe("watchCursorLabels", () => {
  test("refreshes remote cursor widgets when editor text changes", async () => {
    const host = document.createElement("div")
    const editor = document.createElement("div")
    const block = document.createElement("span")
    const text = document.createTextNode("a")
    const widget = document.createElement("affine-doc-remote-selection-widget") as Widget
    let calls = 0

    widget.requestUpdate = () => {
      calls++
    }
    widget.attachShadow({ mode: "open" })
    block.append(text)
    editor.append(block, widget)
    host.append(editor)
    document.body.append(host)

    const stop = watchCursorLabels(editor, host)
    calls = 0

    text.data = ""
    await wait()

    expect(calls).toBeGreaterThan(0)
    stop()
    host.remove()
  })

  test("refreshes remote cursor widgets when blocksuite signals change", async () => {
    const host = document.createElement("div")
    const editor = document.createElement("div") as Editor
    const widget = document.createElement("affine-doc-remote-selection-widget") as Widget
    const remote = slot()
    const sync = doc()
    let calls = 0

    widget.requestUpdate = () => {
      calls++
    }
    widget.attachShadow({ mode: "open" })
    editor.std = {
      doc: { spaceDoc: sync },
      selection: { slots: { remoteChanged: remote } },
    }
    editor.append(widget)
    host.append(editor)
    document.body.append(host)

    const stop = watchCursorLabels(editor, host)
    calls = 0

    remote.emit()
    sync.emit()
    await wait()

    expect(calls).toBeGreaterThan(0)
    const done = calls
    stop()
    remote.emit()
    sync.emit()
    await wait()
    expect(calls).toBe(done)
    host.remove()
  })
})
