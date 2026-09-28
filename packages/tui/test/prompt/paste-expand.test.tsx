/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { expandPastedTextPlaceholder, pastedTextExtmarkAtOffset } from "../../src/prompt/part"

test("pastedTextExtmarkAtOffset matches placeholder bounds and trailing space", () => {
  const ranges = [{ start: 5, end: 10 }]
  expect(pastedTextExtmarkAtOffset(4, ranges)).toBeUndefined()
  expect(pastedTextExtmarkAtOffset(5, ranges)).toEqual(ranges[0])
  expect(pastedTextExtmarkAtOffset(10, ranges)).toEqual(ranges[0])
  expect(pastedTextExtmarkAtOffset(11, ranges)).toEqual(ranges[0])
  expect(pastedTextExtmarkAtOffset(12, ranges)).toBeUndefined()
})

function pastedMarker(textarea: TextareaRenderable, typeId: number, marker: string) {
  const start = textarea.cursorOffset
  textarea.insertText(marker + " ")
  return textarea.extmarks.create({ start, end: start + marker.length, virtual: true, typeId })
}

test("expandPastedTextPlaceholder replaces the marker at the cursor", async () => {
  let textarea!: TextareaRenderable
  const app = await testRender(() => <textarea ref={(r: TextareaRenderable) => (textarea = r)} />, {
    width: 80,
    height: 10,
  })
  try {
    const typeId = textarea.extmarks.registerType("prompt-part")
    const marker = "[Pasted ~3 lines]"
    const text = "alpha\nbeta\ngamma"
    const parts = new Map<number, string>()

    textarea.insertText("check ")
    parts.set(pastedMarker(textarea, typeId, marker), text)

    // cursor sits after the trailing space, same as right after a real paste
    expect(expandPastedTextPlaceholder(textarea, typeId, (id) => parts.get(id))).toBe(true)
    expect(textarea.plainText).toBe(`check ${text} `)
    // cursor offsets are display-width including newlines, so use char count here
    expect(textarea.cursorOffset).toBe(`check ${text}`.length)
    expect(textarea.extmarks.getAllForTypeId(typeId)).toHaveLength(0)

    // a second paste is free to insert again since nothing is left to expand
    expect(expandPastedTextPlaceholder(textarea, typeId, (id) => parts.get(id))).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("expandPastedTextPlaceholder only expands the marker at the cursor", async () => {
  let textarea!: TextareaRenderable
  const app = await testRender(() => <textarea ref={(r: TextareaRenderable) => (textarea = r)} />, {
    width: 80,
    height: 10,
  })
  try {
    const typeId = textarea.extmarks.registerType("prompt-part")
    const marker = "[Pasted ~1 lines]"
    const parts = new Map<number, string>()

    parts.set(pastedMarker(textarea, typeId, marker), "first")
    textarea.insertText("and ")
    parts.set(pastedMarker(textarea, typeId, marker), "second")

    expect(expandPastedTextPlaceholder(textarea, typeId, (id) => parts.get(id))).toBe(true)
    expect(textarea.plainText).toBe(`${marker} and second `)
    expect(textarea.extmarks.getAllForTypeId(typeId)).toHaveLength(1)
  } finally {
    app.renderer.destroy()
  }
})

test("expandPastedTextPlaceholder ignores non-paste extmarks", async () => {
  let textarea!: TextareaRenderable
  const app = await testRender(() => <textarea ref={(r: TextareaRenderable) => (textarea = r)} />, {
    width: 80,
    height: 10,
  })
  try {
    const typeId = textarea.extmarks.registerType("prompt-part")
    const marker = "[Image 1]"

    const start = textarea.cursorOffset
    textarea.insertText(marker + " ")
    textarea.extmarks.create({ start, end: start + marker.length, virtual: true, typeId })

    expect(expandPastedTextPlaceholder(textarea, typeId, () => undefined)).toBe(false)
    expect(textarea.plainText).toBe(`${marker} `)
  } finally {
    app.renderer.destroy()
  }
})
