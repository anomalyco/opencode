import { describe, expect, test } from "bun:test"
import path from "path"
import { history, parse } from "../src/highlights"

describe("highlights", () => {
  test("parses the v2.0.27 release notes", async () => {
    const changelog = await Bun.file(path.resolve(import.meta.dir, "../../../CHANGELOG.md")).text()
    const notes = changelog.split(/^## v2\.0\.27 .*$/m)[1].split(/^## /m)[0]
    const result = parse(notes)

    expect(result.problems).toEqual([])
    expect(result.items.map((item) => item.title)).toEqual([
      "Built-In Worktree Tools",
      "Safer Remote Pairing",
      "Installable Web App",
      "Clear Session Failures",
      "Automatic Project Cleanup",
    ])
    expect(result.items[0].body).toBe(
      "Ask OpenCode to use `worktree_create`, `worktree_list`, and `worktree_remove` in Code Mode. You can create " +
        "isolated worktrees, move sessions into them, and remove them with normal edit approval.",
    )
    expect(result.items[2].body).toBe(
      "Use Chrome or Edge’s Install button to install the OpenCode web app, including when it runs behind an " +
        "authenticating proxy.",
    )
    expect(result.items.some((item) => item.body.includes("github.com") || item.body.includes("(["))).toBe(false)
  })

  test("joins wrapped lines and drops multiple trailing links", () => {
    const result = parse(
      [
        "### Highlights",
        "",
        "- **Reopen Closed Tabs:** Right-click the new-session button to bring back a session you closed by",
        "  mistake. ([#123](https://github.com/anomalyco/opencode/pull/123), [#124](https://github.com/anomalyco/opencode/pull/124))",
        "* **Faster [Search](https://example.com)**: Results now stream in.",
        "",
        "### Core",
        "",
        "- **Not a Highlight**: Ignored.",
      ].join("\n"),
    )

    expect(result).toEqual({
      items: [
        {
          title: "Reopen Closed Tabs",
          body: "Right-click the new-session button to bring back a session you closed by mistake.",
        },
        { title: "Faster Search", body: "Results now stream in." },
      ],
      problems: [],
    })
  })

  test("returns nothing without a Highlights section", () => {
    expect(parse("### Core\n\n- Fixed a bug.")).toEqual({ items: [], problems: [] })
  })

  test("reports malformed highlights instead of failing", () => {
    const result = parse("### Highlights\n\n- Plain bullet without a title.\n")
    expect(result.items).toEqual([])
    expect(result.problems).toHaveLength(2)
  })

  test("limits the number and length of highlights", () => {
    const result = parse(
      [
        "### Highlights",
        ...Array.from({ length: 7 }, (_, index) => `- **Item ${index}**: ${"word ".repeat(100)}`),
      ].join("\n"),
    )

    expect(result.items).toHaveLength(5)
    expect(result.items[0].body.length).toBeLessThanOrEqual(300)
    expect(result.items[0].body.endsWith("…")).toBe(true)
    expect(result.problems).toEqual(["Kept the first 5 of 7 highlights"])
  })

  test("reads the newest releases with highlights from CHANGELOG.md, newest first", async () => {
    const changelog = await Bun.file(path.resolve(import.meta.dir, "../../../CHANGELOG.md")).text()
    const versions = [...changelog.matchAll(/^## v(\d+\.\d+\.\d+) /gm)].map((match) => match[1])
    const result = history(changelog)

    expect(result.problems).toEqual([])
    expect(result.releases).toHaveLength(5)
    expect(result.releases[0].version).toBe(versions[0])
    // Releases keep the changelog's newest-first order.
    expect(result.releases.map((release) => versions.indexOf(release.version))).toEqual(
      result.releases.map((release) => versions.indexOf(release.version)).toSorted((a, b) => a - b),
    )
    expect(result.releases.every((release) => release.items.length > 0 && release.items.length <= 5)).toBe(true)
  })

  test("skips releases without highlights and reports problems only for the newest", () => {
    const release = (version: string, highlights: string) =>
      [`## v${version} — 2026-10-30`, "", "### Highlights", "", highlights, "", "### Core", "", "- A fix."].join("\n")
    const result = history(
      [
        "# Changelog",
        "",
        release("2.0.3", "- Plain bullet without a title."),
        release("2.0.2", "- **Two**: The second release."),
        release("2.0.1", "- Another plain bullet."),
        "## v2.0.0-beta.1 — 2026-10-01",
        "",
        "### Highlights",
        "",
        "- **Beta**: Not a release.",
        release("1.9.0", "- **One**: The first release."),
      ].join("\r\n"),
    )

    expect(result.releases).toEqual([
      { version: "2.0.2", items: [{ title: "Two", body: "The second release." }] },
      { version: "1.9.0", items: [{ title: "One", body: "The first release." }] },
    ])
    expect(result.problems).toEqual([
      "Skipped a highlight without a bold title and description: Plain bullet without a title.",
      "The Highlights section has no highlights in the expected format",
    ])
  })

  test("keeps the newest five releases", () => {
    const changelog = Array.from(
      { length: 7 },
      (_, index) => `## v2.0.${7 - index}\n\n### Highlights\n\n- **Release ${7 - index}**: Text.\n`,
    ).join("\n")

    expect(history(changelog).releases.map((release) => release.version)).toEqual([
      "2.0.7",
      "2.0.6",
      "2.0.5",
      "2.0.4",
      "2.0.3",
    ])
  })
})
