import { expect, test } from "bun:test"
import { applyMarkdownWorkerResponse, markdownBlockKey, shouldReleaseMarkdownWorkerState } from "./markdown-worker-protocol"

const token = (content: string): [string, string] => [content, ""]
const response = (id: number, reset: boolean, stable: [string, string][], unstable: [string, string][]) => ({
  type: "highlight" as const,
  id,
  key: "code",
  reset,
  stable,
  unstable,
})

test("accumulates stable worker tokens and replaces the unstable tail", () => {
  const first = applyMarkdownWorkerResponse(undefined, {
    type: "highlight",
    id: 1,
    key: "code",
    reset: true,
    stable: [token("one\n")],
    unstable: [token("tw")],
  })
  const second = applyMarkdownWorkerResponse(first, {
    type: "highlight",
    id: 2,
    key: "code",
    reset: false,
    stable: [token("two\n")],
    unstable: [token("three")],
  })

  expect(second.stable.map((item) => item[0])).toEqual(["one\n", "two\n"])
  expect(second.unstable.map((item) => item[0])).toEqual(["three"])
})

test("increments generation only when the worker resets token identity", () => {
  const first = applyMarkdownWorkerResponse(undefined, response(1, true, [["const", ""]], []))
  const append = applyMarkdownWorkerResponse(first, response(2, false, [[" x", ""]], []))
  const replacement = applyMarkdownWorkerResponse(append, response(3, true, [["let y", ""]], []))
  expect([first.generation, append.generation, replacement.generation]).toEqual([1, 1, 2])
})

test("ignores stale worker responses and resets replacement streams", () => {
  const current = { id: 2, generation: 1, stable: [token("current")], unstable: [] }
  expect(
    applyMarkdownWorkerResponse(current, {
      type: "highlight",
      id: 1,
      key: "code",
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

test("prefixes pending and dispatched block keys with the component owner", () => {
  expect(markdownBlockKey("owner", "message", 2, "code")).toBe("owner:message:2:code")
  expect(markdownBlockKey("owner", undefined, 2, "code")).toBe("owner:block:2")
})
