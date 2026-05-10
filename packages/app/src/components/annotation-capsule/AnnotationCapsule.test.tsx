/** @jsxImportSource solid-js */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { BrowserAnnotation } from "@/context/browser-types"

let AnnotationCapsule: typeof import("./AnnotationCapsule").AnnotationCapsule
let createAnnotationStoreForTest: typeof import("../../context/annotation-store").createAnnotationStoreForTest
let annotations: ReturnType<typeof import("../../context/annotation-store").createAnnotationStoreForTest>
let render: typeof import("solid-js/web").render
let dispose: VoidFunction | undefined

function createAnnotation(id: string) {
  return {
    id,
    createdAt: 1,
    pageTitle: "Checkout",
    pageUrl: "https://opencode.ai/checkout",
    userComment: `Comment ${id}`,
    element: {
      selector: `button.cta-${id}`,
      tagName: "button",
      role: "button",
      accessibleName: "Buy now",
      visibleText: "Buy now",
      attributes: {},
      boundingBox: { x: 1, y: 2, width: 3, height: 4 },
    },
    preview: {},
    context: {},
  } satisfies BrowserAnnotation
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mount(initial?: Parameters<typeof createAnnotationStoreForTest>[0]) {
  annotations = createAnnotationStoreForTest(initial)
  const host = document.createElement("div")
  document.body.append(host)
  dispose = render(AnnotationCapsule, host)
  await flush()
  return host
}

beforeAll(async () => {
  mock.module("solid-js", () => import("solid-js/dist/solid.js"))
  mock.module("solid-js/store", () => import("solid-js/store/dist/store.js"))
  mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"))
  const { default: h } = await import("solid-js/h")
  Object.assign(globalThis, {
    React: { Fragment: h.Fragment, createElement: h },
  })
  createAnnotationStoreForTest = (await import("../../context/annotation-store")).createAnnotationStoreForTest
  mock.module("@/context/annotation-store", () => ({
    useAnnotationStore: () => annotations,
  }))

  render = (await import("solid-js/web")).render
  AnnotationCapsule = (await import("./AnnotationCapsule")).AnnotationCapsule
})

beforeEach(() => {
  annotations = createAnnotationStoreForTest()
  document.body.innerHTML = ""
  dispose = undefined
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ""
})

describe("AnnotationCapsule", () => {
  test("renders aggregate count only", async () => {
    await mount({ annotations: [createAnnotation("1")] })

    expect(document.body.textContent).toContain("1 anotación")
    expect(document.body.textContent).not.toContain("Comment 1")
    expect(document.querySelector('[data-component="prompt-annotation-capsule"]')).toBeTruthy()
  })

  test("renders plural aggregate count", async () => {
    await mount({ annotations: [createAnnotation("1"), createAnnotation("2")] })

    expect(document.body.textContent).toContain("2 anotaciones")
  })

  test("clears annotations from the capsule action", async () => {
    await mount({ annotations: [createAnnotation("1"), createAnnotation("2")] })

    const button = document.querySelector('button[aria-label="Clear annotations"]')
    expect(button).toBeTruthy()
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await flush()

    expect(annotations.store.annotations).toEqual([])
  })

  test("clears browser page annotation markers from the capsule action", async () => {
    const calls: string[] = []
    window.api = {
      browser: {
        clearAnnotationMarkers: () => {
          calls.push("clearAnnotationMarkers")
          return Promise.resolve()
        },
      },
    } as typeof window.api
    await mount({ annotations: [createAnnotation("1"), createAnnotation("2")] })

    document.querySelector('button[aria-label="Clear annotations"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await flush()

    expect(annotations.store.annotations).toEqual([])
    expect(calls).toEqual(["clearAnnotationMarkers"])
  })

  test("includes visible keyboard focus styling on the clear action", async () => {
    await mount({ annotations: [createAnnotation("1")] })

    const button = document.querySelector('button[aria-label="Clear annotations"]')
    expect(button).toBeTruthy()
    expect(button?.className).toContain("focus-visible:shadow-xs-border-focus")
  })
})
