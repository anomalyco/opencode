import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { createComponent as CreateComponent } from "solid-js"
import type { createStore as CreateStore, SetStoreFunction } from "solid-js/store"
import type { MessageSelection } from "./message-selection"
import type { MessageAnnotationTriggerVariant } from "./message-annotation-trigger"

let createComponent: typeof CreateComponent
let createStore: typeof CreateStore
let render: typeof import("solid-js/web").render
let MessageAnnotationTrigger: typeof import("./message-annotation-trigger").MessageAnnotationTrigger
let dir = ""
let focusCount = 0
const cwd = new URL("../../../", import.meta.url).pathname
const label = "Add comment"
const limit = 96
const vars = ["icon", "toolbar", "mini"] as const satisfies MessageAnnotationTriggerVariant[]

const widthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth")
const heightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight")
const focusDescriptor = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "focus")

const lead = {
  x: 24,
  y: 48,
  width: 120,
  height: 18,
  top: 48,
  right: 144,
  bottom: 66,
  left: 24,
}

const tail = {
  x: 180,
  y: 72,
  width: 40,
  height: 18,
  top: 72,
  right: 220,
  bottom: 90,
  left: 180,
}

const preview = (quote: string) => {
  const text = quote.replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

const shift = (variant: MessageAnnotationTriggerVariant) =>
  variant === "icon" ? "translate(0, -50%)" : "translate(calc(28px - 100%), -50%)"

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const rect = (value = lead) =>
  ({
    ...value,
    toJSON: () => value,
  }) as DOMRect

const setRect = (range: Range, value = lead) => {
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(value),
  })
  Object.defineProperty(range, "getClientRects", {
    configurable: true,
    value: () => {
      return {
        length: 1,
        item: (i: number) => (i === 0 ? rect(value) : null),
        0: rect(value),
      } as unknown as DOMRectList
    },
  })
}

const pick = (quote: string, input: { rect?: typeof lead; anchor?: typeof tail } = {}) => {
  const span = document.querySelector("#quote")
  if (!(span instanceof HTMLSpanElement)) throw new Error("Missing quote span")

  span.textContent = quote
  const text = span.firstChild
  if (!(text instanceof Text)) throw new Error("Missing quote text node")

  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, quote.length)
  setRect(range, input.rect ?? lead)

  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)

  return {
    messageID: "msg-1",
    role: "assistant",
    quote,
    rect: input.rect ?? lead,
    anchor: input.anchor ?? tail,
  } satisfies MessageSelection
}

const seed = (input: { quote?: string; rect?: typeof lead; anchor?: typeof tail } = {}) => {
  const quote = input.quote ?? "assistant reply"
  document.body.innerHTML = ""

  const scope = document.createElement("div")
  const span = document.createElement("span")
  span.id = "quote"
  span.textContent = quote
  scope.append(span)

  const outside = document.createElement("button")
  outside.id = "outside"
  outside.type = "button"
  outside.textContent = "outside"

  const mount = document.createElement("div")
  mount.id = "mount"

  document.body.append(scope, outside, mount)

  return {
    mount,
    outside,
    selection: pick(quote, { rect: input.rect, anchor: input.anchor }),
  }
}

const trigger = () => document.querySelector('[data-component="message-annotation-trigger"]') as HTMLButtonElement | null
const action = () => document.querySelector('[data-action="message-annotation-trigger-open"]') as HTMLButtonElement | null
const lab = () => document.querySelector('[data-slot="message-annotation-trigger-label"]') as HTMLSpanElement | null
const text = () => document.querySelector('[data-slot="message-annotation-trigger-quote"]') as HTMLSpanElement | null
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

