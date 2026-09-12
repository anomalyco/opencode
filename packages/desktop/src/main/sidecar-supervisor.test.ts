import { describe, expect, test } from "bun:test"
import { createSidecarSupervisor } from "./sidecar-supervisor"

// Regression: the opencode server sidecar was dying with 0xC0000409 (V8
// abort under memory pressure, often while Gradle builds ran alongside)
// and the desktop had no recovery path — the window stayed open with every
// request failing until the user restarted the whole app. The supervisor
// exists so the main process can respawn the sidecar instead.
describe("sidecar supervisor", () => {
  test("allows respawns up to the limit for crash exit codes", () => {
    const supervisor = createSidecarSupervisor({ respawnLimit: 3 })
    expect(supervisor.shouldRespawn(3221226505)).toBe(true)
    expect(supervisor.shouldRespawn(3221226505)).toBe(true)
    expect(supervisor.shouldRespawn(3221226505)).toBe(true)
    expect(supervisor.shouldRespawn(3221226505)).toBe(false)
    expect(supervisor.attempts).toBe(3)
  })

  test("resets the attempt counter after a successful respawn", () => {
    const supervisor = createSidecarSupervisor({ respawnLimit: 3 })
    expect(supervisor.shouldRespawn(3221226505)).toBe(true)
    supervisor.succeeded()
    expect(supervisor.attempts).toBe(0)
    // Hours later, a fresh crash still gets a full budget of attempts.
    expect(supervisor.shouldRespawn(3221226505)).toBe(true)
    expect(supervisor.shouldRespawn(3221226505)).toBe(true)
    expect(supervisor.shouldRespawn(3221226505)).toBe(true)
    expect(supervisor.shouldRespawn(3221226505)).toBe(false)
  })

  test("clean exits are also eligible for respawn", () => {
    // A clean exit (code 0) while the app is still running is a bug just the
    // same — the server must be up for the app to work.
    const supervisor = createSidecarSupervisor({ respawnLimit: 1 })
    expect(supervisor.shouldRespawn(0)).toBe(true)
    expect(supervisor.shouldRespawn(0)).toBe(false)
  })
})
