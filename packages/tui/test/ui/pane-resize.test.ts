import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test"
import { MouseButton, MouseEvent } from "@opentui/core"
import { createRoot, createSignal } from "solid-js"
import { createPaneResize } from "../../src/ui/pane-resize"

const disposals: Array<() => void> = []

beforeEach(() => setSystemTime(new Date(1_000)))
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose())
  setSystemTime()
})

function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose)
    const [value, setValue] = createSignal(40)
    const [maximum, setMaximum] = createSignal(80)
    const [defaultValue, setDefaultValue] = createSignal(30)
    const commits: number[] = []
    const resize = createPaneResize({
      value,
      defaultValue,
      clamp: (size) => Math.max(10, Math.min(maximum(), size)),
      fromMouse: (event) => event.x + 1,
      contains: (event, size) => event.x >= size - 1 && event.x <= size,
      onCommit: (size) => {
        commits.push(size)
        setValue(size)
      },
    })
    return { resize, commits, setValue, setMaximum, setDefaultValue }
  })
}

function mouse(type: MouseEvent["type"], x = 39, button = MouseButton.LEFT, y = 0) {
  return new MouseEvent(null, { type, x, y, button, modifiers: { shift: false, alt: false, ctrl: false } })
}

test("syncs external preferences and clamps responsively without persisting or shrinking the preference", () => {
  const scope = setup()
  expect(scope.resize.preferredSize()).toBe(40)
  expect(scope.resize.size()).toBe(40)
  expect(scope.resize.resizing()).toBe(false)
  expect(scope.resize.hovered()).toBe(false)

  scope.setValue(60)
  expect(scope.resize.preferredSize()).toBe(60)
  expect(scope.resize.size()).toBe(60)
  scope.setMaximum(25)
  expect(scope.resize.preferredSize()).toBe(60)
  expect(scope.resize.size()).toBe(25)
  scope.setMaximum(80)
  expect(scope.resize.size()).toBe(60)

  scope.setValue(100)
  expect(scope.resize.preferredSize()).toBe(100)
  expect(scope.resize.size()).toBe(80)
  scope.setMaximum(110)
  expect(scope.resize.size()).toBe(100)
  expect(scope.commits).toEqual([])
})

test("handles only left-button starts, commits the final drag coordinate, and ignores duplicate releases", () => {
  const scope = setup()
  const idleDrag = mouse("drag", 70)
  scope.resize.onMouseDrag(idleDrag)
  const idleRelease = mouse("up", 70)
  scope.resize.onMouseUp(idleRelease)
  expect(idleDrag.propagationStopped).toBe(false)
  expect(idleRelease.propagationStopped).toBe(false)
  ;[MouseButton.MIDDLE, MouseButton.RIGHT].forEach((button) => {
    const event = mouse("down", 39, button)
    scope.resize.onMouseDown(event)
    expect(scope.resize.resizing()).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(event.propagationStopped).toBe(false)
  })

  const down = mouse("down")
  scope.resize.onMouseDown(down)
  expect(scope.resize.resizing()).toBe(true)
  expect(down.defaultPrevented).toBe(true)
  expect(down.propagationStopped).toBe(true)

  const drag = mouse("drag", 47)
  scope.resize.onMouseDrag(drag)
  expect(scope.resize.preferredSize()).toBe(48)
  expect(scope.commits).toEqual([])
  expect(drag.propagationStopped).toBe(true)
  expect(drag.defaultPrevented).toBe(false)

  const release = mouse("drag-end", 54)
  scope.resize.onMouseDragEnd(release)
  expect(scope.resize.resizing()).toBe(false)
  expect(scope.resize.size()).toBe(55)
  expect(scope.commits).toEqual([55])
  expect(release.propagationStopped).toBe(true)
  expect(release.defaultPrevented).toBe(false)

  const duplicate = mouse("up", 70)
  scope.resize.onMouseUp(duplicate)
  expect(duplicate.propagationStopped).toBe(false)
  expect(scope.commits).toEqual([55])

  scope.resize.onMouseDown(mouse("down", 54))
  scope.resize.onMouseUp(mouse("up", 70))
  expect(scope.resize.size()).toBe(55)
  expect(scope.commits).toEqual([55])

  scope.setMaximum(35)
  setSystemTime(new Date(1_300))
  scope.resize.onMouseDown(mouse("down", 34))
  scope.resize.onMouseUp(mouse("up", 70))
  expect(scope.resize.preferredSize()).toBe(35)
  expect(scope.commits).toEqual([55, 35])
})

