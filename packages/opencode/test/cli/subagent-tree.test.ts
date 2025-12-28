import { describe, expect, test } from "bun:test"
import {
  filterSubagents,
  getStatusIndicator,
  formatTimeAgo,
  extractAgentType,
  buildSubagentOptions,
  hasSubagents,
  countSubagents,
  countAllDescendants,
  findRootSession,
} from "../../src/cli/cmd/tui/util/subagent-tree"
import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"

const createMockSession = (overrides: Partial<Session> = {}): Session => ({
  id: "ses_test",
  projectID: "proj_test",
  directory: "/test",
  title: "Test Session",
  version: "1.0.0",
  time: {
    created: Date.now() - 60000,
    updated: Date.now(),
  },
  ...overrides,
})

describe("filterSubagents", () => {
  test("returns only direct children of specified parent", () => {
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({ id: "child1", parentID: "root" }),
      createMockSession({ id: "child2", parentID: "root" }),
      createMockSession({ id: "grandchild", parentID: "child1" }),
    ]

    const result = filterSubagents(sessions, "root")

    expect(result.map((x) => x.id)).toEqual(["child1", "child2"])
  })

  test("returns empty array when no children exist", () => {
    const sessions = [createMockSession({ id: "root", parentID: undefined })]

    const result = filterSubagents(sessions, "root")

    expect(result).toEqual([])
  })

  test("returns empty array when parent does not exist", () => {
    const sessions = [
      createMockSession({ id: "a", parentID: undefined }),
      createMockSession({ id: "b", parentID: "a" }),
    ]

    const result = filterSubagents(sessions, "nonexistent")

    expect(result).toEqual([])
  })
})

describe("getStatusIndicator", () => {
  test("returns idle indicator when status is undefined", () => {
    const result = getStatusIndicator(undefined)

    expect(result).toEqual({ icon: "●", status: "idle" })
  })

  test("returns busy indicator for busy status", () => {
    const result = getStatusIndicator({ type: "busy" })

    expect(result).toEqual({ icon: "◐", status: "busy" })
  })

  test("returns retry indicator for retry status", () => {
    const result = getStatusIndicator({ type: "retry", attempt: 1, message: "test", next: Date.now() })

    expect(result).toEqual({ icon: "↻", status: "retry" })
  })

  test("returns idle indicator for idle status", () => {
    const result = getStatusIndicator({ type: "idle" })

    expect(result).toEqual({ icon: "●", status: "idle" })
  })
})

describe("formatTimeAgo", () => {
  test("returns 'now' for timestamps within 10 seconds", () => {
    const result = formatTimeAgo(Date.now() - 5000)

    expect(result).toBe("now")
  })

  test("returns seconds for timestamps between 10s and 1m", () => {
    const result = formatTimeAgo(Date.now() - 30000)

    expect(result).toBe("30s ago")
  })

  test("returns minutes for timestamps between 1m and 1h", () => {
    const result = formatTimeAgo(Date.now() - 5 * 60 * 1000)

    expect(result).toBe("5m ago")
  })

  test("returns hours for timestamps over 1h", () => {
    const result = formatTimeAgo(Date.now() - 2 * 60 * 60 * 1000)

    expect(result).toBe("2h ago")
  })
})

describe("extractAgentType", () => {
  test("extracts agent type from colon-prefixed title", () => {
    const session = createMockSession({ title: "explore: Find authentication patterns" })

    const result = extractAgentType(session)

    expect(result).toBe("explore")
  })

  test("returns 'subagent' when no colon in title", () => {
    const session = createMockSession({ title: "Some random task" })

    const result = extractAgentType(session)

    expect(result).toBe("subagent")
  })

  test("returns 'subagent' when colon is too far in title", () => {
    const session = createMockSession({ title: "This is a very long prefix that exceeds limit: task" })

    const result = extractAgentType(session)

    expect(result).toBe("subagent")
  })

  test("handles librarian agent type", () => {
    const session = createMockSession({ title: "librarian: JWT documentation" })

    const result = extractAgentType(session)

    expect(result).toBe("librarian")
  })
})

