import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Database, sql } from "../../src/storage/db"
import { PartTable } from "../../src/session/session.sql"
import { watchdogTick } from "../../src/project/bootstrap"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionActivity } from "../../src/session/activity"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

/**
 * Tests for the watchdog's leaf-filtering logic.
 *
 * The watchdog scans for tool parts stuck in "running" beyond a cutoff.
 * The key behavior: task tools whose child session also has stuck tools
 * are NOT cancelled (they resolve naturally when the child is cancelled).
 * Only "leaf" tools — non-task tools, or task tools with no live child —
 * are force-errored.
 */

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a message row via raw SQL (avoids type constraints for test data). */
function insertMessage(id: string, session: string) {
  const now = Date.now()
  Database.use((db) => {
    db.run(
      sql.raw(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES ('${id}', '${session}', ${now}, ${now},
           '${JSON.stringify({
             role: "assistant",
             time: { created: now },
             agent: "test",
             modelID: "test",
             providerID: "test",
             parentID: "",
             mode: "",
             path: { cwd: "/tmp", root: "/tmp" },
             cost: 0,
             tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
           })}')`,
      ),
    )
  })
}

/** Insert a tool part with "running" status via raw SQL. */
function insertRunning(opts: {
  id: string
  session: string
  message: string
  tool: string
  start: number
  child?: string
}) {
  const metadata = opts.child ? { sessionId: opts.child } : {}
  const data = JSON.stringify({
    type: "tool",
    callID: `call_${opts.id}`,
    tool: opts.tool,
    state: {
      status: "running",
      input: {},
      time: { start: opts.start },
      metadata,
    },
  })
  Database.use((db) => {
    db.run(
      sql.raw(
        `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES ('${opts.id}', '${opts.message}', '${opts.session}', ${opts.start}, ${opts.start}, '${data}')`,
      ),
    )
  })
}

