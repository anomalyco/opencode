import { siteLinks } from "~/component/site/links"
import { navDefaults } from "~/component/site/settings"
import { translator } from "~/i18n"
import { docsUrl } from "~/lib/docs"

// What each main nav item is, keyed by its link. An item added to the nav without one still gets
// its row, just without a description.
const descriptions: Record<string, string> = {
  "/product": "desktop, mobile, terminal and SDK",
  [docsUrl()]: "guides and reference",
  "/data": "model usage rankings",
  "/console": "inference, subscriptions and teams",
  "/console/enterprise": "talk to our team",
  "/console/models": "models and prices",
  "/console/go": "from $10/month",
  "/changelog": "every release",
}

// Rows the sidebar's secondary nav doesn't have, after it.
const extra = [
  { label: "Humans", href: "/humans.txt", description: "the team and contributors" },
  { label: "Anomaly", href: "https://anoma.ly", description: "the company behind OpenCode" },
]

const secondaryDescriptions: Record<string, string> = {
  "https://discord.gg/opencode": "chat with the team and other users",
  "/press": "press kit and facts",
  "/brand": "logos, colors and usage",
  "/legal": "privacy policy and terms",
  "https://status.opencode.ai": "live system status",
}

/**
 * The sidebar's secondary nav as it shows by default (Settings › Footer links "community": no X,
 * Discord named "Community"), then Status. The language picker isn't a page, so it has no row.
 */
function defaultSecondary() {
  const links = siteLinks(translator("en"), (path) => path)
  return [
    ...links.secondary
      .filter((item) => !("social" in item))
      .map((item) => ({ label: ("community" in item && item.community) || item.label, href: item.href })),
    links.status,
  ].map((item) => ({ ...item, description: secondaryDescriptions[item.href] }))
}

/** The main nav as it shows by default (not a visitor's Design mode edits), in English. */
export function defaultNav() {
  const nav = siteLinks(translator("en"), (path) => path).nav
  return navDefaults
    .filter((entry) => entry.visible)
    .flatMap((entry) => nav.filter((item) => item.id === entry.id))
    .map((item) => ({ label: item.label, href: item.href }))
}

/**
 * The view-source comment's FOR HUMANS rows: the main nav in its default order, then the sidebar's
 * secondary nav, then the extra pages. A row whose link is already listed is left out. Paths share
 * one column, wide enough for the longest, so the descriptions line up.
 */
export function forHumansRows() {
  const nav = defaultNav()
  const rows = [...nav, ...defaultSecondary(), ...extra]
    .filter((row, index, all) => all.findIndex((item) => item.href === row.href) === index)
    .map((row) => ({
      ...row,
      description: ("description" in row ? row.description : undefined) ?? descriptions[row.href] ?? "",
    }))
  const path = Math.max(...rows.map((row) => row.href.length)) + 2
  return [
    ...rows.map((row) =>
      `  ├── ${row.label.padEnd(15)}${row.description ? row.href.padEnd(path) + row.description : row.href}`.trimEnd(),
    ),
    "  │",
    "  ├── Source         https://github.com/anomalyco/opencode",
    "  └── Contribute     https://github.com/anomalyco/opencode/blob/dev/CONTRIBUTING.md",
  ].join("\n")
}
