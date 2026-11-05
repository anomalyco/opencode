import { describe, expect, test } from "bun:test"
import {
  createMcpState,
  isMcpToggling,
  MCP_TOGGLE_TIMEOUT_MS,
  mcpDetailView,
  mcpRowView,
  transitionMcp,
  type McpEffect,
  type McpEvent,
  type McpState,
} from "./mcp-machine"

function replay(events: McpEvent[], state = transitionMcp(createMcpState(), { type: "mounted" }).state) {
  return events.reduce<{ state: McpState; effects: readonly McpEffect[] }>(
    (step, event) => transitionMcp(step.state, event),
    { state, effects: [] },
  )
}

const failed = (error: string) => ({ status: "failed", error }) as const

const run = (name: string, attempt: number, enabled: boolean): McpEffect => ({
  type: "run-toggle",
  name,
  attempt,
  enabled,
  timeoutMs: MCP_TOGGLE_TIMEOUT_MS,
})

describe("MCP machine", () => {
  test("a retry from the error view stays on it while connecting and shows the new error in place", () => {
    const retrying = replay([
      { type: "detail.opened", name: "playwright", loaded: true, status: failed("Connection refused"), focus: true },
      { type: "detail.copied", attempt: 1, error: "Connection refused" },
      { type: "toggle.requested", name: "playwright", enabled: true, status: "failed" },
    ])

    expect(retrying.effects).toEqual([run("playwright", 2, true)])

    // The server reports that it is connecting; the old auto-back closed the view here.
    const connecting = transitionMcp(retrying.state, {
      type: "server.synced",
      attempt: 1,
      loaded: true,
      status: { status: "pending" },
    })

    expect(connecting.state).toBe(retrying.state)
    expect(mcpDetailView(connecting.state, "pending")).toEqual({
      attempt: 1,
      name: "playwright",
      error: "Connection refused",
      copied: true,
      busy: true,
    })

    const refailed = replay(
      [
        { type: "server.synced", attempt: 1, loaded: true, status: failed("503") },
        { type: "toggle.failed", name: "playwright", attempt: 2, error: "503", server: true },
      ],
      connecting.state,
    )

    expect(refailed.effects).toEqual([{ type: "end-toggle", attempt: 2, ok: false }])
    expect(mcpDetailView(refailed.state, "failed")).toEqual({
      attempt: 1,
      name: "playwright",
      error: "503",
      copied: false,
      busy: false,
    })

    const connected = transitionMcp(refailed.state, {
      type: "server.synced",
      attempt: 1,
      loaded: true,
      status: { status: "connected" },
    })

    expect(connected.effects).toEqual([{ type: "focus-list", attempt: 1 }])
    expect(mcpDetailView(connected.state, "connected")).toBeUndefined()
  })

  test("toggling one server leaves every other server free", () => {
    const figma = replay([{ type: "toggle.requested", name: "figma", enabled: false, status: "connected" }])

    expect(mcpRowView(figma.state, "figma", "connected")).toEqual({ busy: true, pending: true })
    expect(mcpRowView(figma.state, "other", "disabled")).toEqual({ busy: false, pending: false })
    expect(
      transitionMcp(figma.state, { type: "toggle.requested", name: "figma", enabled: true, status: "connected" }).state,
    ).toBe(figma.state)

    const both = transitionMcp(figma.state, {
      type: "toggle.requested",
      name: "other",
      enabled: true,
      status: "disabled",
    })

    expect(both.effects).toEqual([run("other", 2, true)])

    const done = transitionMcp(both.state, { type: "toggle.succeeded", name: "other", attempt: 2 })
    expect(done.effects).toEqual([{ type: "end-toggle", attempt: 2, ok: true }])
    expect(mcpRowView(done.state, "figma", "connected").busy).toBe(true)
    expect(isMcpToggling(done.state)).toBe(true)
  })

  test("the error view opens only on a failed server, and waits for the list when it is not loaded", () => {
    const start = replay([])

    const ok = transitionMcp(start.state, {
      type: "detail.opened",
      name: "ok",
      loaded: true,
      status: { status: "connected" },
      focus: false,
    })

    expect(mcpDetailView(ok.state, "connected")).toBeUndefined()

    const opening = transitionMcp(start.state, {
      type: "detail.opened",
      name: "figma",
      loaded: false,
      status: undefined,
      focus: false,
    })

    expect(mcpDetailView(opening.state, undefined)).toBeUndefined()
    expect(
      transitionMcp(opening.state, { type: "server.synced", attempt: 1, loaded: false, status: undefined }).state,
    ).toBe(opening.state)

    const open = transitionMcp(opening.state, {
      type: "server.synced",
      attempt: 1,
      loaded: true,
      status: failed("boom"),
    })

    expect(mcpDetailView(open.state, "failed")).toMatchObject({ name: "figma", error: "boom" })

    const gone = transitionMcp(opening.state, { type: "server.synced", attempt: 1, loaded: true, status: undefined })
    expect(gone.state).toMatchObject({ detail: { status: "closed" } })
  })

  test("a failure elsewhere toasts, a timeout ends the toggle, and stale results are ignored", () => {
    const toggling = replay([{ type: "toggle.requested", name: "figma", enabled: true, status: "disabled" }])

    expect(
      transitionMcp(toggling.state, { type: "toggle.failed", name: "figma", attempt: 1, error: "boom", server: true })
        .effects,
    ).toEqual([
      { type: "end-toggle", attempt: 1, ok: false },
      { type: "toast-failed", message: "figma: boom" },
    ])
    expect(
      transitionMcp(toggling.state, {
        type: "toggle.failed",
        name: "figma",
        attempt: 1,
        error: "offline",
        server: false,
      }).effects,
    ).toEqual([
      { type: "end-toggle", attempt: 1, ok: false },
      { type: "toast-failed", message: "offline" },
    ])

    const timedOut = transitionMcp(toggling.state, { type: "toggle.timed-out", name: "figma", attempt: 1 })
    expect(timedOut.effects).toEqual([
      { type: "end-toggle", attempt: 1, ok: false },
      { type: "toast-timed-out", name: "figma" },
    ])
    expect(transitionMcp(timedOut.state, { type: "toggle.succeeded", name: "figma", attempt: 1 }).state).toBe(
      timedOut.state,
    )
  })

  test("sign-in hands the error view over to the browser", () => {
    const signIn = { integrationID: "figma-oauth", attemptID: "a", url: "https://auth", lifetime: 1000 }

    const authorizing = replay([
      { type: "detail.opened", name: "figma", loaded: true, status: failed("Sign in"), focus: false },
      { type: "toggle.requested", name: "figma", enabled: true, status: "failed" },
      { type: "toggle.authorizing", name: "figma", attempt: 2, url: "https://auth", signIn },
    ])

    expect(authorizing.effects).toEqual([
      { type: "focus-list", attempt: 1 },
      { type: "open-external", url: "https://auth" },
      { type: "open-sign-in", name: "figma", signIn },
    ])
    expect(mcpRowView(authorizing.state, "figma", "needs_auth").busy).toBe(true)
  })

  test("Back returns focus to the list; unmounting closes without focusing", () => {
    const open = replay([{ type: "detail.opened", name: "figma", loaded: true, status: failed("boom"), focus: true }])
    expect(open.effects).toEqual([{ type: "focus-detail", attempt: 1 }])

    expect(transitionMcp(open.state, { type: "detail.dismissed", attempt: 1 }).effects).toEqual([
      { type: "focus-list", attempt: 1 },
    ])
    expect(transitionMcp(open.state, { type: "detail.closed", attempt: 1 }).effects).toEqual([])
    expect(transitionMcp(open.state, { type: "detail.closed", attempt: 0 }).state).toBe(open.state)
  })

  test("the controller ends once nothing lists it, no toggle runs and no error shows", () => {
    const toggling = replay([
      { type: "toggle.requested", name: "figma", enabled: true, status: "disabled" },
      { type: "unmounted" },
    ])

    expect(toggling.state.status).toBe("active")
    expect(transitionMcp(toggling.state, { type: "toggle.succeeded", name: "figma", attempt: 1 }).state).toEqual({
      status: "disposed",
    })

    expect(transitionMcp(toggling.state, { type: "disposed" }).effects).toEqual([
      { type: "end-toggle", attempt: 1, ok: false },
    ])
  })
})
