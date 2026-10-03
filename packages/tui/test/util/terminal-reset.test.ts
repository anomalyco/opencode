import { expect, test } from "bun:test"
import { resetTerminal, RESET_TERMINAL_SEQUENCE } from "../../src/util/terminal-reset"

function createMockStream() {
  const chunks: Buffer[] = []
  const stream = {
    chunks,
    write(data: string | Buffer) {
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
      return true
    },
    getText() {
      return Buffer.concat(chunks).toString("utf8")
    },
  }
  return { mock: stream, writable: stream as unknown as NodeJS.WritableStream }
}

test("writes the full reset sequence in order", () => {
  const { mock, writable } = createMockStream()
  resetTerminal(writable)
  expect(mock.getText()).toBe(RESET_TERMINAL_SEQUENCE)
})

test("disables mouse tracking modes", () => {
  const { mock, writable } = createMockStream()
  resetTerminal(writable)
  const output = mock.getText()
  expect(output).toContain("\x1b[?1000l")
  expect(output).toContain("\x1b[?1002l")
  expect(output).toContain("\x1b[?1006l")
})

test("restores focus events, bracketed paste, alternate screen, and cursor", () => {
  const { mock, writable } = createMockStream()
  resetTerminal(writable)
  const output = mock.getText()
  expect(output).toContain("\x1b[?1004l")
  expect(output).toContain("\x1b[?2004l")
  expect(output).toContain("\x1b[?1049l")
  expect(output).toContain("\x1b[?25h")
})

test("does not throw with a valid stream", () => {
  const { writable } = createMockStream()
  expect(() => resetTerminal(writable)).not.toThrow()
})
