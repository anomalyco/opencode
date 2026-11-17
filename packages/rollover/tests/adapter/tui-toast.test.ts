import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import tuiPlugin from "../../src/tui-entry"
import type { SessionState } from "../../src/core/types"

interface ToastCall {
  message: string
  variant?: string
  sessionID?: string
}

function makeCtx(dir: string, sessionID: string, toasts: ToastCall[]) {
  const notifications: Array<(event: { data: { sessionID: string; text: string } }) => void> = []
  return {
    options: { pollMs: 10 },
    location: { directory: dir },
    data: { session: { list: () => [{ id: sessionID }] } },
    ui: { toast: { show: (options: ToastCall) => toasts.push(options) } },
    client: {
      rpc: () => ({
        events: {
          on: (_name: string, handler: (event: { data: { sessionID: string; text: string } }) => void) => {
            notifications.push(handler)
            return () => {
              notifications.splice(notifications.indexOf(handler), 1)
            }
          },
        },
      }),
    },
  } as never
}

function writeState(dir: string, sessionID: string, st: Partial<SessionState>) {
  const sessionDir = path.join(dir, ".opencode", "rollover", sessionID)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(path.join(sessionDir, "state.json"), JSON.stringify({ v: 1, sessionId: sessionID, ...st }))
}

function rollover(at: number) {
  return { at, before: 187000, after: 6000, epoch: 1, renderTokens: 3900, tailTokens: 2000 }
}

async function until(condition: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met before timeout")
    await Bun.sleep(5)
  }
}

describe("tui toast bridge", () => {
  test("rollover written → one toast with the spec message", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tui-toast-"))
    const sid = "s1"
    const toasts: ToastCall[] = []
    const cleanup = await tuiPlugin.setup(makeCtx(dir, sid, toasts))
    try {
      writeState(dir, sid, { lastRollover: rollover(1000) })
      await until(() => toasts.length === 1)
      expect(toasts[0]).toEqual({
        message: "Rollover applied: 187k → 6k tokens (ledger 3.9k + tail 2k).",
        variant: "info",
        sessionID: sid,
      })
    } finally {
      await cleanup?.()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("unchanged state file → no further toasts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tui-toast-"))
    const sid = "s1"
    const toasts: ToastCall[] = []
    const cleanup = await tuiPlugin.setup(makeCtx(dir, sid, toasts))
    try {
      writeState(dir, sid, { lastRollover: rollover(1000) })
      await until(() => toasts.length === 1)
      await Bun.sleep(60)
      expect(toasts.length).toBe(1)
    } finally {
      await cleanup?.()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("two rollovers → two toasts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tui-toast-"))
    const sid = "s1"
    const toasts: ToastCall[] = []
    const cleanup = await tuiPlugin.setup(makeCtx(dir, sid, toasts))
    try {
      writeState(dir, sid, { lastRollover: rollover(1000) })
      await until(() => toasts.length === 1)
      writeState(dir, sid, { lastRollover: rollover(2000) })
      await until(() => toasts.length === 2)
      expect(toasts.map((t) => t.sessionID)).toEqual([sid, sid])
    } finally {
      await cleanup?.()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
