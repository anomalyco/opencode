import { describe, expect, it } from "bun:test"
import { DoomLoopDetector } from "@opencode/core/plugin/doom-loop/detector"

type State = DoomLoopDetector.SessionState

interface Emission {
  readonly before: DoomLoopDetector.Verdict
  readonly warning?: string
}

// One emission replays the plugin's hook pair: the before verdict, then the matching
// after-accounting. Fixtures and expected timings come from the calibrated replays in
// tmp/loop-detection/scratch/ (review-replay*.ts), translated to assertions here.
function emit(
  state: State,
  tool: string,
  input: unknown,
  messageID: string,
  out?: { readonly text?: string; readonly error?: string; readonly unobserved?: boolean },
): Emission {
  const sigHash = DoomLoopDetector.signature(tool, input)
  const before = DoomLoopDetector.beforeCall(state, { tool, sigHash, messageID })
  let warning: string | undefined
  if (out?.error !== undefined) {
    warning = DoomLoopDetector.recordFailed(state, {
      tool,
      sigHash,
      errorText: out.error,
      validation: out.error.startsWith("Invalid arguments for tool"),
    })
  } else if (out?.unobserved) {
    DoomLoopDetector.recordUnobserved(state, sigHash)
  } else {
    warning = DoomLoopDetector.recordCompleted(state, { tool, sigHash, text: out?.text ?? "" })
  }
  return { before, warning }
}

