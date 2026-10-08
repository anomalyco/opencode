import { describe, expect, test } from "bun:test"
import { onClick } from "../../src/ui/click"

const selecting = (text: string) => ({ ctx: { getSelection: () => ({ getSelectedText: () => text }) } })

describe("ui.click", () => {
  test("a left press and release on the same cell runs the action", () => {
    let runs = 0
    const click = onClick(() => runs++)
    click.onMouseDown({ x: 4, y: 2, button: 0 })
    click.onMouseUp({ x: 4, y: 2, button: 0 })
    expect(runs).toBe(1)
  })

  test("a drag off the pressed cell, a right press or a release alone does not", () => {
    let runs = 0
    const click = onClick(() => runs++)
    click.onMouseDown({ x: 4, y: 2, button: 0 })
    click.onMouseUp({ x: 9, y: 2, button: 0 })
    click.onMouseDown({ x: 4, y: 2, button: 2 })
    click.onMouseUp({ x: 4, y: 2, button: 2 })
    click.onMouseUp({ x: 4, y: 2, button: 0 })
    expect(runs).toBe(0)
  })

  test("a click that leaves text selected is a selection, not a click", () => {
    let runs = 0
    const click = onClick(() => runs++)
    click.onMouseDown({ x: 4, y: 2, button: 0 })
    click.onMouseUp({ x: 4, y: 2, button: 0, target: selecting("Build") })
    click.onMouseDown({ x: 4, y: 2, button: 0 })
    click.onMouseUp({ x: 4, y: 2, button: 0, target: selecting("") })
    expect(runs).toBe(1)
  })
})
