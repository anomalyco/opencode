import { expect, test } from "bun:test"
import {
  createDialogSessionListKey,
  createDialogSessionItems,
  createDialogSessionListQuery,
  currentDialogSessionSearch,
  nextDialogSessionBrowseOrder,
} from "../../src/component/dialog-session-list"

test("dialog session list requests root sessions for the default picker", () => {
  const query = createDialogSessionListQuery({ query: "", filter: { scope: "project" } })

  expect(query).toEqual({ scope: "project", roots: true, limit: 100 })
  expect("start" in query).toBe(false)
  expect("search" in query).toBe(false)
})

test("dialog session search preserves scope filters while requesting root sessions", () => {
  const query = createDialogSessionListQuery({ query: "deploy", filter: { path: "packages/opencode" } })

  expect(query).toEqual({ path: "packages/opencode", roots: true, limit: 30, search: "deploy" })
})

test("dialog browse order waits for loaded sessions before freezing", () => {
  expect(nextDialogSessionBrowseOrder({ current: undefined, result: undefined })).toBe(undefined)

  const loaded = nextDialogSessionBrowseOrder({
    current: undefined,
    result: {
      key: "project",
      query: "",
      sessions: [
        { id: "old", time: { updated: 1 } },
        { id: "child", parentID: "new", time: { updated: 3 } },
        { id: "new", time: { updated: 2 } },
      ],
    },
  })

  expect(loaded).toEqual({ key: "project", ids: ["new", "old"] })
  expect(
    nextDialogSessionBrowseOrder({
      current: loaded,
      result: { key: "project", query: "", sessions: [{ id: "newer", time: { updated: 4 } }] },
    }),
  ).toBe(loaded)
})

test("dialog sessions use synced roots while root browse is loading", () => {
  const sessions = createDialogSessionItems({
    browse: undefined,
    current: undefined,
    pinned: [],
    query: "",
    remote: undefined,
    synced: [
      { id: "root", time: { updated: 1 } },
      { id: "child", parentID: "root", time: { updated: 2 } },
    ],
  })

  expect(sessions.map((session) => session.id)).toEqual(["root"])
})

test("dialog sessions preserve current root outside the browse page", () => {
  const sessions = createDialogSessionItems({
    browse: [{ id: "visible", title: "visible", time: { updated: 2 } }],
    current: "current-root",
    pinned: [],
    query: "",
    remote: undefined,
    synced: [{ id: "current-root", title: "current", time: { updated: 1 } }],
  })

  expect(sessions.map((session) => session.id)).toEqual(["visible", "current-root"])
})

test("dialog search filters pinned and unpinned sessions", () => {
  const sessions = createDialogSessionItems({
    browse: [
      { id: "pinned-match", title: "deploy fix", time: { updated: 3 } },
      { id: "pinned-miss", title: "readme update", time: { updated: 2 } },
      { id: "unpinned-match", title: "deploy docs", time: { updated: 1 } },
    ],
    current: undefined,
    pinned: ["pinned-match", "pinned-miss"],
    query: "deploy",
    remote: undefined,
    synced: [],
  })

  expect(sessions.map((session) => session.id)).toEqual(["pinned-match", "unpinned-match"])
})

test("dialog search augments local browse with current remote results", () => {
  const key = createDialogSessionListKey({ query: "deploy", filter: { scope: "project" } })
  const remote = currentDialogSessionSearch({
    key,
    query: "deploy",
    result: {
      key,
      query: "deploy",
      sessions: [{ id: "remote-match", title: "deploy remote", time: { updated: 4 } }],
    },
  })
  const sessions = createDialogSessionItems({
    browse: [{ id: "local-match", title: "deploy local", time: { updated: 1 } }],
    current: undefined,
    pinned: [],
    query: "deploy",
    remote,
    synced: [],
  })

  expect(sessions.map((session) => session.id)).toEqual(["local-match", "remote-match"])
})

test("dialog search ignores stale remote results", () => {
  const remote = currentDialogSessionSearch({
    key: createDialogSessionListKey({ query: "deploy", filter: { scope: "project" } }),
    query: "deploy",
    result: {
      key: createDialogSessionListKey({ query: "readme", filter: { scope: "project" } }),
      query: "readme",
      sessions: [{ id: "stale", title: "deploy stale", time: { updated: 4 } }],
    },
  })

  expect(remote).toBe(undefined)
})
