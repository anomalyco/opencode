import { describe, expect, test } from "bun:test"
import { createHeadlessPermissionFilter, sessionLineage } from "@/cli/cmd/run"

// Tree used throughout (root routing per design-final §4.3: routed asks carry
// the tree ROOT in `sessionID` and the asking session in
// `metadata.originSessionID`):
//
//   ses_root
//   ├── ses_d2          ← driven via `opencode run --session ses_d2`
//   │   └── ses_d3
//   └── ses_foreign
//       └── ses_fchild
const PARENTS: Record<string, string | undefined> = {
  ses_d2: "ses_root",
  ses_d3: "ses_d2",
  ses_foreign: "ses_root",
  ses_fchild: "ses_foreign",
}

function lineageStub(parents: Record<string, string | undefined> = PARENTS) {
  const calls: string[] = []
  return {
    calls,
    lineage: async (sessionID: string) => {
      calls.push(sessionID)
      const chain: string[] = []
      let cursor: string | undefined = sessionID
      while (cursor !== undefined && !chain.includes(cursor)) {
        chain.push(cursor)
        cursor = parents[cursor]
      }
      return chain
    },
  }
}

describe("createHeadlessPermissionFilter", () => {
  test("accepts a depth-3 child's root-routed ask when driving the depth-2 session", async () => {
    const { lineage } = lineageStub()
    const accepts = createHeadlessPermissionFilter({ sessionID: "ses_d2", lineage })

    // The regression from the adversarial review: the old
    // `permission.sessionID !== sessionID → continue` filter dropped this ask
    // (it carries the tree root, not the driven session) and the run hung.
    expect(await accepts({ sessionID: "ses_root", metadata: { originSessionID: "ses_d3" } })).toBe(true)
  })

  test("ignores asks from a foreign subtree of the same root", async () => {
    const { lineage } = lineageStub()
    const accepts = createHeadlessPermissionFilter({ sessionID: "ses_d2", lineage })

    expect(await accepts({ sessionID: "ses_root", metadata: { originSessionID: "ses_fchild" } })).toBe(false)
    expect(await accepts({ sessionID: "ses_root", metadata: { originSessionID: "ses_foreign" } })).toBe(false)
  })

  test("driving the root behaves exactly like before, without any lineage lookups", async () => {
    const { lineage, calls } = lineageStub()
    const accepts = createHeadlessPermissionFilter({ sessionID: "ses_root", lineage })

    // Root's own (unrouted) asks and routed asks from anywhere in the tree all
    // carry the root id — accepted on the fast path, zero extra SDK calls.
    expect(await accepts({ sessionID: "ses_root", metadata: {} })).toBe(true)
    expect(await accepts({ sessionID: "ses_root", metadata: { originSessionID: "ses_fchild" } })).toBe(true)
    expect(calls).toEqual([])

    // Asks addressed to OTHER sessions stay dropped, as before.
    expect(await accepts({ sessionID: "ses_d2", metadata: {} })).toBe(false)
  })

  test("accepts the driven subagent session's own unrouted asks", async () => {
    const { lineage, calls } = lineageStub()
    const accepts = createHeadlessPermissionFilter({ sessionID: "ses_d2", lineage })

    expect(await accepts({ sessionID: "ses_d2", metadata: {} })).toBe(true)
    expect(calls).toEqual([])
  })

  test("fails open on root-routed asks without origin attribution", async () => {
    const { lineage } = lineageStub()
    const accepts = createHeadlessPermissionFilter({ sessionID: "ses_d2", lineage })

    // A routed ask without metadata.originSessionID cannot be attributed;
    // dropping it would hang the run, so it is accepted.
    expect(await accepts({ sessionID: "ses_root", metadata: {} })).toBe(true)
  })

  test("ignores asks addressed to unrelated sessions or trees", async () => {
    const { lineage } = lineageStub()
    const accepts = createHeadlessPermissionFilter({ sessionID: "ses_d2", lineage })

    expect(await accepts({ sessionID: "ses_other_root", metadata: {} })).toBe(false)
    expect(await accepts({ sessionID: "ses_d3", metadata: {} })).toBe(false)
  })

  test("memoizes lineage walks per session", async () => {
    const { lineage, calls } = lineageStub()
    const accepts = createHeadlessPermissionFilter({ sessionID: "ses_d2", lineage })

    expect(await accepts({ sessionID: "ses_root", metadata: { originSessionID: "ses_d3" } })).toBe(true)
    expect(await accepts({ sessionID: "ses_root", metadata: { originSessionID: "ses_d3" } })).toBe(true)

    expect(calls.filter((id) => id === "ses_d3")).toHaveLength(1)
    // One walk to resolve the driven session's root, never repeated.
    expect(calls.filter((id) => id === "ses_d2")).toHaveLength(1)
  })
})

describe("sessionLineage", () => {
  const get = (parents: Record<string, string | undefined>) => async (sessionID: string) =>
    sessionID in parents || Object.values(parents).includes(sessionID)
      ? { parentID: parents[sessionID] }
      : undefined

  test("walks the parent chain up to the root", async () => {
    expect(await sessionLineage(get(PARENTS), "ses_d3")).toEqual(["ses_d3", "ses_d2", "ses_root"])
    expect(await sessionLineage(get(PARENTS), "ses_root")).toEqual(["ses_root"])
  })

  test("terminates on cyclic parent data", async () => {
    expect(await sessionLineage(get({ a: "b", b: "a" }), "a")).toEqual(["a", "b"])
  })

  test("treats lookup failures as the end of the chain", async () => {
    const failing = async (sessionID: string) => {
      if (sessionID === "ses_d2") throw new Error("boom")
      return { parentID: PARENTS[sessionID] }
    }
    expect(await sessionLineage(failing, "ses_d3")).toEqual(["ses_d3", "ses_d2"])
  })
})
