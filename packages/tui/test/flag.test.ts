import { expect, test } from "bun:test"
import { flagEnabled } from "../src/config/flag"

// Each case: [description, TUI config `experimental`, build channel, OPENCODE_FLAGS, expected].
const cases: ReadonlyArray<[string, Record<string, boolean> | undefined, string, string | undefined, boolean]> = [
  ["off in a release build", undefined, "latest", undefined, false],
  ["on in a local build", undefined, "local", undefined, true],
  ["config turns it on in a release", { rich_media: true }, "latest", undefined, true],
  ["config turns it off in a local build", { rich_media: false }, "local", undefined, false],
  ["all_flags turns it on in a release", { all_flags: true }, "latest", undefined, true],
  ["its own setting beats all_flags", { all_flags: true, rich_media: false }, "latest", undefined, false],
  ["all_flags: false is not a kill switch", { all_flags: false }, "local", undefined, true],
  ["OPENCODE_FLAGS turns it on over config", { rich_media: false }, "latest", "todo,rich_media", true],
  ["OPENCODE_FLAGS turns it off over config", { rich_media: true }, "local", "-rich_media", false],
  ["OPENCODE_FLAGS=all turns it on", { rich_media: false }, "latest", "all", true],
  ["an opt-out beats all", undefined, "local", "all,-rich_media", false],
]

test.each(cases)("rich_media is %s", (_, experimental, channel, overrides, expected) => {
  expect(flagEnabled({ key: "rich_media", experimental, channel, overrides })).toBe(expected)
})

// An opt-in-only flag, todo, turns on only by name.
test.each([
  ["off in a local build", undefined, "local", undefined, false],
  ["not turned on by all_flags", { all_flags: true }, "local", undefined, false],
  ["not turned on by OPENCODE_FLAGS=all", undefined, "local", "all", false],
  ["on by name in config", { todo: true }, "latest", undefined, true],
  ["on by name in OPENCODE_FLAGS", undefined, "latest", "all,todo", true],
] as const)("todo is %s", (_, experimental, channel, overrides, expected) => {
  expect(flagEnabled({ key: "todo", experimental, channel, overrides })).toBe(expected)
})

// A local-only flag, opencode_api, stays off in a release whatever turns it on.
test.each([
  ["on in a local build", undefined, "local", undefined, true],
  ["off in a release named in OPENCODE_FLAGS", undefined, "latest", "opencode_api", false],
  ["off in a release set in config", { opencode_api: true }, "latest", undefined, false],
] as const)("opencode_api is %s", (_, experimental, channel, overrides, expected) => {
  expect(flagEnabled({ key: "opencode_api", experimental, channel, overrides })).toBe(expected)
})
