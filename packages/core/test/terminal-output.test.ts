import { describe, expect, test } from "bun:test"
import { TerminalOutput } from "@opencode-ai/core/terminal-output"

describe("TerminalOutput", () => {
  test("preserves ordinary line output", () => {
    expect(TerminalOutput.render("installing\nbuilding\ndone\n")).toBe("installing\nbuilding\ndone\n")
  })

  test("applies carriage returns as line overwrites", () => {
    expect(TerminalOutput.render("\rprogress 1%\rprogress 2%\rprogress 3%\ndone\n")).toBe("progress 3%\ndone\n")
  })

  test("preserves the stale tail unless it is erased", () => {
    expect(TerminalOutput.render("downloading\rdone")).toBe("doneloading")
    expect(TerminalOutput.render("downloading\rdone\x1b[K")).toBe("done")
  })

  test("handles erase-line and SGR sequences", () => {
    expect(TerminalOutput.render("\x1b[31mold\x1b[0m\x1b[2K\rnew\n")).toBe("new\n")
  })

  test("keeps parser state across chunks", () => {
    const state = TerminalOutput.make()
    expect(state.write("long line\rshort\x1b[")).toBe("")
    expect(state.write("K\nfinal")).toBe("short\n")
    expect(state.finish()).toBe("final")
  })

  test("handles backspace and horizontal cursor movement", () => {
    expect(TerminalOutput.render("abc\bX\x1b[2D!\n")).toBe("a!X\n")
  })

  test("bounds unfinished lines without reporting cleared content as truncated", () => {
    const truncated = TerminalOutput.make({ maxLineLength: 5 })
    truncated.write("123456")
    expect(truncated.finish()).toBe("12345")
    expect(truncated.truncated()).toBe(true)

    const cleared = TerminalOutput.make({ maxLineLength: 5 })
    cleared.write("123456\rOK\x1b[K")
    expect(cleared.finish()).toBe("OK")
    expect(cleared.truncated()).toBe(false)
  })

  test("discards OSC and control strings", () => {
    expect(TerminalOutput.render("before\x1b]52;c;secret\x07after\x1bPignored\x1b\\done")).toBe("beforeafterdone")
  })
})
