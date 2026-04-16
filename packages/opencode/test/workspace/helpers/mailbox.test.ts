/**
 * Unit tests for the pure mailbox fan-out. No backend, no Effect runtime
 * — these tests must pass standalone so failures point at the helper
 * itself, not the substrate it's wired into.
 */
import { describe, expect, test } from "bun:test"
import { createMailboxFanout, type LogChunk } from "../../../src/workspace/helpers/mailbox"

const dec = new TextDecoder()
const idEncode = (s: string): Uint8Array => new TextEncoder().encode(s)

const collect = async (it: AsyncIterableIterator<Uint8Array>): Promise<string[]> => {
  const out: string[] = []
  for await (const chunk of it) out.push(dec.decode(chunk))
  return out
}

const arrayToAsync = async function* <T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item
}

describe("mailbox fan-out", () => {
  test("classifies stdout / stderr into separate mailboxes", async () => {
    const chunks: LogChunk[] = [
      { stream: "stdout", data: "out-1\n" },
      { stream: "stderr", data: "err-1\n" },
      { stream: "stdout", data: "out-2\n" },
    ]
    const fan = createMailboxFanout(arrayToAsync(chunks), { encode: idEncode })
    const [outs, errs, alls] = await Promise.all([
      collect(fan.stdout.iterator),
      collect(fan.stderr.iterator),
      collect(fan.all.iterator),
    ])
    expect(outs).toEqual(["out-1\n", "out-2\n"])
    expect(errs).toEqual(["err-1\n"])
    // `all` preserves driver order
    expect(alls).toEqual(["out-1\n", "err-1\n", "out-2\n"])
  })

  test("empty driver finishes cleanly", async () => {
    const fan = createMailboxFanout(arrayToAsync<LogChunk>([]), { encode: idEncode })
    expect(await collect(fan.stdout.iterator)).toEqual([])
    expect(await collect(fan.stderr.iterator)).toEqual([])
    expect(await collect(fan.all.iterator)).toEqual([])
  })

  test("only stdout closes when only stdout chunks are emitted", async () => {
    const chunks: LogChunk[] = [
      { stream: "stdout", data: "hi" },
      { stream: "stdout", data: " there" },
    ]
    const fan = createMailboxFanout(arrayToAsync(chunks), { encode: idEncode })
    const [outs, errs, alls] = await Promise.all([
      collect(fan.stdout.iterator),
      collect(fan.stderr.iterator),
      collect(fan.all.iterator),
    ])
    expect(outs.join("")).toBe("hi there")
    expect(errs).toEqual([])
    expect(alls.join("")).toBe("hi there")
  })

  test("driver errors propagate to every consumer", async () => {
    const boom = new Error("driver-boom")
    const driver: AsyncIterable<LogChunk> = {
      [Symbol.asyncIterator](): AsyncIterator<LogChunk> {
        let i = 0
        return {
          async next() {
            if (i++ === 0) {
              return { value: { stream: "stdout", data: "a" }, done: false }
            }
            throw boom
          },
        }
      },
    }
    const fan = createMailboxFanout(driver, { encode: idEncode })

    const tryCollect = async (
      it: AsyncIterableIterator<Uint8Array>,
    ): Promise<{ ok: string[]; err: unknown | null }> => {
      const ok: string[] = []
      try {
        for await (const chunk of it) ok.push(dec.decode(chunk))
        return { ok, err: null }
      } catch (e) {
        return { ok, err: e }
      }
    }

    const [a, b, c] = await Promise.all([
      tryCollect(fan.stdout.iterator),
      tryCollect(fan.stderr.iterator),
      tryCollect(fan.all.iterator),
    ])
    // stdout received the first chunk before the throw
    expect(a.ok).toEqual(["a"])
    expect(a.err).toBe(boom)
    expect(b.err).toBe(boom)
    expect(c.err).toBe(boom)
  })

  test("done promise resolves after the driver completes", async () => {
    const fan = createMailboxFanout(arrayToAsync<LogChunk>([{ stream: "stdout", data: "x" }]), {
      encode: idEncode,
    })
    // Drain so the driver completes
    await collect(fan.stdout.iterator)
    await fan.done
  })

  test("default encoder converts strings to UTF-8 bytes", async () => {
    const fan = createMailboxFanout(arrayToAsync<LogChunk>([{ stream: "stdout", data: "héllo" }]))
    const out = await collect(fan.stdout.iterator)
    // "héllo" → 6 UTF-8 bytes; if we got 5 we used a wrong encoder
    const total = out.reduce((acc, s) => acc + new TextEncoder().encode(s).length, 0)
    expect(total).toBe(6)
  })
})
