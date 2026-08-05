// The TUI's `/loop …` argument parser. This is the only surface where the
// queue can be driven without a shell, so it has to accept the same knobs the
// CLI does — a flag the CLI has and this does not is a feature the TUI simply
// cannot reach.
import { describe, expect, test } from "bun:test"
import { parseLoopArgs, LoopArgDefaults, LoopArgError } from "@opencode-ai/sdk/v2"

describe("parseLoopArgs", () => {
  test("a bare prompt keeps the documented defaults", () => {
    const parsed = parseLoopArgs("keep working until done")
    expect(parsed.prompt).toBe("keep working until done")
    expect(parsed.max).toBe(LoopArgDefaults.maxIterations)
    expect(parsed.noProgressLimit).toBe(LoopArgDefaults.noProgressLimit)
    expect(parsed.queue).toBe(false)
    expect(parsed.sync).toBe(false)
    expect(parsed.interval).toBeUndefined()
  })

  test("numeric flags parse anywhere in the line and leave the prompt intact", () => {
    const parsed = parseLoopArgs("fix --max 5 the flaky test -i 30 --no-progress-limit 7")
    expect(parsed.prompt).toBe("fix the flaky test")
    expect(parsed.max).toBe(5)
    expect(parsed.interval).toBe(30)
    expect(parsed.noProgressLimit).toBe(7)
  })

  test("queue mode: remaining tokens are change slugs, not a prompt", () => {
    const parsed = parseLoopArgs("--queue retire-auto-reply loop-spec-queue")
    expect(parsed.queue).toBe(true)
    expect(parsed.prompt).toBe("retire-auto-reply loop-spec-queue")
  })

  test("gate overrides reach the TUI — the flags the CLI has", () => {
    const parsed = parseLoopArgs(
      "--queue --gate-cwd packages/opencode --test-command bun-test-session --verify-command tsgo",
    )
    expect(parsed.queue).toBe(true)
    expect(parsed.gateCwd).toBe("packages/opencode")
    expect(parsed.testCommand).toBe("bun-test-session")
    expect(parsed.verifyCommand).toBe("tsgo")
    // Flags must not leak into the slug list.
    expect(parsed.prompt).toBe("")
  })

  test("--sync and a custom completion token", () => {
    const parsed = parseLoopArgs("--queue --sync --completion-token DONE")
    expect(parsed.sync).toBe(true)
    expect(parsed.completionToken).toBe("DONE")
  })

  test("a flag missing its value is an error, not a silently swallowed prompt word", () => {
    expect(() => parseLoopArgs("work --max")).toThrow(LoopArgError)
    expect(() => parseLoopArgs("work --gate-cwd")).toThrow(LoopArgError)
    expect(() => parseLoopArgs("work --max soon")).toThrow(LoopArgError)
  })

  test("an empty line opens the management dialog rather than starting a loop", () => {
    const parsed = parseLoopArgs("")
    expect(parsed.prompt).toBe("")
    expect(parsed.queue).toBe(false)
  })
})
