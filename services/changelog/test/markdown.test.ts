import { describe, expect, test } from "bun:test"
import { parseChangelog, renderEntry, renderInline, renderMarkdown } from "../src/markdown"

const fixture = `# Changelog

Release notes for OpenCode V2, newest first.

## v2.0.27 — 2026-10-12

### Highlights

- **Built-In Worktree Tools**: Ask OpenCode to use \`worktree_create\`. ([#53981](https://github.com/anomalyco/opencode/pull/53981))
- **Safer Remote Pairing**: The first \`opencode pair --remote\` now asks for confirmation.
  It also accepts \`--yes\`.
- A highlight without a bold title.

### Core

#### Improvements

- Added worktree tools. (#53981)

#### Bug fixes

- Fixed updater detection.

### TUI

- Displayed failures.

## v2.0.26 — 2026-10-08

### Core

- Reduced snapshot overhead.

## v2.0.25-beta.1
`

describe("parseChangelog", () => {
  test("splits entries on version headings and ignores the preamble", () => {
    const entries = parseChangelog(fixture)
    expect(entries.map((entry) => entry.tag)).toEqual(["v2.0.27", "v2.0.26", "v2.0.25-beta.1"])
    expect(entries[0]).toMatchObject({ version: "2.0.27", date: "2026-10-12", anchor: "v2-0-27" })
    expect(entries[2]).toMatchObject({ version: "2.0.25-beta.1", date: undefined, anchor: "v2-0-25-beta-1" })
  })

  test("does not split on level-two headings that are not versions", () => {
    const entries = parseChangelog("## v1.0.0 — 2026-01-01\n\n### Core\n\n- a\n\n## Notes\n\n- b\n")
    expect(entries).toHaveLength(1)
    expect(entries[0].sections[0].body).toContain("## Notes")
  })

  test("extracts highlights with bold titles and continuation lines", () => {
    const [entry] = parseChangelog(fixture)
    expect(entry.highlights).toEqual([
      {
        title: "Built-In Worktree Tools",
        body: "Ask OpenCode to use `worktree_create`. ([#53981](https://github.com/anomalyco/opencode/pull/53981))",
      },
      {
        title: "Safer Remote Pairing",
        body: "The first `opencode pair --remote` now asks for confirmation.\nIt also accepts `--yes`.",
      },
      { title: "", body: "A highlight without a bold title." },
    ])
  })

  test("keeps detailed sections with their subsections in order", () => {
    const [latest, previous] = parseChangelog(fixture)
    expect(latest.sections.map((section) => section.title)).toEqual(["Core", "TUI"])
    expect(latest.sections[0].body).toStartWith("#### Improvements")
    expect(latest.sections[0].body).toContain("#### Bug fixes\n\n- Fixed updater detection.")
    expect(previous.highlights).toEqual([])
    expect(previous.sections).toEqual([{ title: "Core", body: "- Reduced snapshot overhead." }])
  })

  test("returns no entries for a changelog without releases", () => {
    expect(parseChangelog("# Changelog\n\nRelease notes for OpenCode V2, newest first.\n")).toEqual([])
  })
})

describe("renderMarkdown", () => {
  test("escapes raw HTML and drops unsafe links", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror="y">')
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("javascript:")
    expect(html).toContain("&lt;script&gt;")
  })

  test("links issue references and opens GitHub in a new tab", () => {
    expect(renderInline("Fixed it. (#53981)")).toBe(
      'Fixed it. (<a href="https://github.com/anomalyco/opencode/issues/53981" target="_blank" rel="noopener noreferrer">#53981</a>)',
    )
    expect(renderInline("C#1 and &#35;2 stay text")).toBe("C#1 and &#35;2 stay text")
  })

  test("does not nest references inside existing links", () => {
    expect(renderInline("[#53981](https://github.com/anomalyco/opencode/pull/53981)")).toBe(
      '<a href="https://github.com/anomalyco/opencode/pull/53981" target="_blank" rel="noopener noreferrer">#53981</a>',
    )
  })

  test("shortens bare pull request URLs", () => {
    expect(renderInline("See https://github.com/anomalyco/opencode/pull/54561")).toBe(
      'See <a href="https://github.com/anomalyco/opencode/pull/54561" target="_blank" rel="noopener noreferrer">#54561</a>',
    )
  })

  test("renders an entry's highlights inline and sections as blocks", () => {
    const entry = renderEntry(parseChangelog(fixture)[0])
    expect(entry.highlights[0].title).toBe("Built-In Worktree Tools")
    expect(entry.highlights[0].body).toContain("<code>worktree_create</code>")
    expect(entry.sections[0].body).toContain("<h4>Improvements</h4>")
  })
})
