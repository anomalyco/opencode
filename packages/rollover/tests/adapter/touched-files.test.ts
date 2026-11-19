import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { trackTouchedFile } from "../../src/adapter/opencode/hooks"
import { createStore } from "../../src/adapter/opencode/store"
import { freezeRollover } from "../../src/core/view"
import type { NMessage, RolloverConfig, SessionState } from "../../src/core/types"

function state(over: Partial<SessionState> = {}): SessionState {
  return {
    v: 1,
    sessionId: "s1",
    settings: {},
    epoch: 0,
    extractedUntilMessageId: null,
    lastContextTokens: 0,
    lastContextSource: "estimate",
    lastContextAt: 0,
    rollover: null,
    decidedUserMessageIds: [],
    consolidatedAtRecordCount: 0,
    touchedFiles: {},
    ...over,
  }
}

const cfg = { renderBudgetTokens: 4000, tailN: 0, tailMaxN: 20 } as unknown as RolloverConfig

function msg(id: string, role: "user" | "assistant", text: string): NMessage {
  return { id, role, parts: [{ type: "text", text }], createdAt: 0 }
}

describe("touched files", () => {
  const makeDeps = (dir: string, store: ReturnType<typeof createStore>) =>
    ({ store, projectDir: dir, homeConfigDir: dir, env: {}, log: () => {}, modelLimits: new Map(), lastMessages: new Map(), scheduler: {} }) as never

  test("edit event records a worktree-relative path and bumps the turn", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "touched-"))
    mkdirSync(path.join(dir, "src"), { recursive: true })
    const store = createStore({ dataDir: path.join(dir, ".opencode", "rollover") })
    await store.writeState("s1", state({ epoch: 2, settings: { enabled: true } }))
    const deps = makeDeps(dir, store)

    await trackTouchedFile(deps, { tool: "edit", sessionID: "s1", input: { path: path.join(dir, "src", "a.ts") } })
    await trackTouchedFile(deps, { tool: "write", sessionID: "s1", input: { path: path.join(dir, "src", "b.ts") } })

    expect((await store.readState("s1"))?.touchedFiles).toEqual({
      "src/a.ts": { epoch: 2, turn: 1 },
      "src/b.ts": { epoch: 2, turn: 2 },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  test("other tools are ignored", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "touched-"))
    const store = createStore({ dataDir: path.join(dir, ".opencode", "rollover") })
    await store.writeState("s1", state({ settings: { enabled: true } }))
    const deps = makeDeps(dir, store)
    await trackTouchedFile(deps, { tool: "read", sessionID: "s1", input: { path: "/tmp/x" } })
    expect((await store.readState("s1"))?.touchedFiles).toEqual({})
    rmSync(dir, { recursive: true, force: true })
  })

  test("off session tracks nothing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "touched-"))
    const store = createStore({ dataDir: path.join(dir, ".opencode", "rollover") })
    await store.writeState("s1", state({ settings: { enabled: false } }))
    const deps = makeDeps(dir, store)
    await trackTouchedFile(deps, { tool: "edit", sessionID: "s1", input: { path: path.join(dir, "src", "a.ts") } })
    expect((await store.readState("s1"))?.touchedFiles).toEqual({})
    rmSync(dir, { recursive: true, force: true })
  })

  test("touched files appear in the rendered rollover context at swap", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "touched-"))
    const store = createStore({ dataDir: path.join(dir, ".opencode", "rollover") })
    await store.writeState("s1", state({ epoch: 2, settings: { enabled: true } }))
    const deps = makeDeps(dir, store)
    await trackTouchedFile(deps, { tool: "patch", sessionID: "s1", input: { path: path.join(dir, "src", "a.ts") } })

    const st = (await store.readState("s1"))!
    const msgs = [msg("u1", "user", "first"), msg("u2", "user", "second")]
    const rec = freezeRollover({ msgs, st, cfg, lines: [], userMessageId: "u2" })
    expect(rec.renderText).toContain("## Files touched")
    expect(rec.renderText).toContain("- src/a.ts")
    rmSync(dir, { recursive: true, force: true })
  })
})
