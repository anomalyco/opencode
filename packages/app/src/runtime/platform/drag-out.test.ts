import { describe, expect, test } from "bun:test"
import { dragOutText, draggingOut, startDragOut } from "./drag-out"

const path = "C:\\repo\\src\\index.ts"

function rowDrag(row = document.createElement("button")) {
  const dataTransfer = new DataTransfer()
  dataTransfer.setData("text/plain", "file:src/index.ts")

  const event = new DragEvent("dragstart", { dataTransfer, cancelable: true })
  // happy-dom drops `dataTransfer` from the init dictionary; a browser keeps it.
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })

  row.dispatchEvent(event)

  return event
}

describe("drag out", () => {
  test("a drop of the dragged-out file reads as the row's drag until the system drag ends, which ends the row's drag", async () => {
    const ended = Promise.withResolvers<boolean>()
    const row = document.createElement("button")
    const ends: string[] = []
    row.addEventListener("dragend", (end) => ends.push(end.type))
    const event = rowDrag(row)

    expect(startDragOut({ startFileDrag: () => ended.promise }, event, path)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(draggingOut()).toBe(true)
    expect(dragOutText([path])).toBe("file:src/index.ts")
    // Windows paths ignore case and take either separator.
    expect(dragOutText(["c:/repo/src/INDEX.ts"])).toBe("file:src/index.ts")
    expect(dragOutText(["C:\\repo\\other.ts"])).toBeUndefined()
    expect(dragOutText([path, "C:\\repo\\other.ts"])).toBeUndefined()

    ended.resolve(true)
    await ended.promise
    await Promise.resolve()

    expect(draggingOut()).toBe(false)
    expect(dragOutText([path])).toBeUndefined()
    expect(ends).toEqual(["dragend"])
  })

  test("without a system drag the row keeps its own drag", () => {
    const event = rowDrag()

    expect(startDragOut({}, event, path)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(draggingOut()).toBe(false)
  })
})
