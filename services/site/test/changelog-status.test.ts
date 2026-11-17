import { describe, expect, test } from "bun:test"
import type { ChangelogRelease } from "../src/lib/changelog"
import { changelogEntryView, entryStatus, parseReleaseNotes } from "../src/lib/changelog-notes"

const release: ChangelogRelease = {
  tag: "v2.2.5",
  name: "v2.2.5",
  date: "2026-11-04T12:00:00Z",
  url: "https://github.com/anomalyco/opencode/releases/tag/v2.2.5",
  highlights: [],
  sections: [],
  notes: parseReleaseNotes("## Fixes\n- Fixed a crash when the session list was empty"),
}

// /changelog/<tag> and /changelog/<tag>.json answer with this status.
describe("release status", () => {
  test("a release in the list is a 200, live or stand-in", () => {
    expect(entryStatus(changelogEntryView([release], "v2.2.5"))).toBe(200)
    expect(entryStatus(changelogEntryView([release], "v2.2.5", true))).toBe(200)
  })

  test("a tag missing from GitHub's own list is a 404", () => {
    expect(entryStatus(changelogEntryView([release], "v0.0.1"))).toBe(404)
  })

  test("a tag missing from a stand-in list, or with no list, is a 503", () => {
    expect(entryStatus(changelogEntryView([release], "v1.1.6", true))).toBe(503)
    expect(entryStatus(changelogEntryView([], "v1.1.6"))).toBe(503)
  })
})
