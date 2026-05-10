/** @jsxImportSource solid-js */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { BrowserAnnotation } from "@/context/browser-types"

let PromptAttachmentArea: typeof import("./attachment-area").PromptAttachmentArea
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

function createImageAttachment(id: string) {
  return {
    type: "image" as const,
    id,
    filename: `${id}.png`,
    mime: "image/png",
    dataUrl: "data:image/png;base64,AAAA",
  }
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
  dispose = render(
    () => (
      <PromptAttachmentArea
        imageAttachments={[createImageAttachment("receipt")]}
        onOpen={() => {}}
        onRemove={() => {}}
        removeLabel="Remove attachment"
      />
    ),
    host,
  )
  await flush()
  return host
}

beforeAll(async () => {
  mock.module("solid-js", () => import("solid-js/dist/solid.js"))
  mock.module("solid-js/store", () => import("solid-js/store/dist/store.js"))
  mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"))
  mock.module("@opencode-ai/ui/tooltip", () => ({
    Tooltip: (props: { children?: import("solid-js").JSX.Element }) => <div>{props.children}</div>,
  }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => <span /> }))
  const { default: h } = await import("solid-js/h")
  Object.assign(globalThis, {
    React: { Fragment: h.Fragment, createElement: h },
  })
  createAnnotationStoreForTest = (await import("../../context/annotation-store")).createAnnotationStoreForTest
  mock.module("@/context/annotation-store", () => ({
    useAnnotationStore: () => annotations,
  }))

  render = (await import("solid-js/web")).render
  PromptAttachmentArea = (await import("./attachment-area")).PromptAttachmentArea
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

describe("PromptAttachmentArea", () => {
  test("renders singular annotation capsule in the prompt attachment area", async () => {
    await mount({ annotations: [createAnnotation("1")] })

    const area = document.querySelector('[data-component="prompt-attachment-area"]')
    expect(area).toBeTruthy()
    expect(area?.textContent).toContain("1 anotación")
    expect(area?.textContent).toContain("receipt.png")
    expect(area?.textContent).not.toContain("Comment 1")
  })

  test("renders plural annotation capsule in the prompt attachment area", async () => {
    await mount({ annotations: [createAnnotation("1"), createAnnotation("2")] })

    expect(document.querySelector('[data-component="prompt-attachment-area"]')?.textContent).toContain("2 anotaciones")
  })
})
