import { describe, expect, test } from "bun:test"
import {
  createDialogSessionListQuery,
  dialogSessionListCategory,
  loadDialogSessionList,
} from "../../src/component/dialog-session-list"

describe("dialog session list", () => {
  test("requests root sessions for the default browse list", () => {
    expect(createDialogSessionListQuery({ filter: { path: "packages/tui" } })).toEqual({
      roots: true,
      limit: 100,
      path: "packages/tui",
    })
  })

  test("requests root sessions for search results", () => {
    expect(createDialogSessionListQuery({ search: " deploy ", filter: { scope: "project" } })).toEqual({
      roots: true,
      limit: 30,
      search: "deploy",
      scope: "project",
    })
  })

  test("keeps the cache usable while the root request is pending", async () => {
    let resolve!: (result: { data: string[] }) => void
    const pending = loadDialogSessionList<string>({
      filter: {},
      list: () => new Promise((done) => (resolve = done)),
    })

    expect(await Promise.race([pending, Promise.resolve("pending")])).toBe("pending")
    resolve({ data: ["root"] })
    expect(await pending).toEqual(["root"])
  })

  test("falls back when the root request returns an error response", async () => {
    expect(await loadDialogSessionList({ filter: {}, list: async () => ({}) })).toBeUndefined()
  })

  test("falls back when the root request rejects", async () => {
    expect(
      await loadDialogSessionList({
        filter: {},
        list: () => Promise.reject(new Error("offline")),
      }),
    ).toBeUndefined()
  })

  describe("category", () => {
    const now = new Date("2026-08-18T12:00:00Z")

    test("groups archived sessions under Archived", () => {
      expect(dialogSessionListCategory({ archived: 1700000000000, updated: now.getTime(), now })).toBe("Archived")
    })

    test("archived wins over the date bucket even when updated today", () => {
      expect(dialogSessionListCategory({ archived: now.getTime(), updated: now.getTime(), now })).toBe("Archived")
    })

    test("groups sessions updated today under Today", () => {
      expect(dialogSessionListCategory({ updated: now.getTime(), now })).toBe("Today")
    })

    test("groups older sessions under their date", () => {
      const older = new Date("2026-08-15T09:00:00Z")
      expect(dialogSessionListCategory({ updated: older.getTime(), now })).toBe(older.toDateString())
    })

    test("treats a missing archived timestamp as active", () => {
      expect(dialogSessionListCategory({ archived: undefined, updated: now.getTime(), now })).toBe("Today")
    })

    // ArchivedTimestamp is Schema.Finite and accepts 0 and negatives for legacy
    // compatibility, so a truthiness check would misreport these as active.
    test("treats a zero archived timestamp as archived", () => {
      expect(dialogSessionListCategory({ archived: 0, updated: now.getTime(), now })).toBe("Archived")
    })

    test("treats a negative archived timestamp as archived", () => {
      expect(dialogSessionListCategory({ archived: -1, updated: now.getTime(), now })).toBe("Archived")
    })
  })
})
