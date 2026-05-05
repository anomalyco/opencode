import { describe, expect, test } from "bun:test"
import { recentConnectedWorkspaces } from "../../../../src/cli/cmd/tui/component/dialog-workspace-create"

describe("recentConnectedWorkspaces", () => {
  test("returns unique connected workspaces after filtering missing and inactive entries", () => {
    const workspaces = [
      { id: "wrk_a", name: "alpha" },
      { id: "wrk_b", name: "beta" },
      { id: "wrk_c", name: "gamma" },
      { id: "wrk_d", name: "delta" },
      { id: "wrk_e", name: "epsilon" },
    ]
    const status = {
      wrk_a: "connected",
      wrk_b: "disconnected",
      wrk_c: "error",
      wrk_d: "connected",
      wrk_e: "connected",
    } as const

    const { recent } = recentConnectedWorkspaces({
      sessions: [
        { time: { updated: 900 } },
        { workspaceID: "wrk_b", time: { updated: 800 } },
        { workspaceID: "wrk_a", time: { updated: 700 } },
        { workspaceID: "wrk_a", time: { updated: 600 } },
        { workspaceID: "wrk_missing", time: { updated: 500 } },
        { workspaceID: "wrk_c", time: { updated: 400 } },
        { workspaceID: "wrk_d", time: { updated: 300 } },
        { workspaceID: "wrk_e", time: { updated: 200 } },
      ],
      get: (workspaceID) => workspaces.find((workspace) => workspace.id === workspaceID),
      status: (workspaceID) => status[workspaceID as keyof typeof status],
    })

    expect(recent.map((workspace) => workspace.id)).toEqual(["wrk_a", "wrk_d", "wrk_e"])
  })
})
