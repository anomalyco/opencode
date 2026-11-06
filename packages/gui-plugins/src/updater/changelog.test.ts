import { describe, expect, test } from "bun:test"
import { decodeFeed, readFeed } from "./changelog"

const read = (json: Parameters<typeof decodeFeed>[0], current = "2.2.1", previous = "2.2.0") =>
  readFeed(decodeFeed(json), current, previous)

const v2Feed = {
  releases: [
    {
      tag: "v2.2.1",
      name: "v2.2.1",
      date: "2026-10-29T05:16:55Z",
      highlights: [
        {
          source: "Desktop",
          items: [
            { title: "Keep Working Toward a Goal", description: "Run /goal to keep the session going." },
            { title: "Generate Images", description: "Let agents create or edit images." },
            { title: "Inspect Background Shells", description: "Click a running shell to see its live output." },
            { title: "New Default Model Picker", description: "Search favorites, recent models, and providers." },
          ],
        },
      ],
      sections: [],
    },
    { tag: "v2.2.0", highlights: [], sections: [] },
  ],
}

describe("readFeed", () => {
  test("returns the desktop highlights since the version seen", () => {
    const feed = read(v2Feed)

    expect(feed.status).toBe("highlights")

    if (feed.status !== "highlights") throw new Error("expected highlights")

    expect(feed.highlights.map((item) => item.title)).toEqual([
      "Keep Working Toward a Goal",
      "Generate Images",
      "Inspect Background Shells",
      "New Default Model Picker",
    ])
  })

  test("falls back to Desktop sections when a release has no highlight groups", () => {
    const feed = read({
      releases: [
        {
          tag: "v2.2.1",
          highlights: [],
          sections: [
            { title: "Core", items: ["A server change."] },
            {
              title: "Desktop",
              items: [
                "**Worktree picker**: Click the branch on the new-session screen to open the picker.",
                "Fixed a bug without a bold lead-in.",
              ],
            },
          ],
        },
        { tag: "v2.2.0", highlights: [], sections: [] },
      ],
    })

    expect(feed).toEqual({
      status: "highlights",
      highlights: [
        {
          title: "Worktree picker",
          description: "Click the branch on the new-session screen to open the picker.",
        },
      ],
    })
  })

  test("marks the version seen when the current release is in the feed with no desktop content", () => {
    expect(
      read({
        releases: [
          { tag: "2.2.1", highlights: [{ source: "mobile", title: "Phone only", description: "Not here." }] },
        ],
      }).status,
    ).toBe("seen")
  })

  test("leaves What's New for the next start when the current release is missing from the feed", () => {
    expect(read({ releases: [{ tag: "v2.2.0", highlights: [], sections: [] }] }).status).toBe("unavailable")
  })

  test("leaves What's New for the next start when the feed cannot be parsed", () => {
    expect(read({ releases: "broken" }).status).toBe("unavailable")
    expect(read(null).status).toBe("unavailable")
  })

  test("reads the list form and skips malformed entries leniently", () => {
    expect(
      read([
        { tag: "v2.2.1", highlights: [{ source: "desktop", title: "Faster startup", description: "Half the time." }] },
        null,
      ]),
    ).toEqual({
      status: "highlights",
      highlights: [{ title: "Faster startup", description: "Half the time." }],
    })
  })
})
