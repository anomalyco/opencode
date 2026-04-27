import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"

const info = {
  id: SessionID.descending(),
  slug: "test-session",
  projectID: ProjectID.global,
  workspaceID: undefined,
  directory: "/tmp/opencode",
  parentID: undefined,
  summary: undefined,
  share: undefined,
  title: "Test session",
  version: "1.0.0",
  time: {
    created: 1,
    updated: 2,
    compacting: undefined,
    archived: undefined,
  },
  permission: undefined,
  revert: undefined,
} satisfies Session.Info

describe("Session schema", () => {
  test("encodes undefined optional session fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.Info)(info) as Record<string, unknown>

    for (const key of ["workspaceID", "parentID", "summary", "share", "permission", "revert"]) {
      expect(Object.hasOwn(encoded, key)).toBe(false)
    }
    expect(Object.hasOwn(encoded.time as Record<string, unknown>, "compacting")).toBe(false)
    expect(Object.hasOwn(encoded.time as Record<string, unknown>, "archived")).toBe(false)
    expect(JSON.stringify(encoded)).not.toContain("parentID")
  })

  test("encodes undefined optional global session project fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.GlobalInfo)({
      ...info,
      project: {
        id: ProjectID.global,
        name: undefined,
        worktree: "/tmp/opencode",
      },
    }) as Record<string, unknown>

    expect(Object.hasOwn(encoded, "parentID")).toBe(false)
    expect(Object.hasOwn(encoded.project as Record<string, unknown>, "name")).toBe(false)
  })
})
