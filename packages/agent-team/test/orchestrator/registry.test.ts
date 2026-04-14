import { describe, test, expect } from "bun:test"
import { Registry } from "../../src/orchestrator/registry.js"

const defaultCaps = {
  tools: ["read"],
  read: true,
  write_own_workspace: true,
  share_to_team: false,
  delegate: true,
  spawn_subagents: false,
  max_delegation_depth: 2,
  disk_quota_mb: 500,
  protected_paths: [],
}

describe("Registry", () => {
  test("register adds agent", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    expect(r.list().length).toBe(1)
  })

  test("register assigns idle status", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    expect(r.getInfo("a1")?.status).toBe("idle")
  })

  test("register rejects duplicate", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    expect(() => r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })).toThrow()
  })

  test("deregister sets status dead", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    r.deregister("a1")
    expect(r.getInfo("a1")?.status).toBe("dead")
  })

  test("deregister unknown is no-op", () => {
    const r = new Registry()
    expect(() => r.deregister("unknown")).not.toThrow()
  })

  test("updateStatus updates status", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    r.updateStatus("a1", "busy")
    expect(r.getInfo("a1")?.status).toBe("busy")
  })

  test("updateStatus unknown throws", () => {
    const r = new Registry()
    expect(() => r.updateStatus("unknown", "busy")).toThrow()
  })

  test("getInfo returns undefined for unknown", () => {
    const r = new Registry()
    expect(r.getInfo("unknown")).toBeUndefined()
  })

  test("findByRole returns matching agents", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    r.register({ id: "a2", role: "reviewer", capabilities: defaultCaps, workspace_path: "/ws/a2" })
    expect(r.findByRole("coder").length).toBe(1)
  })

  test("findByCapability returns matching agents", () => {
    const r = new Registry()
    r.register({
      id: "a1",
      role: "coder",
      capabilities: { ...defaultCaps, tools: ["read", "edit"] },
      workspace_path: "/ws/a1",
    })
    r.register({ id: "a2", role: "reviewer", capabilities: defaultCaps, workspace_path: "/ws/a2" })
    expect(r.findByCapability("edit").length).toBe(1)
  })

  test("findIdle returns idle agents", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    r.register({ id: "a2", role: "reviewer", capabilities: defaultCaps, workspace_path: "/ws/a2" })
    r.updateStatus("a2", "busy")
    expect(r.findIdle().length).toBe(1)
    expect(r.findIdle()[0].id).toBe("a1")
  })

  test("recordHeartbeat updates last_activity", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    const before = r.getInfo("a1")!.last_activity
    r.recordHeartbeat("a1", { status: "busy", current_task_id: "t1" })
    expect(r.getInfo("a1")!.last_activity).toBeGreaterThanOrEqual(before)
    expect(r.getInfo("a1")!.status).toBe("busy")
  })

  test("recordHeartbeat unknown throws", () => {
    const r = new Registry()
    expect(() => r.recordHeartbeat("unknown", { status: "idle" })).toThrow()
  })

  test("incrementTokenUsage adds tokens", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    r.incrementTokenUsage("a1", 100, 50)
    r.incrementTokenUsage("a1", 200, 100)
    const info = r.getInfo("a1")!
    expect(info.tokens_used.input).toBe(300)
    expect(info.tokens_used.output).toBe(150)
    expect(info.tokens_used.total).toBe(450)
  })

  test("toSnapshot/fromSnapshot round-trip", () => {
    const r = new Registry()
    r.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    r.updateStatus("a1", "busy")
    const snap = r.toSnapshot()
    const r2 = new Registry()
    r2.fromSnapshot(snap)
    expect(r2.getInfo("a1")?.status).toBe("busy")
    expect(r2.list().length).toBe(1)
  })
})
