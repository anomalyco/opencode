import { describe, expect, test } from "bun:test"
import { dragOutText, draggingOut, startDragOut } from "./drag-out"

const path = "C:\\repo\\src\\index.ts"

// A file row inside a shadow root, as the file tree renders it, whose `dragstart` is handled on the host outside it.
function rowDrag(platform: Parameters<typeof startDragOut>[0]) {
  const host = document.createElement("div")
  const row = document.createElement("button")
  host.attachShadow({ mode: "open" }).append(row)
  document.body.append(host)
  const seen: Array<{ event: DragEvent; started: boolean }> = []
  host.addEventListener("dragstart", (event) => seen.push({ event, started: startDragOut(platform, event, path) }))

  const dataTransfer = new DataTransfer()
  dataTransfer.setData("text/plain", "file:src/index.ts")
  const event = new DragEvent("dragstart", { dataTransfer, bubbles: true, composed: true, cancelable: true })
  // happy-dom drops `dataTransfer` from the init dictionary; a browser keeps it.
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  row.dispatchEvent(event)

  return { row, started: seen[0]?.started, event: seen[0]?.event }
}

describe("drag out", () => {
  test("a drop of the dragged-out file reads as the row's drag until the system drag ends, which ends the row's drag", async () => {
    const ended = Promise.withResolvers<boolean>()
    const drag = rowDrag({ startFileDrag: () => ended.promise })
    const ends: string[] = []
    drag.row.addEventListener("dragend", () => ends.push("row"))
    window.addEventListener("dragend", () => ends.push("window"), { once: true })

    expect(drag.started).toBe(true)
    expect(drag.event?.defaultPrevented).toBe(true)
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
    expect(ends).toEqual(["row", "window"])
  })

  test("without a system drag the row keeps its own drag", () => {
    const drag = rowDrag({})

    expect(drag.started).toBe(false)
    expect(drag.event?.defaultPrevented).toBe(false)
    expect(draggingOut()).toBe(false)
  })
})
