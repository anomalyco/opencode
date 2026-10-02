import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { LineComment } from "./comments"

let createCommentSessionForTest: typeof import("./comments").createCommentSessionForTest

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  const mod = await import("./comments")
  createCommentSessionForTest = mod.createCommentSessionForTest
})

function line(file: string, id: string, time: number): LineComment {
  return {
    id,
    file,
    comment: id,
    time,
    selection: { start: 1, end: 1 },
  }
}

describe("comments session indexing", () => {
  test("keeps file list behavior and aggregate chronological order", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a-late", 30), line("a.ts", "a-early", 10)],
        "b.ts": [line("b.ts", "b-mid", 20)],
      })

      expect(comments.list("a.ts").map((item) => item.id)).toEqual(["a-late", "a-early"])
      expect(comments.all().map((item) => item.id)).toEqual(["a-early", "b-mid", "a-late"])

      const next = comments.add({
        file: "b.ts",
        comment: "next",
        selection: { start: 2, end: 2 },
      })

      expect(comments.list("b.ts").map((item) => item.id)).toEqual(["b-mid", next.id])
      expect(comments.all().map((item) => item.id)).toEqual(["a-early", "b-mid", "a-late", next.id])

      comments.update("a.ts", "a-early", "edited")
      expect(comments.list("a.ts").map((item) => item.comment)).toEqual(["a-late", "edited"])

      dispose()
    })
  })

  test("remove updates file and aggregate indexes and clears focus only for the same file", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a1", 10), line("a.ts", "shared", 20)],
        "b.ts": [line("b.ts", "shared", 30)],
      })

      comments.setFocus({ file: "b.ts", id: "shared" })
      comments.remove("a.ts", "shared")
      expect(comments.focus()).toEqual({ file: "b.ts", id: "shared" })

      comments.setFocus({ file: "a.ts", id: "a1" })
      comments.setActive({ file: "a.ts", id: "a1" })
      comments.remove("a.ts", "a1")

      expect(comments.list("a.ts")).toEqual([])
      expect(comments.all().map((item) => `${item.file}:${item.id}`)).toEqual(["b.ts:shared"])
      expect(comments.focus()).toBeNull()
      expect(comments.active()).toEqual({ file: "a.ts", id: "a1" })

      dispose()
    })
  })

  test.each(["replace", "clear"] as const)("%s resets comment state and focus", (action) => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a1", 10)],
      })

      comments.setFocus({ file: "a.ts", id: "a1" })
      comments.setActive({ file: "a.ts", id: "a1" })
      if (action === "replace") comments.replace([line("b.ts", "b1", 30)])
      if (action === "clear") comments.clear()

      expect(comments.list("a.ts")).toEqual([])
      expect(comments.all().map((item) => item.id)).toEqual(action === "replace" ? ["b1"] : [])
      expect(comments.focus()).toBeNull()
      expect(comments.active()).toBeNull()

      dispose()
    })
  })
})
