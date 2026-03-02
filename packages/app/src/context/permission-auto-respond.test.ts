import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/util/encode"
import { autoRespondsPermission } from "./permission-auto-respond"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (sessionID: string) =>
  ({
    sessionID,
  }) as Pick<PermissionRequest, "sessionID">

describe("autoRespondsPermission", () => {
  test("uses a parent session's directory-scoped auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("uses a parent session's legacy auto-accept key", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(autoRespondsPermission({ root: true }, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("defaults to auto-accept when no lineage override exists", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" }), session({ id: "other" })]
    const autoAccept = {
      other: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("inherits a parent session's false override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("prefers a child override over parent override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
      [`${base64Encode(directory)}/child`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })
})
