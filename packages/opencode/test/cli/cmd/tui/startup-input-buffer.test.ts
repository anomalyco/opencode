import { describe, expect, test } from "bun:test"
import {
  appendStartupInputBufferChunk,
  createStartupInputBufferState,
} from "../../../../src/cli/cmd/tui/startup-input-buffer"

function append(chunks: string[]) {
  return chunks.reduce(appendStartupInputBufferChunk, createStartupInputBufferState()).input
}

describe("startup input buffer", () => {
  test("keeps printable text", () => {
    expect(append(["hello world"])).toBe("hello world")
  })

  test("handles simple editing controls", () => {
    expect(append(["hello", "\x7f!\x15again"])).toBe("again")
  })

  test("drops terminal escape responses", () => {
    expect(append(["\x1b]11;rgb:ffff/ffff/ffff\x07hello\x1b[?2026;1$y\x1bPignored\x1b\\"])).toBe("hello")
  })

  test("keeps bracketed paste content", () => {
    expect(append(["\x1b[200~one\ntwo\x1b[201~"])).toBe("one\ntwo")
  })

  test("drops terminal responses split across chunks", () => {
    expect(append(["\x1b]11;rgb:", "0000/afaf/ffff\x07hello"])).toBe("hello")
  })
})
