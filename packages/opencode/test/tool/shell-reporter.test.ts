import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { OUTPUT_REPORT_INTERVAL_MS, outputReporter } from "../../src/tool/shell"

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

const collector = () => {
  const values: string[] = []
  const report = (value: string) =>
    Effect.sync(() => {
      values.push(value)
    })
  return { values, report }
}

describe("tool.shell outputReporter", () => {
  test("first push always reports", async () => {
    const { values, report } = collector()
    const reporter = outputReporter(report)
    await run(reporter.push("one"))
    expect(values).toEqual(["one"])
  })

  test("push inside the interval and byte window is coalesced into flush", async () => {
    const { values, report } = collector()
    const reporter = outputReporter(report)
    await run(reporter.push("one"))
    await run(reporter.push("one-two"))
    // Still inside the 250ms interval and under the 16KB byte step.
    expect(values).toEqual(["one"])
    await run(reporter.flush)
    expect(values).toEqual(["one", "one-two"])
    // The trailing flush consumed the pending value.
    await run(reporter.flush)
    expect(values).toEqual(["one", "one-two"])
  })

  test("push after the interval reports immediately", async () => {
    const { values, report } = collector()
    const reporter = outputReporter(report)
    await run(reporter.push("one"))
    await new Promise((resolve) => setTimeout(resolve, OUTPUT_REPORT_INTERVAL_MS + 10))
    await run(reporter.push("two"))
    expect(values).toEqual(["one", "two"])
  })

  test("push past the byte step reports immediately", async () => {
    const { values, report } = collector()
    const reporter = outputReporter(report)
    await run(reporter.push("x"))
    // One byte over the 16KB step.
    await run(reporter.push("x".repeat(16 * 1024 + 1)))
    expect(values.length).toBe(2)
  })

  test("byte accounting counts UTF-8 bytes, not characters", async () => {
    const { values, report } = collector()
    const reporter = outputReporter(report)
    await run(reporter.push("x"))
    // "é" is two bytes in UTF-8; 8193 characters exceed the 16KB byte step.
    await run(reporter.push("é".repeat(8193)))
    expect(values.length).toBe(2)
  })

  test("flush serializes behind an in-flight push report", async () => {
    const { values } = collector()
    const order: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: (() => void) | undefined
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const reporter = outputReporter((value) =>
      Effect.suspend(() => {
        if (value === "one") {
          order.push("push-start")
          started!()
          return Effect.andThen(
            Effect.promise(() => gate),
            Effect.sync(() => {
              values.push(value)
              order.push("push-end")
            }),
          )
        }
        values.push(value)
        order.push(`flush:${value}`)
        return Effect.void
      }),
    )
    const push = run(reporter.push("one"))
    // The push report holds the permit before the flush is started.
    await running
    // The coalesced value is recorded while the gated push reports.
    await run(reporter.push("two"))
    const flushed = run(reporter.flush)
    release!()
    await push
    await flushed
    expect(order).toEqual(["push-start", "push-end", "flush:two"])
    expect(values).toEqual(["one", "two"])
  })

  test("empty output still reports through push", async () => {
    const { values, report } = collector()
    const reporter = outputReporter(report)
    await run(reporter.push(""))
    expect(values).toEqual([""])
  })

  test("flush is a no-op when nothing is pending", async () => {
    const { values, report } = collector()
    const reporter = outputReporter(report)
    await run(reporter.flush)
    expect(values).toEqual([])
  })
})