describe("doom loop detector", () => {
  describe("false-positive corpus", () => {
    it("flags nothing for progressive edits on the same file (corpus §1.2)", () => {
      const state = DoomLoopDetector.state()
      const triggers: string[] = []
      for (let i = 1; i <= 8; i++) {
        const r = emit(
          state,
          "edit",
          { filePath: "a.ts", oldString: `fn${i}()`, newString: `/** doc */\nfn${i}()` },
          `msg_12_${i}`,
          { text: "Edited a.ts" },
        )
        if (r.before.kind !== "pass") triggers.push(`before:${r.before.kind}`)
        if (r.warning !== undefined) triggers.push(`warn:${r.warning.slice(0, 40)}`)
      }
      expect(triggers).toEqual([])
      // Every edit is a distinct signature with a one-line receipt: A streaks stay at 1,
      // B skips short outputs, and no failure ever feeds C.
      expect(state.signatures.size).toBe(8)
      for (const entry of state.signatures.values()) expect(entry.streak).toBe(1)
      expect(state.bStreak).toBe(0)
      expect(state.failures.size).toBe(0)
    })

    it("flags nothing for six shell failures with distinct error texts (corpus §1.4)", () => {
      const state = DoomLoopDetector.state()
      const errors = [
        "Error: module 'left-pad' not found in lockfile",
        "Error: Type 'string' is not assignable to 'number' at src/config.ts:12",
        "Error: test suite 'auth' timed out after exhausting retries",
        "Error: EACCES: permission denied, open '/etc/app/config.yml'",
        "Error: command not found: tsc --project tsconfig.build.json",
        "Error: assertion failed: expected 3 elements, rendered 2 in List",
      ]
      const triggers: string[] = []
      for (let i = 1; i <= 6; i++) {
        const r = emit(state, "shell", { command: `npm run build --attempt=${i}` }, `msg_14_${i}`, {
          error: errors[i - 1]!,
        })
        if (r.before.kind !== "pass") triggers.push(`before:${r.before.kind}`)
        if (r.warning !== undefined) triggers.push(`warn:${r.warning.slice(0, 40)}`)
      }
      expect(triggers).toEqual([])
      // Error events feed signal C only — they never enter A or B, so a run of failures
      // with distinct messages cannot masquerade as a run of identical empty outputs.
      expect(state.signatures.size).toBe(0)
      expect(state.bStreak).toBe(0)
      expect(state.lines.order).toEqual([])
      // C saw six different failure identities: the streak never climbs past 1.
      expect([...state.failures.values()].every((entry) => entry.streak === 1)).toBe(true)
    })

    it("asks rather than hard-refuses for user-requested polling (corpus §2.1)", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("shell", { command: "check-ci" })
      const pollOut = "job fortytwo: status RUNNING\nprogress rows done\neta three minutes"
      const asks: Array<{ call: number; signal: string }> = []
      const warns: number[] = []
      for (let i = 1; i <= 8; i++) {
        const before = DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: `poll_${i}` })
        if (before.kind === "assert") asks.push({ call: i, signal: before.signal })
        if (before.kind === "circuit") asks.push({ call: i, signal: "HARD-CIRCUIT" })
        const warning = DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: pollOut })
        if (warning !== undefined) warns.push(i)
      }
      // The block tier is a permission ask (an escape hatch the user can allow), never a
      // hard refusal: A's tier asks at the 7th emission, after six identical accountings.
      expect(asks).toEqual([
        { call: 7, signal: "a" },
        { call: 8, signal: "a" },
      ])
      // The warning tier fired already at the 3rd accounting.
      expect(warns[0]).toBe(3)
      expect(state.bStreak).toBeGreaterThanOrEqual(3)
    })
  })

  describe("signal A", () => {
    it("warns on the 3rd identical output and asks on the 7th emission", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("grep", { pattern: "TODO", path: "src" })
      const output = "src/a.ts:1:TODO\nsrc/b.ts:2:TODO\nsrc/c.ts:3:TODO"
      const warns: number[] = []
      const asks: number[] = []
      for (let i = 1; i <= 8; i++) {
        const before = DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: `a_${i}` })
        if (before.kind === "assert") asks.push(i)
        expect(before.kind === "assert" ? before.signal : before.kind).not.toBe("circuit")
        const warning = DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: output })
        if (warning !== undefined) warns.push(i)
      }
      // A's own warning lands at the 3rd accounting; B's global warnings follow at the 3rd
      // and 5th zero-gain accountings (calls 4 and 6).
      expect(warns).toEqual([3, 4, 6])
      // Block threshold: the call emitted after the 6th accounting (the 7th emission) is
      // challenged in before.
      expect(asks).toEqual([7, 8])
    })

    it("resets the streak to 1 when the output changes", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("shell", { command: "git status" })
      const out1 = "on branch main\nnothing to commit\nworking tree clean"
      const out2 = "on branch dev\nnothing to commit\nworking tree clean"
      for (let i = 1; i <= 3; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: `s_${i}` })
        DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: out1 })
      }
      expect(state.signatures.get(sig)?.streak).toBe(3)
      DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: "s_4" })
      const warning = DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: out2 })
      expect(state.signatures.get(sig)?.streak).toBe(1)
      // The changed output still repeats two known lines, so B (not A) is what warns here.
      expect(warning).toContain("no new information")
    })

    it("tracks the S/D/T rotation per signature with B blocking first", () => {
      const state = DoomLoopDetector.state()
      const sigs = ["S", "D", "T"].map((c) => DoomLoopDetector.signature("shell", { c }))
      const outs = ["outS\nmoreS\nextraS", "outD\nmoreD\nextraD", "outT\nmoreT\nextraT"]
      let firstBWarn = 0
      let aWarnAt = 0
      let firstBlock = 0
      let firstBlockSignal = ""
      for (let i = 1; i <= 21; i++) {
        const k = (i - 1) % 3
        const before = DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sigs[k]!, messageID: `r_${i}` })
        if (before.kind === "assert" && firstBlock === 0) {
          firstBlock = i
          firstBlockSignal = before.signal
        }
        const warning = DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sigs[k]!, text: outs[k]! })
        if (warning !== undefined && warning.includes("no new information") && firstBWarn === 0) firstBWarn = i
        if (warning !== undefined && warning.includes("byte-identical") && aWarnAt === 0) aWarnAt = i
      }
      // B is a global counter, so it warns first at the 3rd zero-gain call; A's per-signature
      // warning lands on S's 3rd occurrence; the first block is B's surgical tier at call 12
      // (bStreak >= 8 with this signature's A streak >= 3), ahead of A's own 6th-identical tier.
      expect(firstBWarn).toBe(6)
      expect(aWarnAt).toBe(7)
      expect(firstBlock).toBe(12)
      expect(firstBlockSignal).toBe("b")
      // Rotation does not reset per-signature counters: every signature reached 7 occurrences.
      for (const sig of sigs) expect(state.signatures.get(sig)?.streak).toBe(7)
    })

    it("hashes before any warning append, so appended text never feeds back", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("grep", { pattern: "TODO" })
      const out = "a.ts:1:TODO\nb.ts:2:TODO\nc.ts:3:TODO"
      for (let i = 1; i <= 3; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: `w_${i}` })
        DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: out })
      }
      DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: "w_4" })
      DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: out })
      // If the appended warning were hashed, the streak would restart at 1 instead of 4.
      expect(state.signatures.get(sig)?.streak).toBe(4)
    })
  })

  describe("signal B", () => {
    it("warns at the 3rd and 5th zero-gain accounting", () => {
      const state = DoomLoopDetector.state()
      // Seed the line store so the probed signature's outputs are all zero-gain.
      DoomLoopDetector.recordCompleted(state, {
        tool: "read",
        sigHash: DoomLoopDetector.signature("read", { f: "seed" }),
        text: "l1\nl2\nl3\nl4\nl5",
      })
      const sig = DoomLoopDetector.signature("shell", { command: "git status" })
      const warns: number[] = []
      for (let i = 1; i <= 5; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: `b_${i}` })
        const warning = DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: "l1\nl2\nl3" })
        if (warning !== undefined) warns.push(i)
      }
      expect(warns).toEqual([3, 5])
    })

    it("surgically blocks the 9th zero-gain emission when A streak >= 3 corroborates", () => {
      const state = DoomLoopDetector.state()
      DoomLoopDetector.recordCompleted(state, {
        tool: "read",
        sigHash: DoomLoopDetector.signature("read", { f: "seed" }),
        text: "alpha\nbravo\ncharlie\ndelta\necho",
      })
      const sigX = DoomLoopDetector.signature("shell", { command: "git status" })
      const out = "alpha\nbravo\ncharlie"
      const other = (i: number) => DoomLoopDetector.signature("shell", { command: `variant ${i}` })
      const results: string[] = []
      let emissions = 0
      const emitSig = (sig: string) => {
        emissions++
        return DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: `x_${emissions}` })
      }
      const complete = (sig: string) =>
        DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: out })
      // X, O1, X, O2, X, O3, X, O4, X — nine zero-gain emissions; X's A streak stays below
      // its own block tier (6) so B's slot is reached.
      for (let i = 1; i <= 4; i++) {
        const vx = emitSig(sigX)
        results.push(vx.kind === "assert" ? `X${i}:${vx.signal}` : `X${i}:${vx.kind}`)
        if (vx.kind === "pass") complete(sigX)
        const vo = emitSig(other(i))
        results.push(vo.kind === "assert" ? `O${i}:${vo.signal}` : `O${i}:${vo.kind}`)
        if (vo.kind === "pass") complete(other(i))
      }
      const v5 = emitSig(sigX)
      results.push(v5.kind === "assert" ? `X5:${v5.signal}` : `X5:${v5.kind}`)
      expect(results).toEqual([
        "X1:pass",
        "O1:pass",
        "X2:pass",
        "O2:pass",
        "X3:pass",
        "O3:pass",
        "X4:pass",
        "O4:pass",
        "X5:b",
      ])
      expect(state.bStreak).toBe(8)
      expect(state.signatures.get(sigX)?.streak).toBe(4)
    })

    it("never blocks alone without A corroboration", () => {
      const low = DoomLoopDetector.state()
      low.bStreak = 8
      const sigLow = DoomLoopDetector.signature("grep", { pattern: "fresh" })
      low.signatures.set(sigLow, { lastOutputHash: "h", streak: 2 })
      const vLow = DoomLoopDetector.beforeCall(low, { tool: "grep", sigHash: sigLow, messageID: "m" })
      expect(vLow.kind).toBe("pass")

      const high = DoomLoopDetector.state()
      high.bStreak = 8
      const sigHigh = DoomLoopDetector.signature("grep", { pattern: "fresh" })
      high.signatures.set(sigHigh, { lastOutputHash: "h", streak: 3 })
      const vHigh = DoomLoopDetector.beforeCall(high, { tool: "grep", sigHash: sigHigh, messageID: "m" })
      expect(vHigh).toMatchObject({ kind: "assert", signal: "b" })
    })

    it("clears the streak on productive calls (novel >= 2 or ratio >= 50%)", () => {
      const state = DoomLoopDetector.state()
      const sig1 = DoomLoopDetector.signature("shell", { c: 1 })
      const sig2 = DoomLoopDetector.signature("shell", { c: 2 })
      const sig3 = DoomLoopDetector.signature("shell", { c: 3 })
      const sig4 = DoomLoopDetector.signature("shell", { c: 4 })
      DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig1, text: "n1\nn2\nn3" })
      DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig1, text: "n1\nn2\nn3" })
      expect(state.bStreak).toBe(1)
      // Two novel lines out of three clear the streak.
      DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig2, text: "new1\nnew2\nn1" })
      expect(state.bStreak).toBe(0)
      DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig2, text: "new1\nnew2\nn1" })
      expect(state.bStreak).toBe(1)
      // Two novel lines out of four (50%) also count as productive.
      DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig3, text: "new3\nnew4\nnew1\nnew2" })
      expect(state.bStreak).toBe(0)
      // A single novel line in a four-line output (25%) is a decorator variant, not progress.
      DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig4, text: "new5\nnew1\nnew2\nnew3" })
      expect(state.bStreak).toBe(1)
    })

    it("exempts outputs shorter than three lines from B while A still counts them", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("edit", { filePath: "a.ts" })
      const r1 = emit(state, "edit", { filePath: "a.ts" }, "short_1", { text: "Edited a.ts" })
      const r2 = emit(state, "edit", { filePath: "a.ts" }, "short_2", { text: "Edited a.ts" })
      const r3 = emit(state, "edit", { filePath: "a.ts" }, "short_3", { text: "Edited a.ts" })
      expect(r1.warning).toBeUndefined()
      expect(r2.warning).toBeUndefined()
      // A has no length exemption: the third identical one-line receipt warns.
      expect(r3.warning).toContain("byte-identical")
      expect(state.bStreak).toBe(0)
      expect(state.signatures.get(sig)?.streak).toBe(3)
    })

    it("normalizes volatile tokens before novelty counting", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("shell", { command: "build" })
      emit(state, "shell", { command: "build" }, "v_1", { text: "build ok in 0.03s\nline two here\nline three here" })
      const r = emit(state, "shell", { command: "build" }, "v_2", {
        text: "build ok in 0.05s\nline two here\nline three here",
      })
      // "in 0.03s" and "in 0.05s" are the same normalized line, so the second call adds nothing.
      expect(state.bStreak).toBe(1)
      expect(r.warning).toBeUndefined()
      // The raw text differs, so A's byte-identical streak does not accumulate either.
      expect(state.signatures.get(sig)?.streak).toBe(1)
    })

    it("counts novel lines per distinct line within one output", () => {
      const seeded = DoomLoopDetector.state()
      DoomLoopDetector.recordCompleted(seeded, {
        tool: "shell",
        sigHash: DoomLoopDetector.signature("shell", { seed: 1 }),
        text: "seenA\nseenB\nseenC\nseenD",
      })
      // One distinct new line repeated three times inside a four-line output is one new fact,
      // not three: ratio 25% is unproductive.
      DoomLoopDetector.recordCompleted(seeded, {
        tool: "shell",
        sigHash: DoomLoopDetector.signature("shell", { v: 1 }),
        text: "freshX\nfreshX\nfreshX\nseenB",
      })
      expect(seeded.bStreak).toBe(1)

      const control = DoomLoopDetector.state()
      DoomLoopDetector.recordCompleted(control, {
        tool: "shell",
        sigHash: DoomLoopDetector.signature("shell", { seed: 1 }),
        text: "seenA\nseenB\nseenC\nseenD",
      })
      DoomLoopDetector.recordCompleted(control, {
        tool: "shell",
        sigHash: DoomLoopDetector.signature("shell", { v: 1 }),
        text: "freshY\nseenB\nseenC\nseenD",
      })
      expect(control.bStreak).toBe(1)
    })

    it("caps stored lines at 1KB", () => {
      const state = DoomLoopDetector.state()
      const pad = (i: number) => `pad${i}a\npad${i}b`
      emit(state, "shell", { c: 1 }, "cap_1", { text: `${"x".repeat(2000)}\n${pad(1)}` })
      emit(state, "shell", { c: 1 }, "cap_2", { text: `${"x".repeat(1500)}\n${pad(1)}` })
      const r3 = emit(state, "shell", { c: 1 }, "cap_3", { text: `${"x".repeat(1024)}DIFFERENT\n${pad(1)}` })
      // Every long line truncates to the same 1024 characters, so even the call whose
      // difference lives past the cap is judged unproductive.
      expect(state.bStreak).toBe(2)
      expect(r3.warning).toBeUndefined()
    })

    it("bounds the line store at 10k lines with FIFO half-eviction", () => {
      const state = DoomLoopDetector.state()
      const lines = (i: number) => `line${i}a\nline${i}b\nline${i}c`
      for (let i = 0; i < 3333; i++) {
        DoomLoopDetector.recordCompleted(state, {
          tool: "shell",
          sigHash: DoomLoopDetector.signature("shell", { i }),
          text: lines(i),
        })
      }
      expect(state.lines.order).toHaveLength(9999)
      DoomLoopDetector.recordCompleted(state, {
        tool: "shell",
        sigHash: DoomLoopDetector.signature("shell", { i: 3333 }),
        text: lines(3333),
      })
      // Crossing the cap evicts the oldest half in one sweep.
      expect(state.lines.order).toHaveLength(5002)
      expect(state.lines.set.has("line0a")).toBe(false)
      expect(state.lines.set.has("line3333a")).toBe(true)
    })

    it("tighten keeps the newest 1000 lines and preserves A and C", () => {
      const state = DoomLoopDetector.state()
      for (let i = 0; i < 667; i++) {
        DoomLoopDetector.recordCompleted(state, {
          tool: "shell",
          sigHash: DoomLoopDetector.signature("shell", { i }),
          text: `tight${i}a\ntight${i}b\ntight${i}c`,
        })
      }
      expect(state.lines.order).toHaveLength(2001)
      state.signatures.set("sig-a", { lastOutputHash: "h", streak: 5 })
      state.failures.set("sig-c", { lastFailureHash: "h", streak: 4 })
      DoomLoopDetector.tighten(state)
      expect(state.lines.order).toHaveLength(1000)
      expect(state.lines.set.has("tight0a")).toBe(false)
      expect(state.lines.set.has("tight666c")).toBe(true)
      // The execution-end sweep must not delete A/C counters.
      expect(state.signatures.get("sig-a")).toEqual({ lastOutputHash: "h", streak: 5 })
      expect(state.failures.get("sig-c")).toEqual({ lastFailureHash: "h", streak: 4 })
    })
  })

  describe("signal C", () => {
    it("warns at the 4th equivalent failure and asks on the 7th failure emission", () => {
      const state = DoomLoopDetector.state()
      let warnAt = 0
      let blockedAt = 0
      let blockedSignal = ""
      const sig = DoomLoopDetector.signature("edit", { filePath: "a.ts", oldString: "x" })
      for (let i = 1; i <= 8; i++) {
        const before = DoomLoopDetector.beforeCall(state, {
          tool: "edit",
          sigHash: sig,
          messageID: `c_${i}`,
        })
        if (before.kind === "assert" && blockedAt === 0) {
          blockedAt = i
          blockedSignal = before.signal
        }
        const warning = DoomLoopDetector.recordFailed(state, {
          tool: "edit",
          sigHash: sig,
          errorText: "String not found in document",
          validation: false,
        })
        if (warning !== undefined) warnAt = i
      }
      expect(warnAt).toBe(4)
      // The 7th failure emission is challenged in before, after six accountings.
      expect(blockedAt).toBe(7)
      expect(blockedSignal).toBe("c")
    })

    it("treats volatile-token differences as equivalent failures", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("shell", { command: "probe" })
      for (let i = 1; i <= 5; i++) {
        DoomLoopDetector.recordFailed(state, {
          tool: "shell",
          sigHash: sig,
          errorText: `Request failed after ${i}.${i}s: timeout`,
          validation: false,
        })
      }
      expect(state.failures.get(sig)?.streak).toBe(5)
    })

    it("survives interleaved successes of other tools and clears on same-tool success", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("edit", { filePath: "a.ts", oldString: "x" })
      for (let i = 0; i < 3; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "edit", sigHash: sig, messageID: `rc_${i}` })
        DoomLoopDetector.recordFailed(state, { tool: "edit", sigHash: sig, errorText: "String not found", validation: false })
        DoomLoopDetector.recordCompleted(state, {
          tool: "read",
          sigHash: DoomLoopDetector.signature("read", { f: `f${i}` }),
          text: `new ${i}\nlines ${i}\nhere ${i}`,
        })
      }
      // retry-then-read: successful reads of other files must not launder the failing edit.
      expect(state.failures.get(sig)?.streak).toBe(3)
      DoomLoopDetector.recordCompleted(state, { tool: "edit", sigHash: sig, text: "ok" })
      expect(state.failures.has(sig)).toBe(false)
    })

    it("never counts argument-validation failures", () => {
      const state = DoomLoopDetector.state()
      for (let i = 0; i < 8; i++) {
        DoomLoopDetector.recordFailed(state, {
          tool: "edit",
          sigHash: DoomLoopDetector.signature("edit", { filePath: "a.ts", oldString: "x" }),
          errorText: 'Invalid arguments for tool "edit":\nmissing oldString',
          validation: true,
        })
      }
      expect(state.failures.size).toBe(0)
    })
  })

  describe("lifecycle", () => {
    it("compaction zeroes A streaks but keeps hashes, clears B, and keeps C", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("shell", { command: "git status" })
      const out = "on branch main\nnothing to commit\nworking tree clean"
      for (let i = 0; i < 4; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: `co_${i}` })
        DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: out })
      }
      for (let i = 0; i < 4; i++) {
        DoomLoopDetector.recordFailed(state, { tool: "edit", sigHash: sig, errorText: "String not found", validation: false })
      }
      const hashBefore = state.signatures.get(sig)?.lastOutputHash
      DoomLoopDetector.compacted(state)
      expect(state.signatures.get(sig)?.streak).toBe(0)
      expect(state.signatures.get(sig)?.lastOutputHash).toBe(hashBefore)
      expect(state.lines.order).toEqual([])
      expect(state.bStreak).toBe(0)
      // C intentionally survives compaction: failure equivalence does not depend on context.
      expect(state.failures.get(sig)?.streak).toBe(4)
      // The kept hash makes the first post-compaction repeat a soft boundary (streak 1, not 2).
      DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: "co_5" })
      DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: out })
      expect(state.signatures.get(sig)?.streak).toBe(1)
    })

    it("user messages reset A/C counters and re-arm the breaker", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("grep", { pattern: "TODO" })
      for (let i = 0; i < 5; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: `u_${i}` })
        DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: "a:1\nb:2\nc:3" })
      }
      DoomLoopDetector.recordFailed(state, { tool: "edit", sigHash: sig, errorText: "boom", validation: false })
      DoomLoopDetector.userMessage(state)
      // Per-turn scoping: a new user message opens a fresh observation window for A and C too,
      // so a periodic legitimate re-check cannot accumulate into a block over days.
      expect(state.signatures.has(sig)).toBe(false)
      expect(state.failures.has(sig)).toBe(false)
      expect(state.bStreak).toBe(0)
    })

    it("file changes clear bStreak but never touch A or C", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("shell", { command: "git status" })
      for (let i = 0; i < 3; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: `f_${i}` })
        DoomLoopDetector.recordCompleted(state, { tool: "shell", sigHash: sig, text: "l1\nl2\nl3" })
      }
      DoomLoopDetector.recordFailed(state, { tool: "edit", sigHash: sig, errorText: "boom", validation: false })
      expect(state.bStreak).toBe(2)
      DoomLoopDetector.filesChanged(state)
      expect(state.bStreak).toBe(0)
      expect(state.signatures.get(sig)?.streak).toBe(3)
      expect(state.failures.get(sig)?.streak).toBe(1)
    })
  })

  describe("circuit breaker", () => {
    it("hard-stops without asking and stays sticky until the user speaks", () => {
      const state = DoomLoopDetector.state()
      state.bStreak = 12
      const sig = DoomLoopDetector.signature("read", { f: "a" })
      const v1 = DoomLoopDetector.beforeCall(state, { tool: "read", sigHash: sig, messageID: "ci_1" })
      const v2 = DoomLoopDetector.beforeCall(state, { tool: "read", sigHash: sig, messageID: "ci_2" })
      expect(v1.kind).toBe("circuit")
      expect(v2.kind).toBe("circuit")
      expect(v1.kind === "circuit" && v1.message).toContain("Stop making tool calls")
      // First trip is a permission ask (not yet sticky); a denied circuit becomes sticky.
      expect(v1.kind === "circuit" && v1.sticky).toBe(false)
      state.circuitBroken = true
      const sticky = DoomLoopDetector.beforeCall(state, { tool: "read", sigHash: sig, messageID: "ci_2b" })
      expect(sticky.kind).toBe("circuit")
      expect(sticky.kind === "circuit" && sticky.sticky).toBe(true)
      DoomLoopDetector.userMessage(state)
      const v3 = DoomLoopDetector.beforeCall(state, { tool: "read", sigHash: sig, messageID: "ci_3" })
      expect(v3.kind).toBe("pass")
    })

    it("short-circuits before the repeat guard so nothing asks during circuit", () => {
      const state = DoomLoopDetector.state()
      state.bStreak = 12
      const sig = DoomLoopDetector.signature("read", { f: "x" })
      for (let i = 1; i <= 6; i++) {
        const v = DoomLoopDetector.beforeCall(state, { tool: "read", sigHash: sig, messageID: "circ" })
        expect(v.kind).toBe("circuit")
      }
    })
  })

  describe("same-message repeat guard", () => {
    it("asks exactly once at the 3rd emission of one message and stays silent after", () => {
      const state = DoomLoopDetector.state()
      const ask = (messageID: string) =>
        DoomLoopDetector.beforeCall(state, {
          tool: "read",
          sigHash: DoomLoopDetector.signature("read", { filePath: "x" }),
          messageID,
        })
      expect(ask("msg_1").kind).toBe("pass")
      expect(ask("msg_1").kind).toBe("pass")
      expect(ask("msg_2").kind).toBe("pass")
      expect(ask("msg_2").kind).toBe("pass")
      const third = ask("msg_2")
      expect(third).toMatchObject({ kind: "assert", signal: "guard" })
      if (third.kind === "assert") expect(third.message).toContain("emitted 3 times")
      // One-shot: the 4th and 5th emissions of the same message do not ask again.
      expect(ask("msg_2").kind).toBe("pass")
      expect(ask("msg_2").kind).toBe("pass")
    })

    it("drops the old bucket when the messageID changes", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("read", { filePath: "x" })
      const emit = (messageID: string) => DoomLoopDetector.beforeCall(state, { tool: "read", sigHash: sig, messageID })
      expect(emit("m_a").kind).toBe("pass")
      expect(emit("m_a").kind).toBe("pass")
      // Two emissions in a new message drop the m_a bucket; returning to m_a starts from 1,
      // so its first emission back does not ask (a retained count of 2 would ask).
      expect(emit("m_b").kind).toBe("pass")
      expect(emit("m_a").kind).toBe("pass")
      expect(emit("m_a").kind).toBe("pass")
      // And the fresh m_a bucket still asks exactly once at its own 3rd emission.
      expect(emit("m_a")).toMatchObject({ kind: "assert", signal: "guard" })
      // Switching again drops the m_a bucket, so m_b recounts from 1 as well.
      expect(emit("m_b").kind).toBe("pass")
      expect(emit("m_b").kind).toBe("pass")
      expect(emit("m_b")).toMatchObject({ kind: "assert", signal: "guard" })
    })

    it("merges the A streak into the guard copy when carried across messages", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("grep", { pattern: "TODO" })
      for (let i = 0; i < 3; i++) {
        DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: "old_msg" })
        DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: "a:1\nb:2\nc:3" })
      }
      DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: "new_msg" })
      DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: "a:1\nb:2\nc:3" })
      DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: "new_msg" })
      DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: "a:1\nb:2\nc:3" })
      const v = DoomLoopDetector.beforeCall(state, { tool: "grep", sigHash: sig, messageID: "new_msg" })
      expect(v).toMatchObject({ kind: "assert", signal: "guard" })
      if (v.kind === "assert") expect(v.message).toContain("identical output")
    })
  })

  describe("unobserved layer", () => {
    it("prompts exactly once, at the 7th emission", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("question", {})
      let askedAt = 0
      for (let i = 1; i <= 12; i++) {
        const before = DoomLoopDetector.beforeCall(state, { tool: "question", sigHash: sig, messageID: `q_${i}` })
        if (before.kind === "assert" && askedAt === 0) askedAt = i
        if (before.kind === "pass") DoomLoopDetector.recordUnobserved(state, sig)
      }
      expect(askedAt).toBe(7)
      expect(state.highTierPrompted).toBe(true)
    })

    it("asks once for the guard and once for the unobserved tier, never more (combination)", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("shell", { command: "nohup build &" })
      let guard = 0
      let unobserved = 0
      for (let i = 1; i <= 8; i++) {
        const before = DoomLoopDetector.beforeCall(state, { tool: "shell", sigHash: sig, messageID: "bg" })
        if (before.kind === "assert" && before.signal === "guard") guard++
        if (before.kind === "assert" && before.signal === "unobserved") unobserved++
        if (before.kind === "pass") DoomLoopDetector.recordUnobserved(state, sig)
      }
      // The guard asks once at the 3rd emission; the high-tier prompt fires once at the 7th.
      expect(guard).toBe(1)
      expect(unobserved).toBe(1)
    })
  })

  describe("hashing and resource strings", () => {
    it("signatures are wildcard-safe 16-char hex of canonical JSON", () => {
      const a = DoomLoopDetector.signature("shell", { command: "ls", flag: true })
      const b = DoomLoopDetector.signature("shell", { flag: true, command: "ls" })
      expect(a).toBe(b)
      expect(a).toMatch(/^[0-9a-f]{16}$/)
      expect(DoomLoopDetector.signature("shell", { command: "ls -la" })).not.toBe(a)
    })

    it("isolates per-signal resource suffixes", () => {
      expect(DoomLoopDetector.resourceSuffix).toEqual({
        guard: ":repeat",
        unobserved: ":unobserved",
        a: "",
        b: "",
        c: "",
      })
    })

    it("falls back to stringified output so output-only tools still hash meaningfully", () => {
      const state = DoomLoopDetector.state()
      const sig = DoomLoopDetector.signature("mcp__res", { uri: "x" })
      const text1 = DoomLoopDetector.outputText([], { bytes: 10 })
      const text2 = DoomLoopDetector.outputText([], { bytes: 10 })
      DoomLoopDetector.recordCompleted(state, { tool: "mcp__res", sigHash: sig, text: text1 })
      DoomLoopDetector.recordCompleted(state, { tool: "mcp__res", sigHash: sig, text: text2 })
      expect(state.signatures.get(sig)?.streak).toBe(2)
      expect(
        DoomLoopDetector.outputText([
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ]),
      ).toBe("a\nb")
      expect(DoomLoopDetector.outputText("plain")).toBe("plain")
    })
  })

  describe("capacity bounds", () => {
    const record = (state: State, sig: string) =>
      DoomLoopDetector.recordCompleted(state, { tool: "grep", sigHash: sig, text: "same output" })

    it("evicts the oldest signature past the cap and restarts a recurred one from streak 1", () => {
      const state = DoomLoopDetector.state()
      record(state, "s_old")
      record(state, "s_old")
      expect(state.signatures.get("s_old")?.streak).toBe(2)
      for (let i = 0; i < 4096; i++) record(state, `s_${i}`)
      expect(state.signatures.size).toBe(4096)
      expect(state.signatures.has("s_old")).toBe(false)
      // A recurred evicted signature restarts at streak 1 — the same as an output change.
      record(state, "s_old")
      expect(state.signatures.get("s_old")?.streak).toBe(1)
    })

    it("keeps re-firing signatures hot: eviction takes the coldest entry", () => {
      const state = DoomLoopDetector.state()
      record(state, "hot_a")
      record(state, "hot_b")
      for (let i = 0; i < 4094; i++) record(state, `cold_${i}`)
      expect(state.signatures.size).toBe(4096)
      // Re-firing moves both to the newest positions, so the next insert evicts cold_0.
      record(state, "hot_a")
      record(state, "hot_b")
      record(state, "cold_new")
      expect(state.signatures.size).toBe(4096)
      expect(state.signatures.get("hot_a")?.streak).toBe(2)
      expect(state.signatures.get("hot_b")?.streak).toBe(2)
      expect(state.signatures.has("cold_0")).toBe(false)
    })

    it("bounds the unobserved map with the same LRU rule", () => {
      const state = DoomLoopDetector.state()
      DoomLoopDetector.recordUnobserved(state, "u_old")
      for (let i = 0; i < 4096; i++) DoomLoopDetector.recordUnobserved(state, `u_${i}`)
      expect(state.unobserved.size).toBe(4096)
      expect(state.unobserved.has("u_old")).toBe(false)
      DoomLoopDetector.recordUnobserved(state, "u_0")
      expect(state.unobserved.get("u_0")).toBe(2)
    })
  })
})
