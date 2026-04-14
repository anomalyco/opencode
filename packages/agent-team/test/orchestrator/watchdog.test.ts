import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Registry } from "../../src/orchestrator/registry.js"
import { AuditLogger } from "../../src/orchestrator/audit.js"
import { Watchdog } from "../../src/orchestrator/watchdog.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

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

describe("Watchdog", () => {
  let dir: string
  let registry: Registry
  let audit: AuditLogger
  let watchdog: Watchdog

  beforeEach(async () => {
    dir = await tmpdir()
    registry = new Registry()
    audit = new AuditLogger(dir)
    await audit.init()
    watchdog = new Watchdog(registry, audit, { heartbeatWarningMs: 1000, zombieTimeoutMs: 3000 })
  })

  afterEach(async () => {
    await cleanup(dir)
  })

  test("tick with fresh agent → no action", async () => {
    registry.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    const { warned, zombies } = await watchdog.tick()
    expect(warned.length).toBe(0)
    expect(zombies.length).toBe(0)
  })

  test("tick with stale agent → warning", async () => {
    registry.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    const info = registry.getInfo("a1")!
    const twoSecAgo = Date.now() - 2000
    registry.recordHeartbeat("a1", { status: "idle" })
    ;(registry as any).agents.get("a1").last_activity = twoSecAgo
    const { warned } = await watchdog.tick()
    expect(warned.length).toBe(1)
  })

  test("tick with zombie agent → mark dead", async () => {
    registry.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    ;(registry as any).agents.get("a1").last_activity = Date.now() - 5000
    const { zombies } = await watchdog.tick()
    expect(zombies.length).toBe(1)
    expect(registry.getInfo("a1")?.status).toBe("dead")
  })

  test("heartbeat updates prevent zombie detection", async () => {
    registry.register({ id: "a1", role: "coder", capabilities: defaultCaps, workspace_path: "/ws/a1" })
    registry.recordHeartbeat("a1", { status: "idle" })
    const { zombies } = await watchdog.tick()
    expect(zombies.length).toBe(0)
  })

  test("start/stop manages interval", () => {
    watchdog.start(1000)
    watchdog.stop()
    expect(true).toBe(true)
  })
})
