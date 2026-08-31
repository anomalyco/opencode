import { expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode-ai/client"
import type { FormWithLocation } from "../../../src/context/data"
import { selectSessionAttention } from "../../../src/routes/session/attention"

function permission(id: string, sessionID = "child"): PermissionRequest {
  return { id, sessionID, action: "shell", resources: ["git status"] }
}

function form(id: string, sessionID = "child"): FormWithLocation {
  return {
    id,
    sessionID,
    title: "Questions",
    fields: [{ key: "answer", type: "string", description: "Which strategy should I use?" }],
  }
}

test("prefers a permission when selecting an initial pending request", () => {
  const approval = permission("permission-one")
  expect(selectSessionAttention([approval], [form("form-one")])).toEqual({ type: "permission", request: approval })
})

test("keeps an active question mounted when another subagent requests permission", () => {
  const question = form("form-one", "child-a")
  const current = selectSessionAttention([], [question])
  const approval = permission("permission-one", "child-b")

  expect(selectSessionAttention([approval], [question], current)).toEqual({ type: "form", request: question })
})

test("advances to the next request after the current owner responds", () => {
  const approval = permission("permission-one")
  const question = form("form-one", "child-b")
  const current = selectSessionAttention([approval], [question])

  expect(selectSessionAttention([], [question], current)).toEqual({ type: "form", request: question })
  expect(selectSessionAttention([], [], { type: "form", request: question })).toBeUndefined()
})
