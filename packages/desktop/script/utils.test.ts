import { expect, test } from "bun:test"
import { resolveCliChannel } from "./utils"

test.each([
  { channel: "preview-a", built: false, expected: "dev" },
  { channel: "preview-a", built: true, expected: "preview-a" },
  { channel: "beta", built: false, expected: "beta" },
])("selects the bundled CLI channel for $channel (built=$built)", (input) => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = input.channel

  try {
    expect(resolveCliChannel(input.built)).toBe(input.expected)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous
  }
})
