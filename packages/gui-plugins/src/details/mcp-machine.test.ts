import { describe, expect, test } from "bun:test"
import {
  MCP_TOGGLE_TIMEOUT_MS,
  initialMcpState,
  mcpDialogView,
  mcpRowView,
  transitionMcp,
  type McpEvent,
  type McpState,
  type McpTransition,
} from "./mcp-machine"

// The state once a popover lists the servers, as every controller starts.
const mounted = transitionMcp(initialMcpState, { type: "mounted" }).state

// Folds the events in order and returns the last transition.
const replay = (events: readonly McpEvent[], state: McpState = mounted) =>
  events.reduce<McpTransition>((last, event) => transitionMcp(last.state, event), { state, effects: [] })

const toggle = (
  name: string,
  enabled: boolean,
  status: "connected" | "disabled" | "failed" = "connected",
): McpEvent => ({
  type: "toggle.requested",
  name,
  enabled,
  status,
})

const opened: McpEvent = { type: "error.opened", name: "playwright", error: "Connection refused" }

describe("transitionMcp", () => {
  test("toggling one server leaves every other row free to toggle", () => {
    const figma = transitionMcp(mounted, toggle("figma", false))

    expect(figma.effects).toEqual([
      { type: "run-toggle", name: "figma", attempt: 1, enabled: false, timeoutMs: MCP_TOGGLE_TIMEOUT_MS },
    ])
    expect(mcpRowView(figma.state, "figma", "connected")).toEqual({ busy: true, pending: true })
    expect(mcpRowView(figma.state, "off", "disabled")).toEqual({ busy: false, pending: false })

    const off = transitionMcp(figma.state, toggle("off", true, "disabled"))

    expect(off.effects).toEqual([
      { type: "run-toggle", name: "off", attempt: 2, enabled: true, timeoutMs: MCP_TOGGLE_TIMEOUT_MS },
    ])

    const settled = transitionMcp(off.state, { type: "toggle.succeeded", name: "off", attempt: 2 })

    expect(settled.effects).toEqual([{ type: "abort-toggle", attempt: 2 }])
    expect(mcpRowView(settled.state, "off", "connected").busy).toBe(false)
    expect(mcpRowView(settled.state, "figma", "connected").busy).toBe(true)
  })

  test("the row and the error dialog share one toggle per server", () => {
    const retrying = replay([opened, toggle("playwright", true, "failed")])

    expect(retrying.effects).toEqual([
      { type: "run-toggle", name: "playwright", attempt: 2, enabled: true, timeoutMs: MCP_TOGGLE_TIMEOUT_MS },
    ])

    const disable = transitionMcp(retrying.state, toggle("playwright", false, "failed"))

    expect(disable).toEqual({ state: retrying.state, effects: [] })
  })

  test("a server that is still connecting takes no toggle", () => {
    const result = transitionMcp(mounted, {
      type: "toggle.requested",
      name: "waiting",
      enabled: false,
      status: "pending",
    })

    expect(result).toEqual({ state: mounted, effects: [] })
    expect(mcpRowView(mounted, "waiting", "pending")).toEqual({ busy: false, pending: true })
  })

  test("the error dialog stays open while a retry connects and shows the retry's new failure", () => {
    const retrying = replay([opened, toggle("playwright", true, "failed")])

    const pending = transitionMcp(retrying.state, {
      type: "server.synced",
      attempt: 1,
      loaded: true,
      status: { status: "pending" },
    })

    expect(pending.effects).toEqual([])
    expect(mcpDialogView(pending.state, 1, "pending")).toEqual({
      name: "playwright",
      error: "Connection refused",
      copied: false,
      busy: true,
    })

    const failed = replay(
      [
        {
          type: "server.synced",
          attempt: 1,
          loaded: true,
          status: { status: "failed", error: "Port 9222 unreachable" },
        },
        { type: "toggle.failed", name: "playwright", attempt: 2, error: "Port 9222 unreachable", server: true },
      ],
      pending.state,
    )

    // The dialog shows the failure, so no toast repeats it.
    expect(failed.effects).toEqual([{ type: "abort-toggle", attempt: 2 }])
    expect(mcpDialogView(failed.state, 1, "failed")).toEqual({
      name: "playwright",
      error: "Port 9222 unreachable",
      copied: false,
      busy: false,
    })

    const connected = replay(
      [
        toggle("playwright", true, "failed"),
        { type: "server.synced", attempt: 1, loaded: true, status: { status: "connected" } },
      ],
      failed.state,
    )

    expect(connected.effects).toEqual([{ type: "close-dialog", attempt: 1 }])
    expect(mcpDialogView(connected.state, 1, "connected")).toBeUndefined()
  })

  test("a retry that succeeds closes the dialog even when the server list did not change", () => {
    const result = replay([
      opened,
      toggle("playwright", true, "failed"),
      { type: "toggle.succeeded", name: "playwright", attempt: 2 },
    ])

    expect(result.effects).toEqual([
      { type: "abort-toggle", attempt: 2 },
      { type: "close-dialog", attempt: 1 },
    ])
  })

  test("a request that throws shows a toast and keeps the dialog's server error", () => {
    const result = replay([
      opened,
      toggle("playwright", true, "failed"),
      { type: "toggle.failed", name: "playwright", attempt: 2, error: "Network error", server: false },
    ])

    expect(result.effects).toEqual([
      { type: "abort-toggle", attempt: 2 },
      { type: "toast-failed", message: "Network error" },
    ])
    expect(mcpDialogView(result.state, 1, "failed")?.error).toBe("Connection refused")
  })

  test("a failed status without a dialog shows a toast that names the server", () => {
    const result = replay([
      toggle("figma", true, "disabled"),
      { type: "toggle.failed", name: "figma", attempt: 1, error: "404 Not Found", server: true },
    ])

    expect(result.effects).toEqual([
      { type: "abort-toggle", attempt: 1 },
      { type: "toast-failed", message: "figma: 404 Not Found" },
    ])
  })

  test("the server list decides when the dialog closes", () => {
    const open = transitionMcp(mounted, opened).state

    expect(open).toMatchObject({ dialog: { status: "open", attempt: 1 } })

    for (const status of [
      { status: "needs_auth", error: "Sign in" },
      { status: "failed", error: "Connection refused" },
    ] as const)
      expect(transitionMcp(open, { type: "server.synced", attempt: 1, loaded: true, status }).state).toBe(open)

    expect(transitionMcp(open, { type: "server.synced", attempt: 1, loaded: false, status: undefined }).state).toBe(
      open,
    )

    for (const status of [{ status: "disabled" }, undefined] as const) {
      const result = transitionMcp(open, { type: "server.synced", attempt: 1, loaded: true, status })

      expect(result.effects).toEqual([{ type: "close-dialog", attempt: 1 }])
      expect(mcpDialogView(result.state, 1, status?.status)).toBeUndefined()
    }
  })

  test("a sign-in hands over from the dialog to the browser before the resources refresh", () => {
    const result = replay([
      opened,
      toggle("playwright", true, "failed"),
      {
        type: "toggle.authorizing",
        name: "playwright",
        attempt: 2,
        url: "https://auth.example/authorize",
        signIn: { integrationID: "oauth", attemptID: "a1", url: "https://auth.example/authorize", lifetime: 60_000 },
      },
    ])

    expect(result.effects).toEqual([
      { type: "close-dialog", attempt: 1 },
      { type: "open-external", url: "https://auth.example/authorize" },
      {
        type: "open-sign-in",
        name: "playwright",
        signIn: { integrationID: "oauth", attemptID: "a1", url: "https://auth.example/authorize", lifetime: 60_000 },
      },
    ])
    expect(mcpRowView(result.state, "playwright", "needs_auth").busy).toBe(true)
  })

  test("results of an attempt that ended change nothing", () => {
    const timedOut = replay([toggle("figma", false), { type: "toggle.timed-out", name: "figma", attempt: 1 }])

    expect(timedOut.effects).toEqual([
      { type: "abort-toggle", attempt: 1 },
      { type: "toast-timed-out", name: "figma" },
    ])

    for (const event of [
      { type: "toggle.succeeded", name: "figma", attempt: 1 },
      { type: "toggle.failed", name: "figma", attempt: 1, error: "late", server: false },
      { type: "toggle.authorizing", name: "figma", attempt: 1, url: "https://auth.example", signIn: undefined },
    ] satisfies McpEvent[])
      expect(transitionMcp(timedOut.state, event)).toEqual({ state: timedOut.state, effects: [] })
  })

  test("a closed or replaced dialog ignores its late events", () => {
    const first = transitionMcp(mounted, opened).state
    const second = transitionMcp(first, { type: "error.opened", name: "figma", error: "Timeout" })

    expect(second.effects).toEqual([
      { type: "close-dialog", attempt: 1 },
      { type: "open-dialog", attempt: 2, name: "figma" },
    ])

    for (const event of [
      { type: "error.dismissed", attempt: 1 },
      { type: "error.copied", attempt: 1, error: "Connection refused" },
      { type: "server.synced", attempt: 1, loaded: true, status: { status: "connected" } },
    ] satisfies McpEvent[])
      expect(transitionMcp(second.state, event).state).toBe(second.state)
  })

  test("the copied mark follows the error text it copied", () => {
    const copied = replay([opened, { type: "error.copied", attempt: 1, error: "Connection refused" }])

    expect(mcpDialogView(copied.state, 1, "failed")?.copied).toBe(true)

    const changed = transitionMcp(copied.state, {
      type: "server.synced",
      attempt: 1,
      loaded: true,
      status: { status: "failed", error: "Port 9222 unreachable" },
    })

    expect(mcpDialogView(changed.state, 1, "failed")).toMatchObject({ error: "Port 9222 unreachable", copied: false })
  })

  test("a popover that closes and reopens keeps the toggle its dialog's retry started", () => {
    const retrying = replay([opened, toggle("playwright", true, "failed"), { type: "error.dismissed", attempt: 1 }])
    const reopened = replay([{ type: "unmounted" }, { type: "mounted" }], retrying.state)

    expect(reopened.state).toMatchObject({ status: "active", mounts: 1, toggles: [{ name: "playwright", attempt: 2 }] })
    expect(mcpRowView(reopened.state, "playwright", "failed")).toEqual({ busy: true, pending: true })

    // The reopened row and a dialog opened again cannot start a second connect for the same server.
    const again = replay([opened, toggle("playwright", true, "failed")], reopened.state)

    expect(again.effects).toEqual([])
    expect(mcpDialogView(again.state, 3, "failed")?.busy).toBe(true)
    expect(transitionMcp(reopened.state, toggle("playwright", false, "failed")).state).toBe(reopened.state)
  })

  test("a list ends once no popover lists it, no toggle runs and no dialog shows", () => {
    const closed = replay([toggle("figma", false), opened, { type: "unmounted" }])

    expect(closed.state).toMatchObject({ status: "active", mounts: 0 })

    const settled = transitionMcp(closed.state, { type: "toggle.succeeded", name: "figma", attempt: 1 })

    expect(settled.state).toMatchObject({ status: "active", mounts: 0 })

    const dismissed = transitionMcp(settled.state, { type: "error.dismissed", attempt: 2 })

    expect(dismissed.state).toEqual({ status: "disposed" })
    expect(transitionMcp(mounted, { type: "unmounted" }).state).toEqual({ status: "disposed" })

    // A second popover or drawer keeps it while the first one closes.
    const both = transitionMcp(mounted, { type: "mounted" }).state

    expect(transitionMcp(both, { type: "unmounted" }).state).toMatchObject({ status: "active", mounts: 1 })
  })

  test("disposal aborts every toggle and closes the dialog", () => {
    const result = replay([toggle("figma", false), toggle("off", true, "disabled"), opened, { type: "disposed" }])

    expect(result).toEqual({
      state: { status: "disposed" },
      effects: [
        { type: "abort-toggle", attempt: 1 },
        { type: "abort-toggle", attempt: 2 },
        { type: "close-dialog", attempt: 3 },
      ],
    })
    expect(transitionMcp(result.state, toggle("figma", true)).state).toBe(result.state)
  })
})
