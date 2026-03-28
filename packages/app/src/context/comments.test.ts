import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { LineComment } from "./comments"

let createCommentSessionForTest: typeof import("./comments").createCommentSessionForTest

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
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
      const now = Date.now()
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a-late", now + 20_000), line("a.ts", "a-early", now + 1_000)],
        "b.ts": [line("b.ts", "b-mid", now + 10_000)],
      })

      expect(comments.list("a.ts").map((item) => item.id)).toEqual(["a-late", "a-early"])
      expect(comments.all().map((item) => item.id)).toEqual(["a-early", "b-mid", "a-late"])

      const next = comments.add({
        file: "b.ts",
        comment: "next",
        selection: { start: 2, end: 2 },
      })

      expect(comments.list("b.ts").at(-1)?.id).toBe(next.id)
      expect(comments.all().map((item) => item.time)).toEqual(
        comments
          .all()
          .map((item) => item.time)
          .slice()
          .sort((a, b) => a - b),
      )

      dispose()
    })
  })

  test("remove updates file and aggregate indexes consistently", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a1", 10), line("a.ts", "shared", 20)],
        "b.ts": [line("b.ts", "shared", 30)],
      })

      comments.setFocus({ file: "a.ts", id: "shared" })
      comments.setActive({ file: "a.ts", id: "shared" })
      comments.remove("a.ts", "shared")

      expect(comments.list("a.ts").map((item) => item.id)).toEqual(["a1"])
      expect(
        comments
          .all()
          .filter((item) => item.id === "shared")
          .map((item) => item.file),
      ).toEqual(["b.ts"])
      expect(comments.focus()).toBeNull()
      expect(comments.active()).toEqual({ file: "a.ts", id: "shared" })

      dispose()
    })
  })

  test("clear resets file and aggregate indexes plus focus state", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a1", 10)],
      })

      const next = comments.add({
        file: "b.ts",
        comment: "next",
        selection: { start: 2, end: 2 },
      })

      comments.setActive({ file: "b.ts", id: next.id })
      comments.clear()

      expect(comments.list("a.ts")).toEqual([])
      expect(comments.list("b.ts")).toEqual([])
      expect(comments.all()).toEqual([])
      expect(comments.focus()).toBeNull()
      expect(comments.active()).toBeNull()

      dispose()
    })
  })

  test("remove keeps focus when same comment id exists in another file", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "shared", 10)],
        "b.ts": [line("b.ts", "shared", 20)],
      })

      comments.setFocus({ file: "b.ts", id: "shared" })
      comments.remove("a.ts", "shared")

      expect(comments.focus()).toEqual({ file: "b.ts", id: "shared" })
      expect(comments.list("a.ts")).toEqual([])
      expect(comments.list("b.ts").map((item) => item.id)).toEqual(["shared"])

      dispose()
    })
  })

  test("setFocus and setActive updater callbacks receive current state", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest()

      comments.setFocus({ file: "a.ts", id: "a1" })
      comments.setFocus((current) => {
        expect(current).toEqual({ file: "a.ts", id: "a1" })
        return { file: "b.ts", id: "b1" }
      })

      comments.setActive({ file: "c.ts", id: "c1" })
      comments.setActive((current) => {
        expect(current).toEqual({ file: "c.ts", id: "c1" })
        return null
      })

      expect(comments.focus()).toEqual({ file: "b.ts", id: "b1" })
      expect(comments.active()).toBeNull()

      dispose()
    })
  })

  test("update changes only the targeted comment body", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a1", 10), line("a.ts", "a2", 20)],
      })

      comments.update("a.ts", "a2", "edited")

      expect(comments.list("a.ts").map((item) => item.comment)).toEqual(["a1", "edited"])

      dispose()
    })
  })

  test("replace swaps comment state and clears focus state", () => {
    createRoot((dispose) => {
      const comments = createCommentSessionForTest({
        "a.ts": [line("a.ts", "a1", 10)],
      })

      comments.setFocus({ file: "a.ts", id: "a1" })
      comments.setActive({ file: "a.ts", id: "a1" })
      comments.replace([line("b.ts", "b1", 30)])

      expect(comments.list("a.ts")).toEqual([])
      expect(comments.list("b.ts").map((item) => item.id)).toEqual(["b1"])
      expect(comments.focus()).toBeNull()
      expect(comments.active()).toBeNull()

      dispose()
    })
  })
})
