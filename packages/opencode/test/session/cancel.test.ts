import { describe, expect, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { SessionActivity } from "../../src/session/activity"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("SessionPrompt cancel", () => {
  test("Property 1: Generation Isolation — stale cancel does not abort new controller", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_gen_iso")

        // First start — creates state with generation g1
        const signal1 = SessionPrompt.start(id)
        expect(signal1).toBeDefined()
        const g1 = SessionPrompt._state()[id].generation

        // Unconditional cancel to clear state
        SessionPrompt.cancel(id)
        expect(signal1!.aborted).toBe(true)

        // Second start — creates state with generation g2 > g1
        const signal2 = SessionPrompt.start(id)
        expect(signal2).toBeDefined()
        const g2 = SessionPrompt._state()[id].generation
        expect(g2).toBeGreaterThan(g1)

        // Stale cancel with g1 — must NOT abort signal2
        SessionPrompt.cancel(id, g1)
        expect(signal2!.aborted).toBe(false)
        // State still exists
        expect(SessionPrompt._state()[id]).toBeDefined()

        // Fresh cancel with no generation — aborts signal2
        SessionPrompt.cancel(id)
        expect(signal2!.aborted).toBe(true)
      },
    })
  })

  test("Property 2: Pre-Cancel Completeness — cancel before start returns undefined", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_precancel")

        // Cancel before any state exists
        SessionPrompt.cancel(id)
        expect(SessionPrompt._precancelled.has(id)).toBe(true)

        // Start should return undefined (pre-cancelled) and consume the entry
        const signal = SessionPrompt.start(id)
        expect(signal).toBeUndefined()
        expect(SessionPrompt._precancelled.has(id)).toBe(false)

        // Subsequent start works normally (pre-cancel consumed)
        const signal2 = SessionPrompt.start(id)
        expect(signal2).toBeDefined()

        // Clean up
        SessionPrompt.cancel(id)
      },
    })
  })

  test("Property 3: Cancel Idempotency — SessionActivity.remove called at most once", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOn(SessionActivity, "remove")
        try {
          const id = SessionID.make("session_idempotent")

          // Start a session
          const signal = SessionPrompt.start(id)
          expect(signal).toBeDefined()

          // Cancel three times
          SessionPrompt.cancel(id)
          SessionPrompt.cancel(id)
          SessionPrompt.cancel(id)

          // remove called exactly once (first cancel hit state, subsequent are no-ops)
          const calls = spy.mock.calls.filter((c) => c[0] === id)
          expect(calls).toHaveLength(1)
        } finally {
          spy.mockRestore()
        }
      },
    })
  })

  test("Property 4: Callback Completeness — all queued callbacks rejected on cancel", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_callbacks")

        // Start session
        SessionPrompt.start(id)
        const entry = SessionPrompt._state()[id]

        // Queue 3 callbacks
        const errors: unknown[] = []
        const promises = Array.from({ length: 3 }, () =>
          new Promise((resolve, reject) => {
            entry.callbacks.push({ resolve, reject })
          }).catch((e) => {
            errors.push(e)
          }),
        )

        // Cancel — should reject all
        SessionPrompt.cancel(id)
        await Promise.all(promises)

        expect(errors).toHaveLength(3)
        for (const err of errors) {
          expect(SessionPrompt.SessionCancelledError.isInstance(err)).toBe(true)
        }
      },
    })
  })

  test("Property 5: Activity Tracking — remove not called for no-op cancel", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOn(SessionActivity, "remove")
        try {
          const id = SessionID.make("session_nostate")

          // Cancel with no existing state — should NOT call remove
          SessionPrompt.cancel(id)
          const calls = spy.mock.calls.filter((c) => c[0] === id)
          expect(calls).toHaveLength(0)
        } finally {
          spy.mockRestore()
        }
      },
    })
  })

  test("Property 5b: Activity Tracking — remove not called for stale generation cancel", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOn(SessionActivity, "remove")
        try {
          const id = SessionID.make("session_stale_gen")

          SessionPrompt.start(id)
          const g = SessionPrompt._state()[id].generation

          // Cancel with stale generation (gen - 1) — should NOT call remove
          SessionPrompt.cancel(id, g - 1)
          const calls = spy.mock.calls.filter((c) => c[0] === id)
          expect(calls).toHaveLength(0)

          // State still exists
          expect(SessionPrompt._state()[id]).toBeDefined()

          // Clean up
          SessionPrompt.cancel(id)
        } finally {
          spy.mockRestore()
        }
      },
    })
  })

  test("Kill Chain A: deferred cancel with stale gen does not abort new controller", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_killchain_a")

        // Simulate loop N: start and capture generation
        const signal1 = SessionPrompt.start(id)
        expect(signal1).toBeDefined()
        const g1 = SessionPrompt._state()[id].generation

        // Parent cancels the session (unconditional, as it would in production)
        SessionPrompt.cancel(id)
        expect(signal1!.aborted).toBe(true)

        // Retry starts loop N+1
        const signal2 = SessionPrompt.start(id)
        expect(signal2).toBeDefined()
        const g2 = SessionPrompt._state()[id].generation
        expect(g2).toBeGreaterThan(g1)

        // Deferred cancel from loop N fires with stale g1
        SessionPrompt.cancel(id, g1)

        // Loop N+1's controller must NOT be aborted
        expect(signal2!.aborted).toBe(false)
        expect(SessionPrompt._state()[id]).toBeDefined()
        expect(SessionPrompt._state()[id].generation).toBe(g2)

        // Clean up
        SessionPrompt.cancel(id)
      },
    })
  })

  test("Kill Chain B: cancel before start prevents zombie session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_killchain_b")

        // Parent cancels child before child starts
        SessionPrompt.cancel(id)
        expect(SessionPrompt._precancelled.has(id)).toBe(true)

        // Child's start() consumes the pre-cancel — returns undefined
        const signal = SessionPrompt.start(id)
        expect(signal).toBeUndefined()

        // No state created — zombie prevented
        expect(SessionPrompt._state()[id]).toBeUndefined()
        expect(SessionPrompt._precancelled.has(id)).toBe(false)
      },
    })
  })

  test("Kill Chain B2: loop() rejects with SessionCancelledError when pre-cancelled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_loop_precancel")

        // Pre-cancel before any state exists
        SessionPrompt.cancel(id)
        expect(SessionPrompt._precancelled.has(id)).toBe(true)

        // loop() should reject with SessionCancelledError
        try {
          await SessionPrompt.loop({ sessionID: id })
          expect.unreachable("loop() should have thrown")
        } catch (err) {
          expect(SessionPrompt.SessionCancelledError.isInstance(err)).toBe(true)
        }
      },
    })
  })

  test("pre-cancel is idempotent — multiple cancels before start", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_precancel_idem")

        // Cancel multiple times before start
        SessionPrompt.cancel(id)
        SessionPrompt.cancel(id)
        SessionPrompt.cancel(id)

        // Precancelled map has exactly one entry
        expect(SessionPrompt._precancelled.has(id)).toBe(true)

        // Start consumes it
        const signal = SessionPrompt.start(id)
        expect(signal).toBeUndefined()
        expect(SessionPrompt._precancelled.has(id)).toBe(false)

        // Next start works normally
        const signal2 = SessionPrompt.start(id)
        expect(signal2).toBeDefined()

        // Clean up
        SessionPrompt.cancel(id)
      },
    })
  })

  test("cancel with generation on non-existent session is a no-op", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOn(SessionActivity, "remove")
        try {
          const id = SessionID.make("session_gen_nostate")

          // Cancel with a generation when no state exists — should be pure no-op
          SessionPrompt.cancel(id, 42)

          // Must NOT add to precancelled
          expect(SessionPrompt._precancelled.has(id)).toBe(false)

          // Must NOT call remove
          const calls = spy.mock.calls.filter((c) => c[0] === id)
          expect(calls).toHaveLength(0)
        } finally {
          spy.mockRestore()
        }
      },
    })
  })

  test("no-op cancel still sets status to idle", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOn(SessionStatus, "set")
        try {
          const id = SessionID.make("session_noop_status")

          // Cancel with no state — should set status idle (not throw)
          expect(() => SessionPrompt.cancel(id)).not.toThrow()

          // Verify SessionStatus.set was called with idle
          const calls = spy.mock.calls.filter((c) => c[0] === id)
          expect(calls).toHaveLength(1)
          expect(calls[0][1]).toEqual({ type: "idle" })
        } finally {
          spy.mockRestore()
        }
      },
    })
  })

  test("callback rejection happens before abort", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_cb_order")

        const signal = SessionPrompt.start(id)
        expect(signal).toBeDefined()

        const order: string[] = []

        // Listen for abort
        signal!.addEventListener("abort", () => order.push("abort"), {
          once: true,
        })

        // Add a callback that records when rejection happens
        const entry = SessionPrompt._state()[id]
        const done = new Promise<void>((resolve) => {
          entry.callbacks.push({
            resolve: () => {},
            reject: () => {
              order.push("reject")
              resolve()
            },
          })
        })

        SessionPrompt.cancel(id)
        await done

        // Rejection must come before abort
        expect(order[0]).toBe("reject")
        expect(order[1]).toBe("abort")
      },
    })
  })

  test("start for already-running session returns undefined without modifying generation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_double_start")

        const signal = SessionPrompt.start(id)
        expect(signal).toBeDefined()
        const g = SessionPrompt._state()[id].generation

        // Second start returns undefined — already running
        const signal2 = SessionPrompt.start(id)
        expect(signal2).toBeUndefined()

        // Generation unchanged
        expect(SessionPrompt._state()[id].generation).toBe(g)

        // Controller not affected
        expect(signal!.aborted).toBe(false)

        // Clean up
        SessionPrompt.cancel(id)
      },
    })
  })

  test("generations are strictly monotonic across sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = [
          SessionID.make("session_mono_a"),
          SessionID.make("session_mono_b"),
          SessionID.make("session_mono_c"),
        ]
        const gens: number[] = []

        for (const id of ids) {
          SessionPrompt.start(id)
          gens.push(SessionPrompt._state()[id].generation)
        }

        // Each generation strictly greater than the previous
        for (let i = 1; i < gens.length; i++) {
          expect(gens[i]).toBeGreaterThan(gens[i - 1])
        }

        // Clean up
        for (const id of ids) SessionPrompt.cancel(id)
      },
    })
  })

  test("Property 7: CancelRequested event triggers cancel for active session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = SessionID.make("session_cancel_propagation")

        // Wire up the subscription
        SessionPrompt.init()

        // Start a session so there's state to cancel
        const signal = SessionPrompt.start(id)
        expect(signal).toBeDefined()
        expect(signal!.aborted).toBe(false)

        // Publish a CancelRequested event (simulates abortChildren calling Bus.publish)
        Bus.publish(SessionProcessor.Event.CancelRequested, { sessionID: id })

        // Allow microtask for subscriber to fire
        await new Promise((r) => setTimeout(r, 10))

        // The session should now be cancelled
        expect(signal!.aborted).toBe(true)
        expect(SessionPrompt._state()[id]).toBeUndefined()
      },
    })
  })

  test("Property 7: CancelRequested event is no-op for nonexistent session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOn(SessionActivity, "remove")
        try {
          SessionPrompt.init()

          // Publish for a session that doesn't exist
          Bus.publish(SessionProcessor.Event.CancelRequested, { sessionID: SessionID.make("session_nonexistent") })

          await new Promise((r) => setTimeout(r, 10))

          // Should not have called remove (no state to clean up)
          const calls = spy.mock.calls.filter((c) => c[0] === SessionID.make("session_nonexistent"))
          expect(calls).toHaveLength(0)
        } finally {
          spy.mockRestore()
        }
      },
    })
  })
})
