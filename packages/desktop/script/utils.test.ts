import { expect, test } from "bun:test"
import { resolveCliChannel } from "./utils"

test.each([
  { channel: "preview-a", built: false, expected: "dev" },
  { channel: "preview-a", built: true, expected: "preview-a" },
  { channel: "beta", built: false, expected: "beta" },
  { channel: undefined, built: false, expected: "dev" },
  { channel: undefined, built: true, error: true },
  { channel: "", built: true, error: true },
])("selects the bundled CLI channel for $channel (built=$built)", (input) => {
  const previous = process.env.OPENCODE_CHANNEL
  if (input.channel === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = input.channel

  try {
    if (input.error) {
      expect(() => resolveCliChannel(input.built)).toThrow(Error)
      return
    }

    expect(resolveCliChannel(input.built)).toBe(input.expected)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous
  }
})
