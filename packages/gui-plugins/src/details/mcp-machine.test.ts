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

// Folds the events in order and returns the last transition.
const replay = (events: readonly McpEvent[], state: McpState = initialMcpState) =>
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
    const figma = transitionMcp(initialMcpState, toggle("figma", false))

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
    const result = transitionMcp(initialMcpState, {
      type: "toggle.requested",
      name: "waiting",
      enabled: false,
      status: "pending",
    })

    expect(result).toEqual({ state: initialMcpState, effects: [] })
    expect(mcpRowView(initialMcpState, "waiting", "pending")).toEqual({ busy: false, pending: true })
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
    const open = transitionMcp(initialMcpState, opened).state

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
    const first = transitionMcp(initialMcpState, opened).state
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

  test("a list whose popover closed lives until its last toggle settles and its dialog closes", () => {
    const detached = replay([toggle("figma", false), opened, { type: "detached" }])

    expect(detached.state).toMatchObject({ status: "detached" })

    const settled = transitionMcp(detached.state, { type: "toggle.succeeded", name: "figma", attempt: 1 })

    expect(settled.state).toMatchObject({ status: "detached" })

    const dismissed = transitionMcp(settled.state, { type: "error.dismissed", attempt: 2 })

    expect(dismissed.state).toEqual({ status: "disposed" })
    expect(transitionMcp(initialMcpState, { type: "detached" }).state).toEqual({ status: "disposed" })
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
