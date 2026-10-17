import { expect, test } from "bun:test"
import { createDuplicateKeyGuard } from "../../src/util/key-dedupe"

const event = (guard: ReturnType<typeof createDuplicateKeyGuard>, sequence: string) =>
  guard(sequence) ? "" : sequence

const read = (guard: ReturnType<typeof createDuplicateKeyGuard>, sequences: string[]) => {
  const result = sequences.map((sequence) => event(guard, sequence)).join("")
  // Each read is a fresh event-loop turn; let the counters roll over.
  return Promise.resolve().then(() => Promise.resolve()).then(() => result)
}

test("accepts identical sequences inside one synchronous stdin read (bulk paste)", async () => {
  const guard = createDuplicateKeyGuard()
  expect(await read(guard, ["h", "e", "l", "l", "o"])).toBe("hello")
})

test("drops an isolated single keypress that reappears from a later read within the window", async () => {
  const guard = createDuplicateKeyGuard()
  expect(await read(guard, ["\x7f"])).toBe("\x7f")
  expect(await read(guard, ["\x7f"])).toBe("")
  // A further lone duplicate anchors on the original press and is dropped too.
  expect(await read(guard, ["\x7f"])).toBe("")
})

test("keeps repeated sequences across reads when either read carried more events (paste chunks)", async () => {
  const guard = createDuplicateKeyGuard()
  expect(await read(guard, ["h", "e", "l", "l", "o", " ", "w", "o", "r"])).toBe("hello wor")
  expect(await read(guard, ["l", "d", "!", "!"])).toBe("ld!!")
  expect(await read(guard, ["!", "!"])).toBe("!!")
})

test("keeps identical sequences once the duplicate window has passed", async () => {
  const guard = createDuplicateKeyGuard()
  expect(await read(guard, ["\x7f"])).toBe("\x7f")
  await Bun.sleep(10)
  expect(await read(guard, ["\x7f"])).toBe("\x7f")
})

test("accepts different sequences back to back", async () => {
  const guard = createDuplicateKeyGuard()
  expect(await read(guard, ["a"])).toBe("a")
  expect(await read(guard, ["b"])).toBe("b")
})

test("kitty-protocol repeats carry a different sequence and are accepted", async () => {
  const guard = createDuplicateKeyGuard()
  expect(await read(guard, ["\x1b[97;2:1u"])).toBe("\x1b[97;2:1u")
  expect(await read(guard, ["\x1b[97;2:2u", "\x1b[97;2:2u"])).toBe("\x1b[97;2:2u\x1b[97;2:2u")
})

test("never drops terminal responses or mouse reports", async () => {
  const guard = createDuplicateKeyGuard()
  const responses = [
    "\x1b[10;20R",
    "\x1b[?62;c",
    "\x1b[?997;1n",
    "\x1b[4;720;1440t",
    "\x1b[<0;5;3M",
    "\x1b]11;rgb:0/0/0\x07",
    "\x1bP>|ghostty 1.0\x1b\\",
    "\x1b_G0;ok\x1b\\",
  ]
  // Responses reach the downstream handlers twice without consuming each other.
  for (const sequence of responses) {
    expect(guard(sequence)).toBe(false)
    expect(guard(sequence)).toBe(false)
  }
})
