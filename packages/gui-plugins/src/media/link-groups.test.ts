import { expect, test } from "bun:test"
import type { SessionMedia } from "@opencode/schema/session-media"
import { groupLinks } from "./link-groups"

const link = (url: string, title?: string): SessionMedia.Link => {
  const parsed = new URL(url)

  return {
    id: url,
    from: "agent",
    messageID: "msg_1",
    time: 0,
    url,
    title,
    host: parsed.hostname,
    site: parsed.hostname.replace(/^www\./, ""),
    via: "text",
  }
}

test("groups links by GitHub repository, else by site, with issues and pull requests as numbers", () => {
  const groups = groupLinks([
    link("https://github.com/anomalyco/opencode/issues/61420", "#61420"),
    link("https://opencode.ai/docs/providers", "Providers"),
    link("https://github.com/anomalyco/opencode/pull/61529"),
    link("https://github.com/anomalyco/opencode/blob/dev/README.md"),
    link("https://github.com/settings/tokens"),
    link("http://localhost:3000"),
    link("https://www.opencode.ai/"),
  ])

  expect(groups.map((group) => [group.label, group.github, group.chips.map((chip) => [chip.label, chip.ref])])).toEqual(
    [
      [
        "anomalyco/opencode",
        true,
        [
          ["#61420", true],
          ["#61529", true],
          ["blob/dev/README.md", false],
        ],
      ],
      [
        "opencode.ai",
        false,
        [
          ["Providers", false],
          ["opencode.ai", false],
        ],
      ],
      ["github.com", false, [["settings/tokens", false]]],
      ["localhost:3000", false, [["localhost:3000", false]]],
    ],
  )
})
