import { describe, expect, test } from "bun:test"

/** Temporarily set process.env.TMUX, restore afterwards, passthrough return value. */
async function withTmux<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env["TMUX"]
  if (value === undefined) delete process.env["TMUX"]
  else process.env["TMUX"] = value
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env["TMUX"]
    else process.env["TMUX"] = before
  }
}

/** Temporarily set stdout.isTTY, restore afterwards, passthrough return value. */
async function withTty<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value })
  try {
    return await fn()
  } finally {
    if (desc) {
      Object.defineProperty(process.stdout, "isTTY", desc)
    } else {
      delete (process.stdout as any).isTTY
    }
  }
}

/** Replace process.stdout.write to collect writes into an array, restore afterwards. */
async function captureStdoutWrite(fn: () => Promise<void>): Promise<Buffer[]> {
  const bufs: Buffer[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: any) => {
    bufs.push(Buffer.from(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    await fn()
    return bufs
  } finally {
    process.stdout.write = origWrite
  }
}

describe("clipboard writeOsc52", () => {
  test("emits plain OSC 52 without TMUX: ESC ] 5 2 ; c ; <b64> BEL", async () => {
    const bufs = await withTty(true, () =>
      withTmux(undefined, () =>
        captureStdoutWrite(async () => {
          const { copy } = await import("../../../../../src/cli/cmd/tui/util/clipboard")
          await copy("hello").catch(() => {})
        }),
      ),
    )

    expect(bufs.length).toBeGreaterThanOrEqual(1)

    const buf = bufs[0]!

    // ESC ] 5 2 ; c ; aGVsbG8= BEL
    expect(buf[0]).toBe(0x1b) // ESC
    expect(buf[1]).toBe(0x5d) // ]
    expect(buf.slice(2, 5).toString()).toBe("52;")
    expect(buf.slice(5, 7).toString()).toBe("c;")
    expect(buf.slice(7, 15).toString()).toBe("aGVsbG8=") // base64("hello")
    expect(buf[buf.length - 1]).toBe(0x07) // BEL
    expect(buf.filter((b) => b === 0x1b).length).toBe(1)
  })

  test("emits DCS-wrapped OSC 52 with TMUX: ESC P tmux ; ESC ] ... BEL ESC \\", async () => {
    const bufs = await withTty(true, () =>
      withTmux("ses", () =>
        captureStdoutWrite(async () => {
          const { copy } = await import("../../../../../src/cli/cmd/tui/util/clipboard")
          await copy("x").catch(() => {})
        }),
      ),
    )

    expect(bufs.length).toBeGreaterThanOrEqual(1)

    const buf = bufs[0]!

    // DCS prefix: ESC P t m u x ;
    expect(buf[0]).toBe(0x1b)
    expect(buf[1]).toBe(0x50)
    expect(buf.slice(2, 7).toString()).toBe("tmux;")

    // Immediately after "tmux;" we must have ESC ] (1b 5d), NOT ESC ESC (1b 1b)
    expect(buf[7]).toBe(0x1b)
    expect(buf[8]).toBe(0x5d)
    // ^ If there were a double-ESC bug, buf[8] would be 0x1b

    // OSC 52 content inside DCS wrapper
    expect(buf.slice(7, 9).toString()).toBe("\x1b]")
    expect(buf.slice(9, 12).toString()).toBe("52;")
    expect(buf.slice(12, 14).toString()).toBe("c;")

    // DCS terminator: ESC \
    expect(buf[buf.length - 2]).toBe(0x1b)
    expect(buf[buf.length - 1]).toBe(0x5c)

    // CRITICAL: exactly 3 ESC bytes (no double-ESC bug)
    expect(buf.filter((b) => b === 0x1b).length).toBe(3)
  })

  test("skips OSC 52 write when stdout is not a TTY", async () => {
    const bufs = await withTty(false, () =>
      withTmux(undefined, () =>
        captureStdoutWrite(async () => {
          const { copy } = await import("../../../../../src/cli/cmd/tui/util/clipboard")
          await copy("data").catch(() => {})
        }),
      ),
    )

    for (const b of bufs) {
      expect(b.toString()).not.toMatch(/\x1b\]52;c;/)
    }
  })
})