describe("buildSubagentOptions", () => {
  test("returns empty array when no subagents", () => {
    const sessions = [createMockSession({ id: "root", parentID: undefined })]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "root")

    expect(result).toEqual([])
  })

  test("builds options sorted by creation time", () => {
    const now = Date.now()
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({
        id: "child2",
        parentID: "root",
        title: "Second",
        time: { created: now - 1000, updated: now },
      }),
      createMockSession({
        id: "child1",
        parentID: "root",
        title: "First",
        time: { created: now - 2000, updated: now },
      }),
    ]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "root")

    expect(result.map((x) => x.id)).toEqual(["child1", "child2"])
  })

  test("includes status from statuses map", () => {
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({ id: "child", parentID: "root", title: "explore: Task" }),
    ]
    const statuses: Record<string, SessionStatus> = {
      child: { type: "busy" },
    }

    const result = buildSubagentOptions(sessions, statuses, "root")

    expect(result[0].status).toBe("busy")
    expect(result[0].statusIcon).toBe("◐")
  })
})

describe("hasSubagents", () => {
  test("returns true when session has children", () => {
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({ id: "child", parentID: "root" }),
    ]

    expect(hasSubagents(sessions, "root")).toBe(true)
  })

  test("returns false when session has no children", () => {
    const sessions = [createMockSession({ id: "root", parentID: undefined })]

    expect(hasSubagents(sessions, "root")).toBe(false)
  })
})

describe("countSubagents", () => {
  test("returns correct count of children", () => {
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({ id: "child1", parentID: "root" }),
      createMockSession({ id: "child2", parentID: "root" }),
      createMockSession({ id: "child3", parentID: "root" }),
    ]

    expect(countSubagents(sessions, "root")).toBe(3)
  })

  test("returns 0 when no children", () => {
    const sessions = [createMockSession({ id: "root", parentID: undefined })]

    expect(countSubagents(sessions, "root")).toBe(0)
  })
})

describe("buildSubagentOptions - tree structure", () => {
  test("builds recursive tree with correct depths", () => {
    const now = Date.now()
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({
        id: "child1",
        parentID: "root",
        title: "explore: Task 1",
        time: { created: now - 3000, updated: now },
      }),
      createMockSession({
        id: "child2",
        parentID: "root",
        title: "librarian: Task 2",
        time: { created: now - 2000, updated: now },
      }),
      createMockSession({
        id: "grandchild1",
        parentID: "child1",
        title: "oracle: Subtask",
        time: { created: now - 1000, updated: now },
      }),
    ]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "root")

    expect(result.map((x) => ({ id: x.id, depth: x.depth }))).toEqual([
      { id: "child1", depth: 0 },
      { id: "grandchild1", depth: 1 },
      { id: "child2", depth: 0 },
    ])
  })

  test("builds deeply nested tree", () => {
    const now = Date.now()
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({
        id: "level1",
        parentID: "root",
        title: "Level 1",
        time: { created: now - 4000, updated: now },
      }),
      createMockSession({
        id: "level2",
        parentID: "level1",
        title: "Level 2",
        time: { created: now - 3000, updated: now },
      }),
      createMockSession({
        id: "level3",
        parentID: "level2",
        title: "Level 3",
        time: { created: now - 2000, updated: now },
      }),
      createMockSession({
        id: "level4",
        parentID: "level3",
        title: "Level 4",
        time: { created: now - 1000, updated: now },
      }),
    ]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "root")

    expect(result.map((x) => ({ id: x.id, depth: x.depth }))).toEqual([
      { id: "level1", depth: 0 },
      { id: "level2", depth: 1 },
      { id: "level3", depth: 2 },
      { id: "level4", depth: 3 },
    ])
  })

  test("handles multiple branches at same level", () => {
    const now = Date.now()
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({
        id: "branch1",
        parentID: "root",
        title: "Branch 1",
        time: { created: now - 5000, updated: now },
      }),
      createMockSession({
        id: "branch2",
        parentID: "root",
        title: "Branch 2",
        time: { created: now - 4000, updated: now },
      }),
      createMockSession({
        id: "branch1_child",
        parentID: "branch1",
        title: "Branch 1 Child",
        time: { created: now - 3000, updated: now },
      }),
      createMockSession({
        id: "branch2_child",
        parentID: "branch2",
        title: "Branch 2 Child",
        time: { created: now - 2000, updated: now },
      }),
    ]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "root")

    expect(result.map((x) => ({ id: x.id, depth: x.depth }))).toEqual([
      { id: "branch1", depth: 0 },
      { id: "branch1_child", depth: 1 },
      { id: "branch2", depth: 0 },
      { id: "branch2_child", depth: 1 },
    ])
  })
})

