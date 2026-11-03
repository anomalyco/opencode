import { describe, expect, test } from "bun:test"
import path from "path"
import { embed, parse } from "../src/highlights"

describe("highlights", () => {
  test("embeds only shared highlights from v2.2.5 for the TUI", async () => {
    const changelog = await Bun.file(path.resolve(import.meta.dir, "../../../CHANGELOG.md")).text()
    const notes = changelog.split(/^## v2\.2\.5 .*$/m)[1].split(/^## /m)[0]

    expect(parse(notes).items).toHaveLength(3)
    expect(JSON.parse(embed(notes) ?? "null")).toEqual([
      {
        title: "Percentage Compaction Buffer",
        body:
          'Set `"compaction": { "buffer": "20%" }` in `opencode.json` to keep a share of each model\'s context window free, ' +
          "so one setting fits models with small and large windows. Token counts still work.",
      },
    ])
  })

  test("keeps shared and unclassified highlights when embedding for the TUI", () => {
    const link = (id: number) => `https://github.com/anomalyco/opencode/pull/${id}`
    const notes = [
      "### Highlights",
      `- **Desktop Only**: Open the desktop popup. ([#1](${link(1)}))`,
      `- **Shared**: Available in both clients. ([#2](${link(2)}))`,
      `- **Mixed**: Desktop and core changes. ([#1](${link(1)}), [#3](${link(3)}))`,
      `- **Unknown**: Not classified in the details. ([#4](${link(4)}))`,
      "- **Unlinked**: No source link.",
      "### Desktop",
      `- Popup. ([#1](${link(1)}))`,
      `- Shared change. ([#2](${link(2)}))`,
      "### TUI",
      "- Shared change. ([#2](https://github.com/anomalyco/opencode/issues/2))",
      "```md",
      `- An example, not a TUI change. ([#1](${link(1)}))`,
      "```",
      "### Core",
      `- Core change. ([#3](${link(3)}))`,
    ].join("\r\n")

    expect(JSON.parse(embed(notes) ?? "null")).toEqual([
      { title: "Shared", body: "Available in both clients." },
      { title: "Mixed", body: "Desktop and core changes." },
      { title: "Unknown", body: "Not classified in the details." },
      { title: "Unlinked", body: "No source link." },
    ])
  })

  test("filters desktop highlights before applying the item limit", () => {
    const notes = [
      "### Highlights",
      ...Array.from(
        { length: 5 },
        (_, index) => `- **Desktop ${index}**: A desktop change. ([#1](https://github.com/anomalyco/opencode/pull/1))`,
      ),
      "- **Core**: A shared change. ([#2](https://github.com/anomalyco/opencode/pull/2))",
      "### Desktop",
      "- Desktop change. ([#1](https://github.com/anomalyco/opencode/pull/1))",
      "### Core",
      "- Shared change. ([#2](https://github.com/anomalyco/opencode/pull/2))",
    ].join("\n")

    expect(embed(notes)).toBe(JSON.stringify([{ title: "Core", body: "A shared change." }]))
  })

  test("does not embed a release with only desktop highlights", () => {
    expect(
      embed(
        "### Highlights\n- **Desktop**: A desktop change. ([#1](https://github.com/anomalyco/opencode/pull/1))\n" +
          "### Desktop\n- A change. ([#1](https://github.com/anomalyco/opencode/pull/1))",
      ),
    ).toBeUndefined()
  })

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
})
