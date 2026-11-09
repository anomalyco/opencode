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
