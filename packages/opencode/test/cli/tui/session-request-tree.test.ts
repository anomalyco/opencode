import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2"
import { sessionPermissionRequest, sessionQuestionRequest } from "../../../src/cli/cmd/tui/routes/session/request-tree"

const session = (id: string, parentID?: string) => ({
  id,
  parentID,
}) as Session

const permission = (id: string, sessionID: string) => ({
  id,
  sessionID,
}) as PermissionRequest

const question = (id: string, sessionID: string) => ({
  id,
  sessionID,
}) as QuestionRequest

describe("session request tree", () => {
  test("finds nested grandchild permission request from root session", () => {
    const root = session("root")
    const all = [root, session("child", "root"), session("grand", "child")]
    const result = sessionPermissionRequest(all, { grand: [permission("perm-grand", "grand")] }, root)

    expect(result?.id).toBe("perm-grand")
  })

  test("finds nested grandchild question request from root session", () => {
    const root = session("root")
    const all = [root, session("child", "root"), session("grand", "child")]
    const result = sessionQuestionRequest(all, { grand: [question("q-grand", "grand")] }, root)

    expect(result?.id).toBe("q-grand")
  })
})
