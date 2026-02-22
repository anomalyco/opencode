import { describe, expect, test } from "bun:test"
import { dispatchListKeyEvent } from "@opencode-ai/ui/list-keyboard"

describe("list keyboard handling", () => {
  test("forwards Escape to onKeyEvent for searchable lists", () => {
    const events: string[] = []
    const items = [{ id: "github", name: "github" }]
    const event = new KeyboardEvent("keydown", { key: "Escape" })

    const { selected, index } = dispatchListKeyEvent(
      event,
      items,
      null,
      (item) => item.id,
      (keyboardEvent, item) => {
        events.push(`${keyboardEvent.key}:${item?.id ?? "none"}`)
      },
    )

    expect(selected).toBeUndefined()
    expect(index).toBe(-1)
    expect(events).toEqual(["Escape:none"])
  })
})
