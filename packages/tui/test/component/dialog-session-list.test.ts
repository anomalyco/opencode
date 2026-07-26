import { describe, expect, test } from "bun:test"
import {
  createDialogSessionListQuery,
  currentDialogSessionSearch,
  filterDialogSessionList,
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

  test("keeps server-side content matches whose titles do not match", () => {
    const content = { id: "content", title: "Unrelated title" }
    const title = { id: "title", title: "Deploy the app" }
    const unrelated = { id: "unrelated", title: "Other session" }

    expect(
      filterDialogSessionList({
        sessions: [content, title, unrelated],
        resultIDs: new Set([content.id]),
        search: "deploy",
      }),
    ).toEqual([content, title])
  })

  test("does not reuse content matches from a previous query", () => {
    const result = {
      query: "deploy",
      filter: { path: "packages/tui" },
      sessions: [{ id: "content", title: "Unrelated title" }],
    }

    expect(currentDialogSessionSearch(result, { query: "deploy", filter: { path: "packages/tui" } })).toEqual(
      result.sessions,
    )
    expect(
      currentDialogSessionSearch(result, { query: "deployment", filter: { path: "packages/tui" } }),
    ).toBeUndefined()
    expect(currentDialogSessionSearch(result, { query: "deploy", filter: { path: "packages/app" } })).toBeUndefined()
  })
})