const open = (input: {
  quote?: string
  variant?: MessageAnnotationTriggerVariant
  rect?: typeof lead
  anchor?: typeof tail
  label?: string
} = {}) => {
  const dom = seed({ quote: input.quote, rect: input.rect, anchor: input.anchor })
  let setStore: SetStoreFunction<{
    selection: MessageSelection | undefined
    variant: MessageAnnotationTriggerVariant | undefined
  }>
  const calls = {
    open: [] as MessageSelection[],
    close: 0,
  }

  const off = render(() => {
    const [state, setState] = createStore({
      selection: dom.selection as MessageSelection | undefined,
      variant: input.variant,
    })
    setStore = setState

    return createComponent(MessageAnnotationTrigger, {
      get selection() {
        return state.selection
      },
      get variant() {
        return state.variant
      },
      label: input.label ?? label,
      onOpen: (selection) => calls.open.push(selection),
      onClose: () => {
        calls.close += 1
        setState("selection", undefined)
      },
    })
  }, dom.mount)

  return {
    calls,
    label: input.label ?? label,
    outside: dom.outside,
    selection: dom.selection,
    clear: () => setStore("selection", undefined),
    setVariant: (variant?: MessageAnnotationTriggerVariant) => setStore("variant", variant),
    dispose: off,
  }
}

beforeAll(async () => {
  const entry = "../message-annotation-trigger.tsx"
  dir = new URL(`./.tmp-message-annotation-trigger-${Date.now()}/`, import.meta.url).pathname
  const fs = await import("node:fs/promises")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    `${dir}/entry.ts`,
    [
      'import h from "solid-js/h"',
      'globalThis.React = { createElement: h }',
      'export { createComponent } from "solid-js"',
      'export { createStore } from "solid-js/store"',
      'export { render } from "solid-js/web"',
      `export { MessageAnnotationTrigger } from ${JSON.stringify(entry)}`,
      "",
    ].join("\n"),
  )
  const build = Bun.spawnSync(["bun", "build", `${dir}/entry.ts`, "--outdir", dir, "--target", "browser", "--format", "esm"], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  })
  if (build.exitCode !== 0)
    throw new Error(new TextDecoder().decode(build.stderr) || "Failed to build message annotation trigger test bundle")

  const mod = await import(`${dir}/entry.js`)
  createComponent = mod.createComponent
  createStore = mod.createStore
  render = mod.render
  MessageAnnotationTrigger = mod.MessageAnnotationTrigger
})

afterAll(async () => {
  if (!dir) return
  const fs = await import("node:fs/promises")
  await fs.rm(dir, { recursive: true, force: true })
})

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 640,
  })
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 480,
  })
  Object.defineProperty(HTMLButtonElement.prototype, "focus", {
    configurable: true,
    value: function () {
      focusCount += 1
      return focusDescriptor?.value?.call(this)
    },
  })
  focusCount = 0
  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()

  if (widthDescriptor) Object.defineProperty(window, "innerWidth", widthDescriptor)
  if (heightDescriptor) Object.defineProperty(window, "innerHeight", heightDescriptor)

  if (focusDescriptor) {
    Object.defineProperty(HTMLButtonElement.prototype, "focus", focusDescriptor)
    return
  }

  delete (HTMLButtonElement.prototype as { focus?: unknown }).focus
})

