import { describe, expect, test } from "bun:test"
import { createDialogSessionListQuery, loadDialogSessionList } from "../../src/component/dialog-session-list"

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
    expect(await pending).toEqual({ status: "success", data: ["root"] })
  })

  test("reports when the root request returns an error response", async () => {
    const error = new Error("unavailable")
    expect(await loadDialogSessionList({ filter: {}, list: async () => ({ error }) })).toEqual({
      status: "error",
      error,
    })
  })

  test("reports when the root request rejects", async () => {
    const error = new Error("offline")
    expect(
      await loadDialogSessionList({
        filter: {},
        list: () => Promise.reject(error),
      }),
    ).toEqual({ status: "error", error })
  })
})
