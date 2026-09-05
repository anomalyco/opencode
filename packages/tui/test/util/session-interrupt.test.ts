import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import {
  decideInterrupt,
  interruptWindowOpen,
  INTERRUPT_WINDOW_MS,
  type InterruptInput,
} from "../../src/util/session-interrupt"
import { abortSessionBranch, type SessionAbortClient } from "../../src/util/session-abort"
import { errorMessage } from "../../src/util/error"

// CP-023 K41 - "TUI matrix: selected idle Session, active Session, autocomplete open,
// dialog open, shell active, focus variants, first Escape, second Escape, >5s timeout,
// abort rejection. Preserve precedence and surface error." (§13.3)
//
// The decision under test is the production decision: `prompt/index.tsx`'s
// `session.interrupt` command holds no branch of its own, it supplies inputs and applies
// the outcome. There is no mirror of the handler here.

/** A press that would abort if nothing blocked it: focused, normal mode, session, armed. */
function armedPress(overrides: Partial<InterruptInput> = {}): InterruptInput {
  return {
    sessionID: "ses_target",
    autocompleteVisible: false,
    focused: true,
    mode: "normal",
    armed: 1,
    armedAt: 1_000,
    now: 1_100,
    ...overrides,
  }
}

/** The first press of a sequence. */
function firstPress(overrides: Partial<InterruptInput> = {}): InterruptInput {
  return armedPress({ armed: 0, armedAt: 0, ...overrides })
}

describe("CP-023 K41 - selected-Session interrupt decision", () => {
  describe("precedence (§13.3 clause 1)", () => {
    test("autocomplete open blocks, and the same press aborts once it closes", () => {
      expect(decideInterrupt(armedPress({ autocompleteVisible: true }))).toEqual({
        kind: "blocked",
        by: "autocomplete",
      })
      // Positive control: autocomplete is the only reason the press was blocked.
      expect(decideInterrupt(armedPress({ autocompleteVisible: false }))).toEqual({
        kind: "abort",
        sessionID: "ses_target",
      })
    })

    test("unfocused blocks, and the same press aborts once focused", () => {
      expect(decideInterrupt(armedPress({ focused: false }))).toEqual({ kind: "blocked", by: "unfocused" })
      expect(decideInterrupt(armedPress({ focused: true }))).toEqual({ kind: "abort", sessionID: "ses_target" })
    })

    test("an open dialog reaches the decision as unfocused", () => {
      // `Dialog` pushes the `modal` mode and calls `focus?.blur()` on the previously
      // focused renderable (`ui/dialog.tsx`, `Dialog`), so the prompt input is not
      // focused while a dialog is open. K41's dialog row is discharged through the same
      // focus gate as the focus row rather than by an independent branch - there is no
      // independent branch, and inventing one would assert a mechanism that does not
      // exist.
      expect(decideInterrupt(armedPress({ focused: false }))).toEqual({ kind: "blocked", by: "unfocused" })
    })

    test("shell mode exits shell and never arms or aborts, even mid-sequence", () => {
      expect(decideInterrupt(armedPress({ mode: "shell" }))).toEqual({ kind: "exit_shell" })
      expect(decideInterrupt(firstPress({ mode: "shell" }))).toEqual({ kind: "exit_shell" })
      // Positive control: mode is the only reason neither press reached the sequence.
      expect(decideInterrupt(armedPress({ mode: "normal" })).kind).toBe("abort")
      expect(decideInterrupt(firstPress({ mode: "normal" })).kind).toBe("arm")
    })

    test("no selected Session blocks", () => {
      expect(decideInterrupt(armedPress({ sessionID: undefined }))).toEqual({ kind: "blocked", by: "no_session" })
      expect(decideInterrupt(firstPress({ sessionID: undefined }))).toEqual({ kind: "blocked", by: "no_session" })
    })

    test("precedence order is autocomplete, then focus, then shell, then session", () => {
      const all = armedPress({ autocompleteVisible: true, focused: false, mode: "shell", sessionID: undefined })
      expect(decideInterrupt(all)).toEqual({ kind: "blocked", by: "autocomplete" })
      expect(decideInterrupt({ ...all, autocompleteVisible: false })).toEqual({ kind: "blocked", by: "unfocused" })
      expect(decideInterrupt({ ...all, autocompleteVisible: false, focused: true })).toEqual({ kind: "exit_shell" })
      expect(decideInterrupt({ ...all, autocompleteVisible: false, focused: true, mode: "normal" })).toEqual({
        kind: "blocked",
        by: "no_session",
      })
    })
  })

  describe("sequence (§13.3 clauses 2-4)", () => {
    test("the first qualifying Escape arms and stamps the window", () => {
      expect(decideInterrupt(firstPress({ now: 7_777 }))).toEqual({ kind: "arm", armed: 1, armedAt: 7_777 })
    })

    test("the second qualifying Escape inside the window aborts the selected Session", () => {
      expect(decideInterrupt(armedPress({ armedAt: 1_000, now: 1_000 + INTERRUPT_WINDOW_MS - 1 }))).toEqual({
        kind: "abort",
        sessionID: "ses_target",
      })
    })

    test("a press after the window re-arms instead of aborting, at and beyond the boundary", () => {
      expect(decideInterrupt(armedPress({ armedAt: 1_000, now: 1_000 + INTERRUPT_WINDOW_MS }))).toEqual({
        kind: "arm",
        armed: 1,
        armedAt: 1_000 + INTERRUPT_WINDOW_MS,
      })
      expect(decideInterrupt(armedPress({ armedAt: 1_000, now: 1_000 + INTERRUPT_WINDOW_MS + 1 }))).toEqual({
        kind: "arm",
        armed: 1,
        armedAt: 1_000 + INTERRUPT_WINDOW_MS + 1,
      })
      // Positive control for the boundary: one millisecond earlier still aborts.
      expect(decideInterrupt(armedPress({ armedAt: 1_000, now: 1_000 + INTERRUPT_WINDOW_MS - 1 })).kind).toBe("abort")
    })

    test("the window predicate closes exactly at INTERRUPT_WINDOW_MS", () => {
      expect(interruptWindowOpen(0, INTERRUPT_WINDOW_MS - 1)).toBe(true)
      expect(interruptWindowOpen(0, INTERRUPT_WINDOW_MS)).toBe(false)
    })

    test("an expired sequence does not accumulate - a stale arm cannot become an abort", () => {
      // Three presses spaced beyond the window each arm; none reaches abort.
      let armed = 0
      let armedAt = 0
      for (const now of [0, 10_000, 20_000]) {
        const outcome = decideInterrupt(armedPress({ armed, armedAt, now }))
        expect(outcome).toEqual({ kind: "arm", armed: 1, armedAt: now })
        if (outcome.kind !== "arm") throw new Error("unreachable")
        armed = outcome.armed
        armedAt = outcome.armedAt
      }
    })
  })

  describe("status is not authority (§13.3 clause 5, §13.5)", () => {
    test("the decision has no status input at all", () => {
      const input = armedPress()
      // Exhaustive: `armedPress` supplies every member of `InterruptInput`, so this is
      // the whole input surface rather than a sample of it.
      expect(Object.keys(input).sort()).toEqual(
        ["armed", "armedAt", "autocompleteVisible", "focused", "mode", "now", "sessionID"].sort(),
      )
    })

    test("an idle Session aborts on the second Escape exactly as an active one does", () => {
      // There is no projected-status variant to vary: the only Session-derived input is
      // its ID. Both K41 rows - "selected idle Session" and "active Session" - are the
      // same call, which is the property the row wants.
      expect(decideInterrupt(armedPress({ sessionID: "ses_idle" }))).toEqual({
        kind: "abort",
        sessionID: "ses_idle",
      })
      expect(decideInterrupt(armedPress({ sessionID: "ses_active" }))).toEqual({
        kind: "abort",
        sessionID: "ses_active",
      })
    })

    test("the production command's availability does not consult session status", () => {
      // The only thing that can reinstate §13.4's "status-gated" defect is the command's
      // own `enabled`/`run`, and no runtime assertion reaches it without mounting the
      // TUI. Anchored on the command name rather than a line number.
      const source = readFileSync(
        fileURLToPath(new URL("../../src/component/prompt/index.tsx", import.meta.url)),
        "utf8",
      )
      const start = source.indexOf('name: "session.interrupt"')
      expect(start).toBeGreaterThan(-1)
      const end = source.indexOf('title: "Open editor"', start)
      expect(end).toBeGreaterThan(start)
      const command = source.slice(start, end)

      expect(command).not.toContain("status(")

      // Positive control: the extractor can see `status(` when it is present, so the
      // assertion above is a real absence and not an empty or misplaced slice.
      const active = source.slice(source.indexOf("const status ="), source.length)
      expect(active).toContain("status(")
      expect(command).toContain("decideInterrupt(")
      expect(command).toContain("abortSessionBranch(")
    })
  })
})

