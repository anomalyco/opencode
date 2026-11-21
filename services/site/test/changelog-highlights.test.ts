import { describe, expect, test } from "bun:test"
import type { ChangelogRelease } from "../src/lib/changelog"
import { changelogEntryView, changelogView, parseReleaseNotes } from "../src/lib/changelog-notes"

const pr = (number: number) => `[#${number}](https://github.com/anomalyco/opencode/pull/${number})`

// The shape of v2.2.6: five highlights, each repeated as a note under the area it belongs to.
const body = [
  "### Highlights",
  "",
  `- **Shared MCP Connections**: Share one connection across projects. (${pr(61185)})`,
  `- **GUI Plugin Themes and New Slots**: GUI plugins can add color themes. (${pr(61485)}, ${pr(61533)})`,
  `- **Mobile Composer Dock**: Composer actions sit in a touch dock. (${pr(61773)})`,
  `- **Scripted Runs in Worktrees**: Run \`opencode run -w\`. (${pr(60712)})`,
  `- **Automatically Archived Runs**: Add \`--archived\` to \`opencode run\`. (${pr(61270)})`,
  "",
  "### Core",
  "",
  "#### Improvements",
  "",
  `- Added opt-in MCP connection sharing through \`pool: true\`. (${pr(61185)})`,
  `- Added \`opencode run --archived\`. (${pr(61270)})`,
  `- Added \`opencode run --worktree\`. (${pr(60712)})`,
  `- Added Azure Messages support for Foundry Claude models. (${pr(60934)})`,
  "",
  "### Desktop",
  "",
  "#### Improvements",
  "",
  `- Added a mobile composer dock for touch devices. (${pr(61773)})`,
  `- Added close-other-tabs and close-tabs-after actions to the tab menu. (${pr(61631)})`,
  "",
  "### Extensions",
  "",
  "#### Improvements",
  "",
  `- GUI plugins can contribute themes through the \`Theme\` registry. (${pr(61485)})`,
  `- Added \`CodeBlock\` and \`CodeBlockAction\` GUI registries. (${pr(61533)})`,
].join("\n")

const release: ChangelogRelease = {
  tag: "v2.2.6",
  name: "v2.2.6",
  date: "2026-11-06T23:37:20Z",
  url: "https://github.com/anomalyco/opencode/releases/tag/v2.2.6",
  highlights: [],
  sections: [],
  notes: parseReleaseNotes(body),
}

describe("release highlights", () => {
  test("every highlight is read, with the areas of the notes that repeat it", () => {
    expect(release.notes.features.map((feature) => [feature.title, feature.areas])).toEqual([
      ["Shared MCP Connections", ["Core"]],
      ["GUI Plugin Themes and New Slots", ["Extensions"]],
      ["Mobile Composer Dock", ["Desktop"]],
      ["Scripted Runs in Worktrees", ["Core"]],
      ["Automatically Archived Runs", ["Core"]],
    ])
  })

  test("all areas show every highlight: the first leads, the rest follow", () => {
    const entry = changelogView([release]).entries[0]
    expect(entry.title).toBe("Shared MCP Connections")
    expect(entry.features.map((feature) => feature.title)).toEqual([
      "GUI Plugin Themes and New Slots",
      "Mobile Composer Dock",
      "Scripted Runs in Worktrees",
      "Automatically Archived Runs",
    ])
    expect(entry.hiddenFeatures).toBe(0)
  })

  test("a release's own page shows every highlight", () => {
    const entry = changelogEntryView([release], "v2.2.6").entries[0]
    expect([entry.title, ...entry.features.map((feature) => feature.title)]).toHaveLength(5)
    expect(entry.hiddenFeatures).toBe(0)
  })

  test("an area shows its own highlights and counts the ones it leaves out", () => {
    const desktop = changelogView([release], { filter: ["desktop"] }).entries[0]
    expect(desktop.title).toBe("Mobile Composer Dock")
    expect(desktop.features).toEqual([])
    expect(desktop.hiddenFeatures).toBe(4)

    const core = changelogView([release], { filter: ["core"] }).entries[0]
    expect([core.title, ...core.features.map((feature) => feature.title)]).toEqual([
      "Shared MCP Connections",
      "Scripted Runs in Worktrees",
      "Automatically Archived Runs",
    ])
    expect(core.hiddenFeatures).toBe(2)
  })
})
