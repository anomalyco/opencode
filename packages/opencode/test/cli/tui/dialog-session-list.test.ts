import { expect, test } from "bun:test"
import { createDialogSessionListQuery } from "@/cli/cmd/tui/component/dialog-session-list"

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