describe("CP-023 K92 - the TUI abort caller observes its result", () => {
  function fakeClient(behaviour: () => Promise<unknown>) {
    const calls: Array<{ parameters: { sessionID: string }; options: { throwOnError: true } }> = []
    const client: SessionAbortClient = {
      session: {
        abort: (parameters, options) => {
          calls.push({ parameters, options })
          return behaviour()
        },
      },
    }
    return { client, calls }
  }

  test("success answers true, calls the endpoint once, and reports no failure", async () => {
    const { client, calls } = fakeClient(async () => ({ data: true }))
    const failures: unknown[] = []
    const closed = await abortSessionBranch({
      client,
      sessionID: "ses_target",
      onFailure: (error) => failures.push(error),
    })
    expect(closed).toBe(true)
    expect(failures).toEqual([])
    expect(calls).toEqual([{ parameters: { sessionID: "ses_target" }, options: { throwOnError: true } }])
  })

  test("a typed 500 answers false, reports exactly once, and never rejects", async () => {
    // The shape the SDK's error interceptor produces for a thrown SessionClosureError:
    // a real Error carrying the domain message, with the parsed body under `cause`.
    const rejection = new Error("closure record could not be written", {
      cause: {
        body: { _tag: "SessionClosureError", kind: "record_failed", message: "closure record could not" },
        status: 500,
      },
    })
    const { client, calls } = fakeClient(async () => {
      throw rejection
    })
    const failures: unknown[] = []
    const closed = await abortSessionBranch({
      client,
      sessionID: "ses_target",
      onFailure: (error) => failures.push(error),
    })
    expect(closed).toBe(false)
    expect(failures).toEqual([rejection])
    expect(calls).toHaveLength(1)
    // The toast carries the closure kind's own message rather than a generic fallback.
    expect(errorMessage(failures[0])).toBe("closure record could not be written")
  })

  test("a transport rejection is observed on the same channel", async () => {
    const rejection = new Error("network error (no response)")
    const { client } = fakeClient(async () => {
      throw rejection
    })
    const failures: unknown[] = []
    expect(
      await abortSessionBranch({ client, sessionID: "ses_target", onFailure: (error) => failures.push(error) }),
    ).toBe(false)
    expect(failures).toEqual([rejection])
  })
})