describe("MessageAnnotationTrigger", () => {
  test("renders icon, toolbar, and mini trigger shells without mounting editor UI", async () => {
    const quote = `  ${"assistant\n\nreply   ".repeat(12)} `

    for (const variant of vars) {
      const view = open({ quote, variant })
      await tick()

      const el = trigger()
      if (!el) throw new Error(`Missing trigger for ${variant}`)

      expect(action()).toBe(el)
      expect(el.dataset.variant).toBe(variant)
      expect(el.getAttribute("aria-label")).toBe(view.label)
      expect(el.querySelector('[data-component="icon"][data-size="small"]')).toBeTruthy()
      expect(el.style.left).toBe(variant === "mini" ? "264px" : "228px")
      expect(el.style.top).toBe("81px")
      expect(el.style.transform).toBe(shift(variant))
      expect(document.querySelector('[data-slot="message-annotation-input"]')).toBeNull()
      expect(document.querySelector('[data-action="message-annotation-save"]')).toBeNull()
      expect(document.querySelector('[data-component="message-annotation-popover"]')).toBeNull()

      if (variant === "icon") {
        expect(lab()?.textContent).toBe("")
        expect(lab()?.style.display).toBe("none")
        expect(text()?.textContent).toBe("")
        expect(text()?.style.display).toBe("none")
        expect(el.textContent?.trim()).toBe("")
      }

      if (variant === "toolbar") {
        expect(lab()?.textContent).toBe(view.label)
        expect(lab()?.style.display).toBe("block")
        expect(text()?.textContent).toBe("")
        expect(text()?.style.display).toBe("none")
        expect(el.textContent?.trim()).toBe(view.label)
      }

      if (variant === "mini") {
        expect(lab()?.textContent).toBe("")
        expect(lab()?.style.display).toBe("none")
        expect(text()?.textContent).toBe(preview(quote))
        expect(text()?.style.display).toBe("block")
        expect(text()?.title).toBe(preview(quote))
        expect(el.textContent?.trim()).toBe(preview(quote))
      }

      view.clear()
      await tick()

      expect(trigger()).toBeNull()
      expect(action()).toBeNull()
      expect(view.calls.close).toBe(0)

      view.dispose()
    }
  })

  test("defaults to the icon contract when variant is omitted", async () => {
    const view = open()
    await tick()

    expect(trigger()?.dataset.variant).toBe("icon")
    expect(lab()?.style.display).toBe("none")
    expect(text()?.style.display).toBe("none")
    expect(action()).toBeTruthy()

    view.dispose()
  })

  test("switches visible variants without changing the shared selection contract", async () => {
    const quote = "  assistant\n\nreply   with    space  "
    const view = open({ quote, variant: "icon" })
    await tick()

    expect(trigger()?.dataset.variant).toBe("icon")
    expect(window.getSelection()?.rangeCount).toBe(1)
    expect(view.calls.open).toHaveLength(0)
    expect(view.calls.close).toBe(0)

    view.setVariant("toolbar")
    await tick()

    expect(trigger()?.dataset.variant).toBe("toolbar")
    expect(lab()?.textContent).toBe(view.label)
    expect(lab()?.style.display).toBe("block")
    expect(text()?.textContent).toBe("")
    expect(text()?.style.display).toBe("none")
    expect(window.getSelection()?.rangeCount).toBe(1)
    expect(view.calls.open).toHaveLength(0)
    expect(view.calls.close).toBe(0)

    view.setVariant("mini")
    await tick()

    expect(trigger()?.dataset.variant).toBe("mini")
    expect(lab()?.textContent).toBe("")
    expect(lab()?.style.display).toBe("none")
    expect(text()?.textContent).toBe(preview(quote))
    expect(text()?.style.display).toBe("block")
    expect(window.getSelection()?.rangeCount).toBe(1)
    expect(view.calls.open).toHaveLength(0)
    expect(view.calls.close).toBe(0)

    view.setVariant("icon")
    await tick()

    expect(trigger()?.dataset.variant).toBe("icon")
    expect(lab()?.textContent).toBe("")
    expect(lab()?.style.display).toBe("none")
    expect(text()?.textContent).toBe("")
    expect(text()?.style.display).toBe("none")
    expect(window.getSelection()?.rangeCount).toBe(1)
    expect(view.calls.open).toHaveLength(0)
    expect(view.calls.close).toBe(0)

    view.dispose()
  })

  test("keeps every trigger variant inside the viewport near the top-right edge", async () => {
    for (const variant of vars) {
      const view = open({
        variant,
        anchor: {
          x: 628,
          y: 0,
          width: 8,
          height: 20,
          top: 0,
          right: 636,
          bottom: 20,
          left: 628,
        },
      })
      await tick()

      expect(trigger()).toBeTruthy()
      expect(trigger()?.style.left).toBe("600px")
      expect(trigger()?.style.top).toBe("26px")
      expect(trigger()?.style.transform).toBe(shift(variant))

      view.dispose()
    }
  })

  test("keeps every trigger variant inside the viewport near the bottom edge", async () => {
    for (const variant of vars) {
      const view = open({
        variant,
        anchor: {
          x: 180,
          y: 468,
          width: 40,
          height: 24,
          top: 468,
          right: 220,
          bottom: 492,
          left: 180,
        },
      })
      await tick()

      expect(trigger()).toBeTruthy()
      expect(trigger()?.style.left).toBe("228px")
      expect(trigger()?.style.top).toBe("454px")
      expect(trigger()?.style.transform).toBe(shift(variant))

      view.dispose()
    }
  })

  test("keeps wide variants inside the viewport near the left edge", async () => {
    const quote = `  ${"assistant\n\nreply   ".repeat(12)} `
    const anchor = {
      x: 12,
      y: 72,
      width: 8,
      height: 18,
      top: 72,
      right: 20,
      bottom: 90,
      left: 12,
    }

    const toolbar = open({ quote, variant: "toolbar", anchor })
    await tick()

    expect(trigger()?.style.left).toBe("90px")
    expect(trigger()?.dataset.variant).toBe("toolbar")
    expect(lab()?.style.display).toBe("block")
    toolbar.dispose()

    const mini = open({ quote, variant: "mini", anchor })
    await tick()

    expect(trigger()?.style.left).toBe("264px")
    expect(trigger()?.dataset.variant).toBe("mini")
    expect(text()?.style.display).toBe("block")
    mini.dispose()
  })

  test("activation preserves selection and opens the same trigger contract across variants", async () => {
    for (const variant of vars) {
      const view = open({ variant })
      await tick()

      const el = trigger()
      if (!el) throw new Error(`Missing trigger for ${variant}`)

      const point = new Event("pointerdown", { bubbles: true, cancelable: true })
      el.dispatchEvent(point)
      expect(point.defaultPrevented).toBe(true)
      expect(view.calls.close).toBe(0)
      expect(window.getSelection()?.rangeCount).toBe(1)

      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      el.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true)
      expect(window.getSelection()?.rangeCount).toBe(1)

      const click = new MouseEvent("click", { bubbles: true, cancelable: true })
      el.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
      expect(action()).toBe(el)
      expect(el.dataset.variant).toBe(variant)
      expect(plain(view.calls.open)).toEqual([plain(view.selection)])
      expect(view.calls.close).toBe(0)
      expect(window.getSelection()?.rangeCount).toBe(1)
      expect(focusCount).toBe(0)

      view.dispose()
    }
  })

  test("outside pointerdown closes every variant without clearing selection", async () => {
    for (const variant of vars) {
      const view = open({ variant })
      await tick()

      expect(trigger()).toBeTruthy()
      view.outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))
      await tick()

      expect(view.calls.open).toHaveLength(0)
      expect(view.calls.close).toBe(1)
      expect(trigger()).toBeNull()
      expect(window.getSelection()?.rangeCount).toBe(1)

      view.dispose()
    }
  })

  test("selection collapse closes every trigger variant", async () => {
    for (const variant of vars) {
      const view = open({ variant })
      await tick()

      expect(trigger()).toBeTruthy()
      window.getSelection()?.removeAllRanges()
      document.dispatchEvent(new Event("selectionchange"))
      await tick()

      expect(view.calls.close).toBe(1)
      expect(trigger()).toBeNull()

      view.dispose()
    }
  })

  test("scroll closes every variant without clearing selection", async () => {
    for (const variant of vars) {
      const view = open({ variant })
      await tick()

      expect(trigger()).toBeTruthy()
      window.dispatchEvent(new Event("scroll"))
      await tick()

      expect(view.calls.close).toBe(1)
      expect(trigger()).toBeNull()
      expect(window.getSelection()?.rangeCount).toBe(1)

      view.dispose()
    }
  })

  test("resize closes every variant without clearing selection", async () => {
    for (const variant of vars) {
      const view = open({ variant })
      await tick()

      expect(trigger()).toBeTruthy()
      window.dispatchEvent(new Event("resize"))
      await tick()

      expect(view.calls.close).toBe(1)
      expect(trigger()).toBeNull()
      expect(window.getSelection()?.rangeCount).toBe(1)

      view.dispose()
    }
  })
})
