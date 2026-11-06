import { describe, expect, test } from "bun:test"
import { parseReleaseBody } from "../src/lib/changelog-feed"

// The real v2.2.1 release body: ### Highlights bullets plus product sections.
const v2 = `### Highlights

- **Keep Working Toward a Goal**: Run \`/goal <objective>\` in the TUI or Desktop to let the session continue until a reviewer confirms the objective is met. ([#59437](https://github.com/anomalyco/opencode/pull/59437))
- **Generate Images**: Enable \`experimental.image_generate\` to let agents create or edit images with the new \`image_generate\` tool. ([#59939](https://github.com/anomalyco/opencode/pull/59939), [#60096](https://github.com/anomalyco/opencode/pull/60096))
- **Inspect Background Shells**: Click a running shell in the Desktop activity pill to see its live output and stop it without leaving the menu. ([#59496](https://github.com/anomalyco/opencode/pull/59496))
- **New Default Model Picker**: Search favorites, recent models, providers, and variants from the redesigned model picker, which is now the default in Desktop. ([#59997](https://github.com/anomalyco/opencode/pull/59997))

### Core

#### Improvements

- Add opt-in scheduled prompts through \`/schedule\`. ([#59401](https://github.com/anomalyco/opencode/pull/59401))

### Desktop

#### Improvements

- **Clickable activity pill**: Click a running shell to inspect its live output. ([#59496](https://github.com/anomalyco/opencode/pull/59496))
- Redesigned the model picker, now the default.

#### Bug fixes

- Stopped queued prompts dropping frames as their content grows.

### TUI

#### Bug fixes

- Prevented middle-truncated paths from overflowing at narrow terminal widths.

**Thank you** to every contributor.
`

const v1 = `## Desktop

- Faster startup
- Fix the tray icon

## Core

- Update the server

<highlight source="Desktop">
<h2>Split panes</h2>
<p short="Side by side.">Work side by side.</p>
<img width="100" height="80" alt="Split panes" src="https://opencode.ai/split.png">
</highlight>
`

describe("parseReleaseBody", () => {
  test("parses v2 Highlights bullets into a Desktop highlight group", () => {
    const parsed = parseReleaseBody(v2)

    expect(parsed.sections.map((section) => section.title)).toEqual(["Core", "Desktop", "TUI"])

    const desktop = parsed.highlights.find((group) => group.source === "Desktop")

    expect(desktop?.items).toEqual([
      {
        title: "Keep Working Toward a Goal",
        description: "Run /goal <objective> in the TUI or Desktop to let the session continue until a reviewer confirms the objective is met.",
      },
      {
        title: "Generate Images",
        description:
          "Enable experimental.image_generate to let agents create or edit images with the new image_generate tool.",
      },
      {
        title: "Inspect Background Shells",
        description:
          "Click a running shell in the Desktop activity pill to see its live output and stop it without leaving the menu.",
      },
      {
        title: "New Default Model Picker",
        description:
          "Search favorites, recent models, providers, and variants from the redesigned model picker, which is now the default in Desktop.",
      },
    ])
  })

  test("prefers existing Highlights group and skips Desktop section backfill", () => {
    const parsed = parseReleaseBody(v2)
    const desktopSection = parsed.highlights.find((group) => group.source === "Desktop")

    // The Highlights bullets win, so the duplicated Desktop bullet is deduped; the plain bug-fix bullet stays out.
    expect(desktopSection?.items.map((item) => item.title)).not.toContain("Clickable activity pill")
    expect(desktopSection?.items.map((item) => item.title)).not.toContain(
      "Stopped queued prompts dropping frames as their content grows.",
    )
  })

  test("uses Desktop sections alone when the release has no Highlights bullets", () => {
    const body = `### Desktop

#### Improvements

- **Worktree picker**: Click the branch on the new-session screen to open the worktree picker. ([#60263](https://github.com/anomalyco/opencode/pull/60263))
`
    const parsed = parseReleaseBody(body)

    expect(parsed.highlights).toEqual([
      {
        source: "Desktop",
        items: [
          {
            title: "Worktree picker",
            description: "Click the branch on the new-session screen to open the worktree picker.",
          },
        ],
      },
    ])
  })

  test("keeps the old <highlight> HTML blocks and ## sections", () => {
    const parsed = parseReleaseBody(v1)

    expect(parsed.sections).toEqual([
      { title: "Desktop", items: ["Faster startup", "Fix the tray icon"] },
      { title: "Core", items: ["Update the server"] },
    ])

    expect(parsed.highlights).toEqual([
      {
        source: "Desktop",
        items: [
          {
            title: "Split panes",
            description: "Work side by side.",
            shortDescription: "Side by side.",
            media: { type: "image", src: "https://opencode.ai/split.png", width: "100", height: "80" },
          },
        ],
      },
    ])
  })

  test("returns no highlights for a release body without either format", () => {
    const parsed = parseReleaseBody("just some prose\n\nmore prose")

    expect(parsed.highlights).toEqual([])
    expect(parsed.sections).toEqual([])
  })
})
