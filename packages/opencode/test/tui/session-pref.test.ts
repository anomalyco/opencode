import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import fs from "fs/promises"

describe("session pref storage", () => {
  test("persists and reads per-session selections", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-pref-"))
    process.env.OPENCODE_SESSION_PREF_PATH = path.join(dir, "prefs.json")

    const pref = await import("../../src/cli/cmd/tui/context/session-pref")
    const data = {
      sessionA: {
        agent: "Agent Alpha",
        model: { providerID: "p1", modelID: "m1" },
      },
      sessionB: {
        agent: "Agent Beta",
      },
    }

    await pref.writePrefs(data)
    const result = await pref.readPrefs()

    expect(result.sessionA.agent).toBe("Agent Alpha")
    expect(result.sessionA.model?.providerID).toBe("p1")
    expect(result.sessionB.agent).toBe("Agent Beta")
    expect(result.sessionB.model).toBeUndefined()

    delete process.env.OPENCODE_SESSION_PREF_PATH
    await fs.rm(dir, { recursive: true, force: true })
  })
})
