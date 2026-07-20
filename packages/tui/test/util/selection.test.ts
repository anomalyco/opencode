import { expect, test } from "bun:test"
import { MouseButton, MouseEvent, type Renderable } from "@opentui/core"
import { capturePluginSelection, copy, startPluginSelection } from "../../src/util/selection"

function mouse(target: Renderable | null, overrides: Partial<ConstructorParameters<typeof MouseEvent>[1]> = {}) {
  return new MouseEvent(target, {
    type: "up",
    button: MouseButton.LEFT,
    x: 12,
    y: 8,
    modifiers: { shift: false, alt: false, ctrl: true },
    ...overrides,
  })
}

test("marks an armed left drag without replacing OpenTUI selection ownership", () => {
  let started: [Renderable, number, number] | undefined
  let prevented = false
  let stopped = false
  const target = {
    selectable: true,
    shouldStartSelection: () => true,
  } as unknown as Renderable & { selectable: boolean; shouldStartSelection: () => boolean }
  const renderer = {
    startSelection(renderable: Renderable, x: number, y: number) {
      started = [renderable, x, y]
    },
    clearSelection() {},
  }
  const event = mouse(target, {
    type: "down",
    x: 4,
    y: 5,
    modifiers: { shift: false, alt: false, ctrl: false },
  })
  event.preventDefault = () => { prevented = true }
  event.stopPropagation = () => { stopped = true }

  expect(startPluginSelection(renderer, event, false)).toBe(false)
  expect(startPluginSelection(renderer, event, true)).toBe(true)
  expect(started).toBeUndefined()
  expect(prevented).toBe(false)
  expect(stopped).toBe(false)
})

test("publishes armed plugin selection before clearing it", () => {
  const selected = { getSelectedText: () => "  English answer  ", selectedRenderables: [] as readonly Renderable[] }
  let cleared = false
  let published: unknown
  const event = mouse(null)
  event.preventDefault = () => undefined
  event.stopPropagation = () => undefined

  expect(capturePluginSelection({
    getSelection: () => selected,
    clearSelection: () => { cleared = true },
  }, event, (value) => { published = value }, true)).toBe(true)
  expect(published).toEqual({ text: "English answer", x: 12, y: 8, renderables: [] })
  expect(cleared).toBe(true)
})

test("keeps plugin selection ownership without mouse modifiers", () => {
  const selected = { getSelectedText: () => "English answer", selectedRenderables: [] as readonly Renderable[] }
  let published = false
  const event = mouse(null, { modifiers: { shift: false, alt: false, ctrl: false } })

  expect(capturePluginSelection({
    getSelection: () => selected,
    clearSelection: () => undefined,
  }, event, () => { published = true }, true)).toBe(true)
  expect(published).toBe(true)
})

test("keeps ordinary copy behavior separate from Ctrl capture", async () => {
  let cleared = false
  let copied = ""
  const renderer = {
    getSelection: () => ({
      getSelectedText: () => "English answer",
      selectedRenderables: [],
    }),
    clearSelection: () => { cleared = true },
    currentFocusedRenderable: null,
  }
  const clipboard = {
    write: async (value: string) => { copied = value },
  }

  expect(copy(renderer, { show: () => undefined, error: () => undefined }, clipboard)).toBe(true)
  await Bun.sleep(0)
  expect(copied).toBe("English answer")
  expect(cleared).toBe(true)
})
