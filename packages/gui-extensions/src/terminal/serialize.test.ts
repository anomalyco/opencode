import { describe, test, expect, afterEach, spyOn } from "bun:test"
import { Terminal, Ghostty } from "ghostty-web"
import { SerializeAddon } from "./serialize"

const ghostty = await Ghostty.load()

const terminals: Terminal[] = []

afterEach(() => {
  for (const term of terminals) {
    term.dispose()
  }
  terminals.length = 0
  document.body.innerHTML = ""
})

function createTerminal(cols = 80, rows = 24): { term: Terminal; addon: SerializeAddon; container: HTMLElement } {
  const container = document.createElement("div")
  document.body.appendChild(container)

  const term = new Terminal({ cols, rows, ghostty })
  const addon = new SerializeAddon()
  term.loadAddon(addon)
  term.open(container)
  terminals.push(term)

  return { term, addon, container }
}

function writeAndWait(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, resolve)
  })
}

describe("SerializeAddon", () => {
  test("scrollback reads only the requested tail and restores the cursor on its screen row", async () => {
    const { term, addon } = createTerminal(20, 5)
    await writeAndWait(term, Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\r\n"))
    await writeAndWait(term, "\x1b[2A\x1b[3G")
    expect(term.buffer.normal.length).toBe(30)
    expect([term.buffer.normal.cursorX, term.buffer.normal.cursorY]).toEqual([2, 2])

    const reads = spyOn(term.buffer.normal, "getLine")
    const serialized = addon.serialize({ scrollback: 3 })
    expect(new Set(reads.mock.calls.map((args) => args[0]))).toEqual(new Set([22, 23, 24, 25, 26, 27, 28, 29]))
    reads.mockRestore()

    const restored = createTerminal(20, 5)
    await writeAndWait(restored.term, serialized)
    expect(restored.term.getScrollbackLength()).toBe(3)
    for (let row = 0; row < 8; row++) {
      expect(restored.term.buffer.normal.getLine(row)?.translateToString(true)).toBe(`line ${22 + row}`)
    }
    expect([restored.term.buffer.normal.cursorX, restored.term.buffer.normal.cursorY]).toEqual([2, 2])
  })

  test("preserves color scheme reporting mode", async () => {
    const { term, addon } = createTerminal()
    await writeAndWait(term, "\x1b[?2031h")

    expect(addon.serialize().startsWith("\x1b[?2031h")).toBe(true)
    expect(addon.serialize({ excludeModes: true }).startsWith("\x1b[?2031h")).toBe(false)
  })

  test("round trip keeps text, alternate screen, and colors", async () => {
    const prompt = createTerminal()
    await writeAndWait(
      prompt.term,
      ["\x1b[1;32m❯\x1b[0m \x1b[34mcd\x1b[0m /some/path", "\x1b[1;32m❯\x1b[0m \x1b[34mls\x1b[0m -la", "total 42"].join(
        "\r\n",
      ),
    )
    const text = await roundTrip(prompt)
    expect(/\x1b\[\d+X/.test(text.serialized)).toBe(false)
    expect([0, 1, 2].map((row) => text.restored.buffer.active.getLine(row)?.translateToString(true))).toEqual([
      "❯ cd /some/path",
      "❯ ls -la",
      "total 42",
    ])

    const alternate = createTerminal(20, 5)
    await writeAndWait(alternate.term, "normal\r\n")
    await writeAndWait(alternate.term, "\x1b[?1049h\x1b[HALT")
    expect(alternate.term.buffer.active.type).toBe("alternate")
    const screen = (await roundTrip(alternate)).restored.buffer.active
    expect(screen.type).toBe("alternate")
    expect(screen.getLine(0)?.translateToString(true)).toBe("ALT")
    expect([0, 32]).toContain(screen.getLine(0)!.getCell(10)!.getCode())

    const colors = createTerminal(40, 5)
    await writeAndWait(
      colors.term,
      "\x1b[38;2;255;0;0mHello\x1b[0m \x1b[38;2;0;255;0mWorld\x1b[0m!                            ",
    )
    const original = colors.term.buffer.active.getLine(0)!
    const line = (await roundTrip(colors, { range: { start: 0, end: 0 } })).restored.buffer.active.getLine(0)!
    expect([0, 6, 11].map((cell) => line.getCell(cell)!.getChars())).toEqual(["H", "W", "!"])
    expect([0, 6].map((cell) => line.getCell(cell)!.getFgColor())).toEqual(
      [0, 6].map((cell) => original.getCell(cell)!.getFgColor()),
    )
  })
})

async function roundTrip(
  source: ReturnType<typeof createTerminal>,
  options?: Parameters<SerializeAddon["serialize"]>[0],
) {
  const serialized = source.addon.serialize(options)
  const restored = createTerminal(source.term.cols, source.term.rows).term
  await writeAndWait(restored, serialized)
  return { serialized, restored }
}