/** Read a part's status from the DB. */
function partStatus(id: string): string {
  return Database.use((db) => {
    const row = db
      .select({
        status: sql<string>`json_extract(${PartTable.data}, '$.state.status')`,
      })
      .from(PartTable)
      .where(sql`${PartTable.id} = ${id}`)
      .get()
    return row!.status
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("watchdog: leaf-filtering", () => {
  test("single stuck non-task tool is force-errored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, ses.id)
        insertRunning({ id: prt, session: ses.id, message: msg, tool: "bash", start: 1000 })

        watchdogTick(Date.now())

        expect(partStatus(prt)).toBe("error")
      },
    })
  })

  test("task tool waiting on child with stuck tool is NOT errored", async () => {
    // 3-level chain: top → child → grandchild
    // grandchild has a stuck "question" tool (the leaf)
    // child has a stuck "task" tool pointing at grandchild
    // top has a stuck "task" tool pointing at child
    //
    // Only the grandchild's "question" tool should be errored.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const top = await Session.create({})
        const child = await Session.create({ parentID: top.id })
        const grand = await Session.create({ parentID: child.id })

        const topMsg = Identifier.ascending("message")
        const childMsg = Identifier.ascending("message")
        const grandMsg = Identifier.ascending("message")
        const topPrt = Identifier.ascending("part")
        const childPrt = Identifier.ascending("part")
        const grandPrt = Identifier.ascending("part")

        insertMessage(topMsg, top.id)
        insertMessage(childMsg, child.id)
        insertMessage(grandMsg, grand.id)

        const old = 1000
        // Top-level: task tool waiting on child
        insertRunning({
          id: topPrt,
          session: top.id,
          message: topMsg,
          tool: "task",
          start: old,
          child: child.id,
        })
        // Child: task tool waiting on grandchild
        insertRunning({
          id: childPrt,
          session: child.id,
          message: childMsg,
          tool: "task",
          start: old,
          child: grand.id,
        })
        // Grandchild: stuck "question" tool (leaf)
        insertRunning({
          id: grandPrt,
          session: grand.id,
          message: grandMsg,
          tool: "question",
          start: old,
        })

        watchdogTick(Date.now())

        // Only the grandchild's leaf tool should be errored
        expect(partStatus(grandPrt)).toBe("error")
        // Parent task tools should remain running
        expect(partStatus(childPrt)).toBe("running")
        expect(partStatus(topPrt)).toBe("running")
      },
    })
  })

  test("task tool with no child metadata is treated as leaf", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, ses.id)
        // Task tool but no child session ID in metadata
        insertRunning({ id: prt, session: ses.id, message: msg, tool: "task", start: 1000 })

        watchdogTick(Date.now())

        expect(partStatus(prt)).toBe("error")
      },
    })
  })

  test("task tool whose child has no stuck tools is treated as leaf", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, parent.id)

        // Parent has task tool pointing at child, but child has NO stuck tools
        insertRunning({
          id: prt,
          session: parent.id,
          message: msg,
          tool: "task",
          start: 1000,
          child: child.id,
        })

        watchdogTick(Date.now())

        expect(partStatus(prt)).toBe("error")
      },
    })
  })

  test("no stuck tools means no changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Nothing stuck — watchdog should be a no-op
        watchdogTick(Date.now())
        // No assertion needed; just verify it doesn't throw
      },
    })
  })

  test("tools within cutoff are not affected", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, ses.id)

        // Tool started recently
        const recent = Date.now()
        insertRunning({ id: prt, session: ses.id, message: msg, tool: "bash", start: recent })

        // Cutoff is before the tool started — not stuck
        watchdogTick(recent - 1000)

        expect(partStatus(prt)).toBe("running")
      },
    })
  })

  test("multiple leaves across different sessions are all errored", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses1 = await Session.create({})
        const ses2 = await Session.create({})
        const msg1 = Identifier.ascending("message")
        const msg2 = Identifier.ascending("message")
        const prt1 = Identifier.ascending("part")
        const prt2 = Identifier.ascending("part")

        insertMessage(msg1, ses1.id)
        insertMessage(msg2, ses2.id)

        insertRunning({ id: prt1, session: ses1.id, message: msg1, tool: "bash", start: 1000 })
        insertRunning({ id: prt2, session: ses2.id, message: msg2, tool: "read", start: 1000 })

        watchdogTick(Date.now())

        expect(partStatus(prt1)).toBe("error")
        expect(partStatus(prt2)).toBe("error")
      },
    })
  })

  test("mixed: leaf tools errored, waiting task tools preserved", async () => {
    // Two independent chains:
    //   Chain A: parentA → task(childA) → childA has stuck bash
    //   Chain B: standalone session with stuck read tool
    // Both leaf tools errored, parentA's task tool preserved.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parentA = await Session.create({})
        const childA = await Session.create({ parentID: parentA.id })
        const sesB = await Session.create({})

        const msgA = Identifier.ascending("message")
        const msgChild = Identifier.ascending("message")
        const msgB = Identifier.ascending("message")
        const prtA = Identifier.ascending("part")
        const prtChild = Identifier.ascending("part")
        const prtB = Identifier.ascending("part")

        insertMessage(msgA, parentA.id)
        insertMessage(msgChild, childA.id)
        insertMessage(msgB, sesB.id)

        const old = 1000
        insertRunning({
          id: prtA,
          session: parentA.id,
          message: msgA,
          tool: "task",
          start: old,
          child: childA.id,
        })
        insertRunning({ id: prtChild, session: childA.id, message: msgChild, tool: "bash", start: old })
        insertRunning({ id: prtB, session: sesB.id, message: msgB, tool: "read", start: old })

        watchdogTick(Date.now())

        // Leaf tools errored
        expect(partStatus(prtChild)).toBe("error")
        expect(partStatus(prtB)).toBe("error")
        // Parent's task tool preserved
        expect(partStatus(prtA)).toBe("running")
      },
    })
  })
})

