import { describe, expect, test } from "bun:test"
import path from "path"

const STDOUT_MODULE = path.join(import.meta.dir, "../../src/util/stdout.ts")

// 200 KB is comfortably past the 64 KiB pipe buffer where the truncation bit.
const SIZE = 200_000

/**
 * Runs a writer in a child process behind a *slow* reader and returns the byte
 * count that survived.
 *
 * The delay matters. With a reader that drains immediately the pipe never fills,
 * write() never reports backpressure, and even a broken writer looks correct;
 * that false pass is what let this bug survive an earlier fix attempt. Sleeping
 * first guarantees the buffer is full before anything is consumed.
 */
async function survivingBytes(writer: string, delaySeconds = 1) {
  const proc = Bun.spawn(
    ["sh", "-c", `${process.execPath} -e '${writer.replace(/'/g, `'\\''`)}' | { sleep ${delaySeconds}; cat; } | wc -c`],
    { stdout: "pipe", stderr: "pipe" },
  )
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return Number(out.trim())
}

const awaited = `const { writeStdout } = await import(${JSON.stringify(STDOUT_MODULE)}); await writeStdout("x".repeat(${SIZE})); process.exit(0)`
const unawaited = `process.stdout.write("x".repeat(${SIZE})); process.exit(0)`

describe("writeStdout", () => {
  test("delivers a payload larger than the pipe buffer to a slow reader", async () => {
    expect(await survivingBytes(awaited)).toBe(SIZE)
  })

  test("an unawaited write truncates under the same conditions", async () => {
    // Guards the guard: if this ever passes, the test above proves nothing.
    expect(await survivingBytes(unawaited)).toBeLessThan(SIZE)
  })

  test("resolves instead of hanging when the reader goes away", async () => {
    // `| head` closes the pipe early. Waiting for a drain that never arrives
    // would hang the command forever.
    const proc = Bun.spawn(["sh", "-c", `${process.execPath} -e '${awaited.replace(/'/g, `'\\''`)}' | head -c 10`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    expect(out.length).toBe(10)
  })

  test("short payloads are unaffected", async () => {
    const proc = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const { writeStdout } = await import(${JSON.stringify(STDOUT_MODULE)}); await writeStdout("hello"); process.exit(0)`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const out = await new Response(proc.stdout).text()
    await proc.exited
    expect(out).toBe("hello")
  })
})
