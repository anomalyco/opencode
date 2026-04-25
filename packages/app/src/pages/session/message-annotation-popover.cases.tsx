import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { createComponent as CreateComponent, createRoot as CreateRoot } from "solid-js"
import type { createStore as CreateStore, SetStoreFunction } from "solid-js/store"
import type { MessageContextItem } from "../../context/prompt"
import type { MessageSelection } from "./message-selection"

let createComponent: typeof CreateComponent
let createRoot: typeof CreateRoot
let createStore: typeof CreateStore
let render: typeof import("solid-js/web").render
let MessageAnnotationPopover: typeof import("./message-annotation-popover").MessageAnnotationPopover
let dir = ""
const cwd = new URL("../../../", import.meta.url).pathname

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext")
const focusDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "focus")

let focused: HTMLTextAreaElement | undefined

const clean = new Set<VoidFunction>()

const hold = (fn: VoidFunction) => {
  let live = true

  const drop = () => {
    if (!live) return
    live = false
    clean.delete(drop)
    fn()
  }

  clean.add(drop)
  return drop
}

const setCrypto = (value: Partial<Crypto>) => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: value as Crypto,
  })
}

const setSecure = (value: boolean) => {
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value,
  })
}

const box = {
  x: 24,
  y: 48,
  width: 120,
  height: 18,
  top: 48,
  right: 144,
  bottom: 66,
  left: 24,
}

const nextBox = {
  x: 220,
  y: 160,
  width: 80,
  height: 20,
  top: 160,
  right: 300,
  bottom: 180,
  left: 220,
}

const createPrompt = () => {
  const [state, setState] = createStore({ items: [] as MessageContextItem[] })

  return {
    context: {
      items: () => state.items,
      add: (item: MessageContextItem) => setState("items", (list) => [...list, item]),
    },
  }
}

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const rect = (value = box) =>
  ({
    ...value,
    toJSON: () => value,
  }) as DOMRect

const setRect = (range: Range, value = box) => {
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(value),
  })
}

const pick = (quote: string, value = box) => {
  const span = document.querySelector("#quote")
  if (!(span instanceof HTMLSpanElement)) throw new Error("Missing quote span")

  span.textContent = quote
  const text = span.firstChild
  if (!(text instanceof Text)) throw new Error("Missing quote text node")

  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, quote.length)
  setRect(range, value)

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)

  return {
    messageID: "msg-1",
    role: "assistant",
    quote,
    rect: value,
  } satisfies MessageSelection
}

const pop = () => document.querySelector('[data-component="message-annotation-popover"]') as HTMLDivElement | null
const head = () => document.querySelector('[data-slot="message-annotation-head"]') as HTMLDivElement | null
const input = () => document.querySelector('[data-component="message-annotation-input"]') as HTMLTextAreaElement | null
const save = () => document.querySelector('[data-action="message-annotation-save"]') as HTMLButtonElement | null
const cancel = () => document.querySelector('[data-action="message-annotation-cancel"]') as HTMLButtonElement | null
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

const change = (value: string) => {
  const el = input()
  if (!el) throw new Error("Missing annotation input")
  el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

const seed = (quote = "assistant reply") => {
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
    selection: pick(quote, box),
  }
}

const open = (quote?: string) => {
  const dom = seed(quote)
  const prompt = createRoot((dispose) => ({ value: createPrompt(), dispose }))
  let setStore: SetStoreFunction<{ selection: MessageSelection | undefined }>

  const off = render(() => {
    const [state, setState] = createStore({ selection: dom.selection as MessageSelection | undefined })
    setStore = setState

    return createComponent(MessageAnnotationPopover, {
      get selection() {
        return state.selection
      },
      add: prompt.value.context.add,
      onClose: () => setState("selection", undefined),
      placeholderLabel: "Add comment",
      saveLabel: "Comment",
      cancelLabel: "Cancel",
      portal: false,
    })
  }, dom.mount)

  const dispose = hold(() => {
    off()
    prompt.dispose()
  })

  return {
    prompt: prompt.value,
    outside: dom.outside,
    close: () => setStore("selection", undefined),
    select: (quote: string, value = nextBox) => setStore("selection", pick(quote, value)),
    dispose,
  }
}

beforeAll(async () => {
  const entry = "../message-annotation-popover.tsx"
  dir = new URL(`./.tmp-message-annotation-popover-${Date.now()}/`, import.meta.url).pathname
  const fs = await import("node:fs/promises")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    `${dir}/entry.ts`,
    [
      'export { createComponent, createRoot } from "solid-js"',
      'export { createStore } from "solid-js/store"',
      'export { render } from "solid-js/web"',
      `export { MessageAnnotationPopover } from ${JSON.stringify(entry)}`,
      "",
    ].join("\n"),
  )
  const build = Bun.spawnSync(
    ["bun", "build", `${dir}/entry.ts`, "--outdir", dir, "--target", "browser", "--format", "esm"],
    {
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    },
  )
  if (build.exitCode !== 0)
    throw new Error(new TextDecoder().decode(build.stderr) || "Failed to build message annotation popover test bundle")

  const mod = await import(`${dir}/entry.js`)
  createComponent = mod.createComponent
  createRoot = mod.createRoot
  createStore = mod.createStore
  render = mod.render
  MessageAnnotationPopover = mod.MessageAnnotationPopover
})

afterAll(async () => {
  if (!dir) return
  const fs = await import("node:fs/promises")
  await fs.rm(dir, { recursive: true, force: true })
})