describe("watchdog: cancel target", () => {
  test("task tool leaf cancels child session, not parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, parent.id)

        // Task tool whose child has NO stuck tools → leaf
        insertRunning({
          id: prt,
          session: parent.id,
          message: msg,
          tool: "task",
          start: 1000,
          child: child.id,
        })

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
          // Don't call through — no real session running
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          watchdogTick(Date.now())
        } finally {
          SessionPrompt.cancel = orig
        }

        // Watchdog should cancel the child, not the parent
        expect(ids).toEqual([child.id])
        expect(ids).not.toContain(parent.id)
        // DB part still force-errored as safety net
        expect(partStatus(prt)).toBe("error")
      },
    })
  })

  test("non-task leaf cancels owning session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, ses.id)
        insertRunning({ id: prt, session: ses.id, message: msg, tool: "bash", start: 1000 })

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          watchdogTick(Date.now())
        } finally {
          SessionPrompt.cancel = orig
        }

        // Non-task tool: cancel the owning session directly
        expect(ids).toEqual([ses.id])
        expect(partStatus(prt)).toBe("error")
      },
    })
  })

  test("3-level chain cancels grandchild session only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const top = await Session.create({})
        const child = await Session.create({ parentID: top.id })
        const grand = await Session.create({ parentID: child.id })

        const topMsg = Identifier.ascending("message")
        const childMsg = Identifier.ascending("message")
        const grandMsg = Identifier.ascending("message")
        const topPrt = Identifier.ascending("part")
        const childPrt = Identifier.ascending("part")
        const grandPrt = Identifier.ascending("part")

        insertMessage(topMsg, top.id)
        insertMessage(childMsg, child.id)
        insertMessage(grandMsg, grand.id)

        const old = 1000
        insertRunning({
          id: topPrt,
          session: top.id,
          message: topMsg,
          tool: "task",
          start: old,
          child: child.id,
        })
        insertRunning({
          id: childPrt,
          session: child.id,
          message: childMsg,
          tool: "task",
          start: old,
          child: grand.id,
        })
        insertRunning({
          id: grandPrt,
          session: grand.id,
          message: grandMsg,
          tool: "question",
          start: old,
        })

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          watchdogTick(Date.now())
        } finally {
          SessionPrompt.cancel = orig
        }

        // Only the grandchild's owning session should be cancelled
        // (non-task "question" tool → cancel owning session)
        expect(ids).toEqual([grand.id])
        expect(ids).not.toContain(top.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })
})

// ---------------------------------------------------------------------------
// SessionActivity unit tests
// ---------------------------------------------------------------------------