describe("countAllDescendants", () => {
  test("counts all descendants recursively", () => {
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({ id: "child1", parentID: "root" }),
      createMockSession({ id: "child2", parentID: "root" }),
      createMockSession({ id: "grandchild1", parentID: "child1" }),
      createMockSession({ id: "grandchild2", parentID: "child1" }),
      createMockSession({ id: "greatgrandchild", parentID: "grandchild1" }),
    ]

    expect(countAllDescendants(sessions, "root")).toBe(5)
  })

  test("returns 0 when no descendants", () => {
    const sessions = [createMockSession({ id: "root", parentID: undefined })]

    expect(countAllDescendants(sessions, "root")).toBe(0)
  })

  test("counts only direct children when no grandchildren", () => {
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({ id: "child1", parentID: "root" }),
      createMockSession({ id: "child2", parentID: "root" }),
    ]

    expect(countAllDescendants(sessions, "root")).toBe(2)
  })
})

describe("findRootSession", () => {
  test("returns the root when given a deeply nested session", () => {
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({ id: "child", parentID: "root" }),
      createMockSession({ id: "grandchild", parentID: "child" }),
      createMockSession({ id: "greatgrandchild", parentID: "grandchild" }),
    ]

    const result = findRootSession(sessions, "greatgrandchild")

    expect(result?.id).toBe("root")
  })

  test("returns the session itself when it has no parent", () => {
    const sessions = [createMockSession({ id: "root", parentID: undefined })]

    const result = findRootSession(sessions, "root")

    expect(result?.id).toBe("root")
  })

  test("returns undefined when session not found", () => {
    const sessions = [createMockSession({ id: "root", parentID: undefined })]

    const result = findRootSession(sessions, "nonexistent")

    expect(result).toBeUndefined()
  })

  test("returns the session when parent is not in sessions list", () => {
    const sessions = [createMockSession({ id: "orphan", parentID: "missing_parent" })]

    const result = findRootSession(sessions, "orphan")

    expect(result?.id).toBe("orphan")
  })
})

describe("buildSubagentOptions - isCurrent marking", () => {
  test("marks current session with isCurrent true", () => {
    const now = Date.now()
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({
        id: "child1",
        parentID: "root",
        title: "Child 1",
        time: { created: now - 2000, updated: now },
      }),
      createMockSession({
        id: "child2",
        parentID: "root",
        title: "Child 2",
        time: { created: now - 1000, updated: now },
      }),
    ]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "child1")

    expect(result.find((x) => x.id === "child1")?.isCurrent).toBe(true)
    expect(result.find((x) => x.id === "child2")?.isCurrent).toBe(false)
  })

  test("shows full tree from root when called from nested session", () => {
    const now = Date.now()
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({
        id: "child",
        parentID: "root",
        title: "Child",
        time: { created: now - 3000, updated: now },
      }),
      createMockSession({
        id: "grandchild",
        parentID: "child",
        title: "Grandchild",
        time: { created: now - 2000, updated: now },
      }),
      createMockSession({
        id: "greatgrandchild",
        parentID: "grandchild",
        title: "Great Grandchild",
        time: { created: now - 1000, updated: now },
      }),
    ]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "greatgrandchild")

    expect(result.map((x) => x.id)).toEqual(["child", "grandchild", "greatgrandchild"])
    expect(result.find((x) => x.id === "greatgrandchild")?.isCurrent).toBe(true)
    expect(result.find((x) => x.id === "child")?.isCurrent).toBe(false)
    expect(result.find((x) => x.id === "grandchild")?.isCurrent).toBe(false)
  })

  test("marks correct session when in middle of tree", () => {
    const now = Date.now()
    const sessions = [
      createMockSession({ id: "root", parentID: undefined }),
      createMockSession({
        id: "child",
        parentID: "root",
        title: "Child",
        time: { created: now - 2000, updated: now },
      }),
      createMockSession({
        id: "grandchild",
        parentID: "child",
        title: "Grandchild",
        time: { created: now - 1000, updated: now },
      }),
    ]
    const statuses: Record<string, SessionStatus> = {}

    const result = buildSubagentOptions(sessions, statuses, "child")

    expect(result.find((x) => x.id === "child")?.isCurrent).toBe(true)
    expect(result.find((x) => x.id === "grandchild")?.isCurrent).toBe(false)
  })
})
