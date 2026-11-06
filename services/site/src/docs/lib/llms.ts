import { base } from "../config"
import { docsSections } from "./navigation"

export function renderLlmsTxt(site: URL) {
  const root = new URL(base, site)
  const sections = docsSections.flatMap((section) => [
    `## ${section.title}`,
    "",
    ...section.groups.flatMap((group) => [
      ...(group.title && group.title !== section.title ? [`### ${group.title}`, ""] : []),
      ...group.items.map((item) => {
        const path = item.slug === "index" ? "" : `${item.slug.replace(/\/index$/, "")}/`
        return `- [${item.title}](${new URL(`docs/${path}`, root)})`
      }),
      "",
    ]),
  ])

  return [
    "# OpenCode V2 Documentation",
    "",
    "> Official documentation for using, configuring, and building with OpenCode V2.",
    "",
    ...sections,
  ].join("\n")
}