test("resets only within 300ms of a clean release and reads the current clamped default", () => {
  const scope = setup()
  scope.resize.onMouseDown(mouse("down"))
  setSystemTime(new Date(2_000))
  scope.resize.onMouseUp(mouse("up"))

  setSystemTime(new Date(2_300))
  scope.resize.onMouseDown(mouse("down"))
  expect(scope.resize.resizing()).toBe(true)
  expect(scope.resize.size()).toBe(40)
  setSystemTime(new Date(3_000))
  scope.resize.onMouseUp(mouse("up"))

  scope.setDefaultValue(70)
  scope.setMaximum(60)
  scope.resize.onMouseOver()
  setSystemTime(new Date(3_299))
  const reset = mouse("down")
  scope.resize.onMouseDown(reset)
  expect(scope.resize.resizing()).toBe(false)
  expect(scope.resize.hovered()).toBe(false)
  expect(scope.resize.preferredSize()).toBe(60)
  expect(scope.commits).toEqual([60])
  expect(reset.defaultPrevented).toBe(true)
  expect(reset.propagationStopped).toBe(true)

  const release = mouse("up", 59)
  scope.resize.onMouseUp(release)
  expect(release.propagationStopped).toBe(false)
  expect(scope.commits).toEqual([60])
  setSystemTime(new Date(3_300))
  scope.resize.onMouseDown(mouse("down", 59))
  expect(scope.resize.resizing()).toBe(true)
})

test("even a drag with no size change clears the clean-click timer", () => {
  const scope = setup()
  scope.resize.onMouseDown(mouse("down"))
  scope.resize.onMouseUp(mouse("up"))

  setSystemTime(new Date(1_300))
  scope.resize.onMouseDown(mouse("down"))
  setSystemTime(new Date(1_400))
  scope.resize.onMouseDrag(mouse("drag"))
  setSystemTime(new Date(1_450))
  scope.resize.onMouseUp(mouse("up"))
  expect(scope.commits).toEqual([])

  setSystemTime(new Date(1_500))
  scope.resize.onMouseDown(mouse("down"))
  expect(scope.resize.resizing()).toBe(true)
  expect(scope.resize.size()).toBe(40)
  expect(scope.commits).toEqual([])
})

test("updates hover without consuming events and checks release against the clamped boundary", () => {
  const scope = setup()
  const onMouseOver: (event: MouseEvent) => void = scope.resize.onMouseOver
  const onMouseOut: (event: MouseEvent) => void = scope.resize.onMouseOut
  const over = mouse("over")
  onMouseOver(over)
  expect(scope.resize.hovered()).toBe(true)
  expect(over.propagationStopped).toBe(false)
  expect(over.defaultPrevented).toBe(false)
  const out = mouse("out")
  onMouseOut(out)
  expect(scope.resize.hovered()).toBe(false)
  expect(out.propagationStopped).toBe(false)
  expect(out.defaultPrevented).toBe(false)

  scope.setMaximum(50)
  scope.resize.onMouseDown(mouse("down"))
  scope.resize.onMouseDrag(mouse("drag", 100))
  scope.resize.onMouseUp(mouse("up", 100))
  expect(scope.resize.size()).toBe(50)
  expect(scope.resize.hovered()).toBe(false)

  scope.resize.onMouseDown(mouse("down", 49))
  scope.resize.onMouseUp(mouse("up", 50))
  expect(scope.resize.hovered()).toBe(true)
  setSystemTime(new Date(1_300))
  scope.resize.onMouseDown(mouse("down", 49))
  scope.resize.onMouseUp(mouse("up", 49))
  expect(scope.resize.hovered()).toBe(true)
  setSystemTime(new Date(1_600))
  scope.resize.onMouseDown(mouse("down", 49))
  scope.resize.onMouseUp(mouse("up", 48))
  expect(scope.resize.hovered()).toBe(false)
  expect(scope.commits).toEqual([50])
})

test("ignores storage changes during a drag and resumes external synchronization after release", () => {
  const scope = setup()
  scope.resize.onMouseDown(mouse("down"))
  scope.resize.onMouseDrag(mouse("drag", 49))
  scope.setValue(70)
  expect(scope.resize.resizing()).toBe(true)
  expect(scope.resize.preferredSize()).toBe(50)
  expect(scope.resize.size()).toBe(50)
  expect(scope.commits).toEqual([])

  scope.resize.onMouseUp(mouse("up", 59))
  expect(scope.resize.preferredSize()).toBe(60)
  expect(scope.commits).toEqual([60])
  scope.setValue(35)
  expect(scope.resize.preferredSize()).toBe(35)
  expect(scope.commits).toEqual([60])
})

test("supports right-anchored coordinates and live constraints through caller callbacks", () => {
  const scope = createRoot((dispose) => {
    disposals.push(dispose)
    const [value, setValue] = createSignal(30)
    const [width, setWidth] = createSignal(100)
    const commits: number[] = []
    const resize = createPaneResize({
      value,
      defaultValue: () => 20,
      clamp: (size) => Math.max(10, Math.min(width() - 20, size)),
      fromMouse: (event) => width() - event.x,
      contains: (event, size) => event.x === width() - size && event.y >= 2,
      onCommit: (size) => {
        commits.push(size)
        setValue(size)
      },
    })
    return { resize, setWidth, commits }
  })

  scope.resize.onMouseDown(mouse("down", 70))
  scope.resize.onMouseDrag(mouse("drag", 50))
  expect(scope.resize.size()).toBe(50)
  scope.setWidth(60)
  expect(scope.resize.preferredSize()).toBe(50)
  expect(scope.resize.size()).toBe(40)
  scope.resize.onMouseUp(mouse("up", 25, MouseButton.LEFT, 2))
  expect(scope.resize.size()).toBe(35)
  expect(scope.resize.hovered()).toBe(true)
  expect(scope.commits).toEqual([35])
})