beforeEach(() => {
  setCrypto({ randomUUID: () => "11111111-1111-4111-8111-111111111111" })
  setSecure(true)
  Object.defineProperty(HTMLTextAreaElement.prototype, "focus", {
    configurable: true,
    value: function () {
      focused = this as HTMLTextAreaElement
      return focusDescriptor?.value?.call(this)
    },
  })
  focused = undefined
  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  for (const drop of [...clean]) {
    drop()
  }

  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()

  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  }

  if (secureDescriptor) {
    Object.defineProperty(globalThis, "isSecureContext", secureDescriptor)
  } else {
    delete (globalThis as { isSecureContext?: boolean }).isSecureContext
  }

  if (focusDescriptor) {
    Object.defineProperty(HTMLTextAreaElement.prototype, "focus", focusDescriptor)
    return
  }

  delete (HTMLTextAreaElement.prototype as { focus?: unknown }).focus
})

describe("MessageAnnotationPopover", () => {
  test("saving a comment creates a message annotation item", async () => {
    const view = open("assistant reply\nwith extra   space")
    await tick()

    expect(pop()).toBeTruthy()
    expect(input()).toBeTruthy()
    expect(save()).toBeTruthy()
    expect(cancel()).toBeTruthy()
    expect(focused).toBeTruthy()
    expect(input()?.getAttribute("placeholder")).toBe("Add comment")
    expect(save()?.textContent).toBe("Comment")
    expect(cancel()?.textContent).toBe("Cancel")
    expect(save()?.disabled).toBe(true)

    change("Needs more detail")
    expect(save()?.disabled).toBe(false)
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    input()!.dispatchEvent(event)
    await tick()

    expect(event.defaultPrevented).toBe(true)
    expect(plain(view.prompt.context.items())).toEqual([
      {
        type: "message",
        annotationID: "11111111-1111-4111-8111-111111111111",
        messageID: "msg-1",
        role: "assistant",
        quote: "assistant reply\nwith extra   space",
        preview: "assistant reply with extra space",
        comment: "Needs more detail",
      },
    ])
    expect(pop()).toBeNull()
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0)

    view.dispose()
  })

  test("Shift+Enter keeps the popover open for multiline comments", async () => {
    const view = open()
    await tick()

    change("Line 1")
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    input()!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeTruthy()

    change("Line 1\nLine 2")
    save()!.click()

    expect(plain(view.prompt.context.items())).toEqual([
      {
        type: "message",
        annotationID: "11111111-1111-4111-8111-111111111111",
        messageID: "msg-1",
        role: "assistant",
        quote: "assistant reply",
        preview: "assistant reply",
        comment: "Line 1\nLine 2",
      },
    ])

    view.dispose()
  })

  test("blank Enter is a no-op and blank primary stays disabled", async () => {
    const view = open()
    await tick()

    expect(pop()).toBeTruthy()
    expect(save()?.disabled).toBe(true)
    change("   ")
    expect(save()?.disabled).toBe(true)

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    input()!.dispatchEvent(event)
    await tick()

    expect(event.defaultPrevented).toBe(true)
    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeTruthy()
    expect(input()?.value).toBe("   ")
    expect(save()?.disabled).toBe(true)

    view.dispose()
  })

  test("Escape closes the popover without saving", async () => {
    const view = open()
    await tick()

    expect(pop()).toBeTruthy()
    change("discard")
    input()!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    )
    await tick()

    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeNull()

    view.dispose()
  })

  test("cancel closes the popover without saving", async () => {
    const view = open()
    await tick()

    expect(pop()).toBeTruthy()
    change("discard")
    cancel()!.click()
    await tick()

    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeNull()

    view.dispose()
  })

  test("reselecting a valid quote resets preview, position, and focus", async () => {
    const view = open("assistant reply")
    await tick()

    expect(head()?.textContent).toBe("assistant reply")
    expect(pop()?.style.left).toBe("84px")
    expect(pop()?.style.top).toBe("36px")

    change("draft")
    focused = undefined

    view.select("assistant reply\nwith extra   detail", nextBox)
    await tick()

    const field = input()
    if (!field) throw new Error("Missing annotation input")

    expect(head()?.textContent).toBe("assistant reply with extra detail")
    expect(field.value).toBe("")
    expect(save()?.disabled).toBe(true)
    expect(pop()?.style.left).toBe("260px")
    expect(pop()?.style.top).toBe("148px")
    expect(focused === field).toBe(true)
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(0)

    view.dispose()
  })

  test("outside click closes the popover", async () => {
    const view = open()
    await tick()

    expect(pop()).toBeTruthy()
    view.outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    await tick()

    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeNull()

    view.dispose()
  })

  test("scroll closes the popover", async () => {
    const view = open()
    await tick()

    expect(pop()).toBeTruthy()
    window.dispatchEvent(new Event("scroll"))
    await tick()

    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeNull()

    view.dispose()
  })

  test("resize closes the popover", async () => {
    const view = open()
    await tick()

    expect(pop()).toBeTruthy()
    window.dispatchEvent(new Event("resize"))
    await tick()

    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeNull()

    view.dispose()
  })

  test("selection collapse closes the popover", async () => {
    const view = open()
    await tick()

    expect(pop()).toBeTruthy()
    view.outside.focus()
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    await tick()

    expect(view.prompt.context.items()).toHaveLength(0)
    expect(pop()).toBeNull()

    view.dispose()
  })
})
