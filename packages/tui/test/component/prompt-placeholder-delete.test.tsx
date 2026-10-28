/** @jsxImportSource @opentui/solid */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"

// The prompt marks a paste placeholder with a virtual extmark. Word and line deletes go
// through deleteRange, which @opentui/core 0.4.5 is patched to widen over a virtual
// extmark it cuts into (anomalyco/opentui#1628).
const placeholder = "[Pasted ~5 lines]"
const text = `see ${placeholder} x`
const start = "see ".length
const end = start + placeholder.length

let app: Awaited<ReturnType<typeof testRender>>
let input: TextareaRenderable

beforeAll(async () => {
  const textarea = Promise.withResolvers<TextareaRenderable>()
  app = await testRender(
    () => (
      <box width="100%">
        <textarea width="100%" maxHeight={6} ref={textarea.resolve} />
      </box>
    ),
    { width: 60, height: 10 },
  )
  await app.flush()
  input = await textarea.promise
})

afterAll(() => app.renderer.destroy())

function setup(cursor: number) {
  input.setText(text)
  const id = input.extmarks.create({ start, end, virtual: true })
  input.cursorOffset = cursor
  return id
}

describe("deleting a paste placeholder", () => {
  test.each([
    ["delete word backward", end, () => input.deleteWordBackward()],
    ["delete word forward", start, () => input.deleteWordForward()],
  ] as const)("%s removes the whole placeholder", (_, cursor, run) => {
    const id = setup(cursor)
    run()
    expect(input.plainText).toBe("see  x")
    expect(input.extmarks.get(id)).toBeNull()
  })

  test("delete to line end from inside the line removes the placeholder it reaches", () => {
    const id = setup(2)
    input.deleteToLineEnd()
    expect(input.plainText).toBe("se")
    expect(input.extmarks.get(id)).toBeNull()
  })

  test("a range ending inside the placeholder widens to the whole placeholder", () => {
    const id = setup(0)
    input.editBuffer.deleteRange(0, 2, 0, start + 3)
    expect(input.plainText).toBe("se x")
    expect(input.extmarks.get(id)).toBeNull()
  })
})
