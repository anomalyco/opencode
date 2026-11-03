import { expect, test } from "bun:test"
import {
  applyMarkdownWorkerResponse,
  applyProjectionBlocks,
  diffProjectionBlocks,
  markdownBlockKey,
  shouldReleaseMarkdownWorkerState,
} from "./markdown-worker-protocol"
import { project, type Block, type Projection } from "./markdown-stream"

const token = (content: string): [string, string] => [content, ""]

const response = (id: number, reset: boolean, stable: [string, string][], unstable: [string, string][]) => ({
  type: "highlight" as const,
  id,
  key: "code",
  language: "typescript",
  reset,
  stable,
  unstable,
})

test("accumulates stable worker tokens and replaces the unstable tail", () => {
  const first = applyMarkdownWorkerResponse(undefined, {
    type: "highlight",
    id: 1,
    key: "code",
    language: "typescript",
    reset: true,
    stable: [token("one\n")],
    unstable: [token("tw")],
  })

  const second = applyMarkdownWorkerResponse(first, {
    type: "highlight",
    id: 2,
    key: "code",
    language: "typescript",
    reset: false,
    stable: [token("two\n")],
    unstable: [token("three")],
  })

  expect(second.stable.map((item) => item[0])).toEqual(["one\n", "two\n"])
  expect(second.unstable.map((item) => item[0])).toEqual(["three"])
  expect(second.language).toBe("typescript")
})

test("increments generation only when the worker resets token identity", () => {
  const first = applyMarkdownWorkerResponse(undefined, response(1, true, [["const", ""]], []))
  const append = applyMarkdownWorkerResponse(first, response(2, false, [[" x", ""]], []))
  const replacement = applyMarkdownWorkerResponse(append, response(3, true, [["let y", ""]], []))
  expect([first.generation, append.generation, replacement.generation]).toEqual([1, 1, 2])
})

test("ignores stale worker responses and resets replacement streams", () => {
  const current = { id: 2, generation: 1, language: "typescript", stable: [token("current")], unstable: [] }
  expect(
    applyMarkdownWorkerResponse(current, {
      type: "highlight",
      id: 1,
      key: "code",
      language: "typescript",
      reset: false,
      stable: [token("stale")],
      unstable: [],
    }),
  ).toBe(current)

  expect(
    applyMarkdownWorkerResponse(current, {
      type: "highlight",
      id: 3,
      key: "code",
      language: "typescript",
      reset: true,
      stable: [token("replacement")],
      unstable: [],
    }).stable.map((item) => item[0]),
  ).toEqual(["replacement"])
})

test("releases only the latest completed worker state", () => {
  expect(shouldReleaseMarkdownWorkerState(true, 4, 4)).toBe(true)
  expect(shouldReleaseMarkdownWorkerState(true, 5, 4)).toBe(false)
  expect(shouldReleaseMarkdownWorkerState(false, 4, 4)).toBe(false)
})

test("rebuilds each streamed projection from the blocks that changed", () => {
  const text =
    "# Plan\n\nFirst paragraph.\n\n```ts\nconst a = 1\n```\n\n- item one\n- item two\n\n[docs]: https://example.com\n\nTail"

  const steps = Array.from({ length: Math.ceil(text.length / 3) }, (_, index) => [index * 3 + 3, true] as const)
  const sent: number[] = []

  const final = [...steps, [text.length, false] as const].reduce<{ worker?: Projection; main?: Block[] }>(
    (state, [end, live]) => {
      const worker = project(state.worker, text.slice(0, end), live)
      const diff = diffProjectionBlocks(state.worker?.blocks, worker.blocks)
      // Blocks cross to the main thread by structured clone, so only its own earlier objects can be reused.
      const main = applyProjectionBlocks(state.main, diff.from, structuredClone(diff.blocks))
      sent.push(diff.blocks.length)

      expect(main).toEqual(worker.blocks)
      main.slice(0, diff.from).forEach((block, index) => expect(block).toBe(state.main![index]!))

      return { worker, main }
    },
    {},
  )

  expect(final.worker!.blocks.length).toBeGreaterThan(3)
  expect(sent.slice(-6, -1).every((count) => count < final.worker!.blocks.length)).toBe(true)
})

test("prefixes pending and dispatched block keys with the component owner", () => {
  expect(markdownBlockKey("owner", "message", 2, "code")).toBe("owner:message:2:code")
  expect(markdownBlockKey("owner", undefined, 2, "code")).toBe("owner:block:2")
})