describe("SessionActivity", () => {
  test("touch and last", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(SessionActivity.last("a")).toBeUndefined()
        SessionActivity.touch("a", 1000)
        expect(SessionActivity.last("a")).toBe(1000)
        SessionActivity.touch("a", 2000)
        expect(SessionActivity.last("a")).toBe(2000)
      },
    })
  })

  test("stale returns false for unknown session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // No activity recorded — not stale (hasn't started yet)
        expect(SessionActivity.stale("unknown", 1000)).toBe(false)
      },
    })
  })

  test("stale detects inactivity", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const old = Date.now() - 10_000
        SessionActivity.touch("a", old)
        // 5s threshold — session was active 10s ago → stale
        expect(SessionActivity.stale("a", 5_000)).toBe(true)
        // 15s threshold — session was active 10s ago → not stale yet
        expect(SessionActivity.stale("a", 15_000)).toBe(false)
      },
    })
  })

  test("remove clears tracking", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionActivity.touch("a", 1000)
        expect(SessionActivity.last("a")).toBe(1000)
        SessionActivity.remove("a")
        expect(SessionActivity.last("a")).toBeUndefined()
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Idle detection integration tests
// ---------------------------------------------------------------------------

describe("watchdog: idle detection", () => {
  test("idle subagent is cancelled when stale", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, parent.id)

        // Parent has a task tool pointing at child — child session has
        // stuck tools too (so it's NOT a leaf, but IS in the stuck set)
        const childMsg = Identifier.ascending("message")
        const childPrt = Identifier.ascending("part")
        insertMessage(childMsg, child.id)

        const old = 1000
        insertRunning({
          id: prt,
          session: parent.id,
          message: msg,
          tool: "task",
          start: old,
          child: child.id,
        })
        // Child has a running tool too — parent task tool is NOT a leaf
        insertRunning({
          id: childPrt,
          session: child.id,
          message: childMsg,
          tool: "bash",
          start: old,
        })

        // Simulate the child having had activity a long time ago
        SessionActivity.touch(child.id, Date.now() - 600_000)

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          // The leaf filter will catch the bash tool (non-task leaf).
          // The idle check should ALSO cancel the child because it's stale.
          // But since the bash tool's cancel already targets child.id,
          // the idle path adds it too — deduplicated by the `cancelled` set.
          watchdogTick(Date.now(), 300_000)
        } finally {
          SessionPrompt.cancel = orig
        }

        // Child should be cancelled (by either leaf detection or idle — at least once)
        expect(ids).toContain(child.id)
        // Parent should NOT be cancelled
        expect(ids).not.toContain(parent.id)
      },
    })
  })

  test("active subagent is NOT cancelled by idle check", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, parent.id)

        const old = 1000
        insertRunning({
          id: prt,
          session: parent.id,
          message: msg,
          tool: "task",
          start: old,
          child: child.id,
        })

        // Child had very recent activity — NOT stale
        SessionActivity.touch(child.id, Date.now() - 1000)

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          // The task tool IS a leaf (child has no stuck tools) so it
          // gets cancelled by the leaf filter. But the idle check
          // should NOT independently cancel it since it's active.
          watchdogTick(Date.now(), 300_000)
        } finally {
          SessionPrompt.cancel = orig
        }

        // Child cancelled by leaf filter (task tool whose child has no stuck tools)
        expect(ids).toContain(child.id)
      },
    })
  })

  test("idle detection skipped when idle param is omitted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        const childMsg = Identifier.ascending("message")
        const childPrt = Identifier.ascending("part")
        insertMessage(msg, parent.id)
        insertMessage(childMsg, child.id)

        const old = 1000
        insertRunning({
          id: prt,
          session: parent.id,
          message: msg,
          tool: "task",
          start: old,
          child: child.id,
        })
        insertRunning({
          id: childPrt,
          session: child.id,
          message: childMsg,
          tool: "bash",
          start: old,
        })

        // Child is stale
        SessionActivity.touch(child.id, Date.now() - 600_000)

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          // No idle param — only leaf detection runs
          watchdogTick(Date.now())
        } finally {
          SessionPrompt.cancel = orig
        }

        // The bash tool is the leaf, so child.id is cancelled by leaf filter.
        // But the parent task tool is NOT a leaf (child has stuck bash),
        // so it stays running. The idle path did NOT run (no idle param).
        expect(ids).toEqual([child.id])
        // Parent task tool preserved
        expect(partStatus(prt)).toBe("running")
      },
    })
  })

  test("stale session with running tool IS idle-cancelled (idle sweep has no running-tool guard)", async () => {
    // After restructuring, the idle sweep simply checks SessionActivity.stale()
    // for all tracked sessions — it does not exempt sessions with running tools.
    // The stuck-tool path handles running tools separately.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        const childMsg = Identifier.ascending("message")
        const childPrt = Identifier.ascending("part")
        insertMessage(msg, parent.id)
        insertMessage(childMsg, child.id)

        const old = 1000
        // Parent task tool pointing at child — both stuck past cutoff
        insertRunning({
          id: prt,
          session: parent.id,
          message: msg,
          tool: "task",
          start: old,
          child: child.id,
        })
        // Child has a running bash tool
        insertRunning({
          id: childPrt,
          session: child.id,
          message: childMsg,
          tool: "bash",
          start: old,
        })

        // Child's last Bus activity was 10 minutes ago — stale
        SessionActivity.touch(child.id, Date.now() - 600_000)

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          // cutoff=0: no stuck tools found. But idle sweep runs
          // independently and child is stale → cancelled.
          watchdogTick(0, 300_000)
        } finally {
          SessionPrompt.cancel = orig
        }

        // Child cancelled by idle sweep (stale activity)
        expect(ids).toEqual([child.id])
      },
    })
  })

  test("session with no recorded activity is not considered stale", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        const msg = Identifier.ascending("message")
        const prt = Identifier.ascending("part")
        insertMessage(msg, parent.id)

        const old = 1000
        insertRunning({
          id: prt,
          session: parent.id,
          message: msg,
          tool: "task",
          start: old,
          child: child.id,
        })

        // Deliberately do NOT touch SessionActivity for the child —
        // simulates a session that hasn't started streaming yet.

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          watchdogTick(Date.now(), 300_000)
        } finally {
          SessionPrompt.cancel = orig
        }

        // Child is cancelled by the leaf filter (task tool whose child
        // has no stuck tools), but the idle check should NOT have fired
        // because there's no recorded activity (stale() returns false).
        expect(ids).toEqual([child.id])
      },
    })
  })

  test("root session is never idle-cancelled even when stale", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({})

        // Root session has stale activity — but idle sweep should skip it
        SessionActivity.touch(root.id, Date.now() - 600_000)

        const ids: string[] = []
        const orig = SessionPrompt.cancel
        const spy = mock(async (id: string) => {
          ids.push(id)
        })
        SessionPrompt.cancel = spy as typeof SessionPrompt.cancel

        try {
          watchdogTick(0, 300_000)
        } finally {
          SessionPrompt.cancel = orig
        }

        // Root session must NOT be cancelled by idle sweep
        expect(ids).not.toContain(root.id)
      },
    })
  })
})
