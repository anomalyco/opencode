import { docsSections } from "./navigation"

export function renderLlmsTxt(site: URL) {
  const base = new URL(import.meta.env.BASE_URL, site)
  const sections = docsSections.flatMap((section) => [
    `## ${section.title}`,
    "",
    ...section.groups.flatMap((group) => [
      ...(group.title && group.title !== section.title ? [`### ${group.title}`, ""] : []),
      ...group.items.map((item) => {
        const path = item.slug === "index" ? "" : `${item.slug.replace(/\/index$/, "")}/`
        return `- [${item.title}](${new URL(`docs/${path}`, base)})`
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
