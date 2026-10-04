import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { SessionID } from "@opencode/schema/session-id"
import { describe, expect, test } from "bun:test"
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client/promise"
import { sessionPermissionRequest, sessionFormRequest, sessionTreeIDs } from "@/session/requests/session-request-tree"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as SessionInfo

const permission = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
  }) as PermissionRequest

const question = (id: string, sessionID: string) =>
  ({
    id: Form.ID.make(id, { disableChecks: true }),
    sessionID,
    title: "Questions",
    metadata: { kind: "question" },
    fields: [{ key: "q0", type: "string" }],
  }) as FormInfo

describe("sessionTreeIDs", () => {
  test("returns only the current session and its descendants", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
      session({ id: "sibling", parentID: "root" }),
      session({ id: "other" }),
    ]

    expect(sessionTreeIDs(sessions, SessionID.make("child", { disableChecks: true }))).toEqual([
      SessionID.make("child", { disableChecks: true }),
      SessionID.make("grand", { disableChecks: true }),
    ])
    expect(sessionTreeIDs(sessions, SessionID.make("root", { disableChecks: true }))).toEqual([
      SessionID.make("root", { disableChecks: true }),
      SessionID.make("child", { disableChecks: true }),
      SessionID.make("sibling", { disableChecks: true }),
      SessionID.make("grand", { disableChecks: true }),
    ])
    expect(sessionTreeIDs(sessions)).toEqual([])
  })
})

const tree = [
  session({ id: "root" }),
  session({ id: "child", parentID: "root" }),
  session({ id: "grand", parentID: "child" }),
  session({ id: "other" }),
]
const search = (id: string, sessionID: string) => ({
  ...question(id, sessionID),
  metadata: { kind: "websearch.provider" },
})

describe("sessionPermissionRequest", () => {
  const both = { root: [permission("perm-root", "root")], child: [permission("perm-child", "child")] }

  test.each([
    ["prefers the current session permission", both, undefined, "perm-root"],
    [
      "returns a nested child permission",
      { grand: [permission("perm-grand", "grand")], other: [permission("perm-other", "other")] },
      undefined,
      "perm-grand",
    ],
    [
      "returns undefined without a matching tree permission",
      { other: [permission("perm-other", "other")] },
      undefined,
      undefined,
    ],
    [
      "skips filtered permissions in the current tree",
      both,
      (item: PermissionRequest) => item.id !== "perm-root",
      "perm-child",
    ],
    ["returns undefined when all tree permissions are filtered out", both, () => false, undefined],
  ])("%s", (_name, permissions, include, id) => {
    expect(
      sessionPermissionRequest(tree, permissions, SessionID.make("root", { disableChecks: true }), include)?.id,
    ).toBe(id ? Permission.ID.make(id, { disableChecks: true }) : undefined)
  })
})

describe("sessionFormRequest", () => {
  test.each([
    [
      "prefers the current session question",
      { root: [question("q-root", "root")], child: [question("q-child", "child")] },
      "q-root",
    ],
    ["returns a nested child question", { grand: [question("q-grand", "grand")] }, "q-grand"],
    [
      "skips unsupported forms",
      { root: [{ ...question("form", "root"), metadata: { kind: "integration" } }] },
      undefined,
    ],
    ["finds web search consent in a nested child session", { child: [search("search", "child")] }, "search"],
    [
      "keeps web search ahead of a later question",
      { root: [search("search", "root"), question("q", "root")] },
      "search",
    ],
    ["keeps a question ahead of a later web search", { root: [question("q", "root"), search("search", "root")] }, "q"],
    [
      "keeps the current session ahead of a child question",
      { root: [search("search", "root")], child: [question("q", "child")] },
      "search",
    ],
  ])("%s", (_name, forms, id) => {
    expect(sessionFormRequest(tree, forms, SessionID.make("root", { disableChecks: true }))?.id).toBe(
      id ? Form.ID.make(id, { disableChecks: true }) : undefined,
    )
  })
})
