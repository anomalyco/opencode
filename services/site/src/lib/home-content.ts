import { docsUrl } from "~/lib/docs"
import { config } from "~/config"
import { logoMetrics } from "~/component/site/logo-metrics"
import type { Translate } from "~/i18n"
import { rich } from "~/i18n/rich"
import type { RichText } from "~/lib/markdown"
import { homeFaq } from "~/lib/faq-content"

// Product order rule: whenever copy lists the products, name them in this order: desktop, mobile,
// terminal, SDK (the order of `products` in component/site/product-data.ts).

/** Splits copy into text and links wherever one of the phrases appears, in any letter case. */
export function linkPhrases(text: string, links: readonly { text: string; href: string }[]): RichText {
  const lower = text.toLowerCase()
  // The phrase that appears first, so text before it is never skipped.
  const match = links
    .map((item) => ({ item, at: lower.indexOf(item.text.toLowerCase()) }))
    .filter((found) => found.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.item
  if (!match) return [text]
  const start = lower.indexOf(match.text.toLowerCase())
  const end = start + match.text.length
  return [
    ...(start > 0 ? [text.slice(0, start)] : []),
    { text: text.slice(start, end), href: match.href },
    ...linkPhrases(text.slice(end), links).filter((item) => item !== ""),
  ]
}

/**
 * The home page copy, shared by the page and its Markdown version so the two never drift.
 * `route` localizes a site path.
 */
export function homeContent(t: Translate, route: (path: string) => string) {
  const docs = (path: string) => `https://opencode.ai${docsUrl(path)}`
  return {
    title: t("home.title"),
    hero: {
      title: t("home.hero.title"),
      // Plain text, no links (David's call), whichever Design mode option shows.
      subtitle: [t("home.hero.subtitle.a"), t("home.hero.subtitle.b")] as const,
    },
    // Phrases that link to the docs in Design mode copy options for the sections below (the page's
    // own copy keeps its own links).
    copyLinks: [
      { text: "free models", href: docs("/console/models/#free-models") },
      { text: "200+ providers", href: docs("/providers/") },
      { text: "local models", href: docs("/models/#local") },
      { text: "MCP servers", href: docs("/mcp-servers/") },
      { text: "plugins", href: docs("/plugins/") },
      { text: "skills", href: docs("/skills/") },
      { text: "through ACP", href: docs("/cli/acp/") },
      { text: "listed in the docs", href: docs("/console/models/#privacy") },
    ],
    // Below the hero: company wordmarks (sources in public/logos/companies/README.md), or the model
    // providers OpenCode works with (marks from models.dev), cycling in slots on the carousel's grid.
    companies: {
      label: t("home.companies.label"),
      // Shown instead of the label when its column is too narrow for it on one line (logo-wall.tsx).
      labelShort: t("home.companies.labelShort"),
      items: [
        { name: "NVIDIA", logo: "nvidia" },
        { name: "Cloudflare", logo: "cloudflare" },
        { name: "Microsoft", logo: "microsoft" },
        { name: "GitHub", logo: "github" },
        { name: "ByteDance", logo: "bytedance" },
        { name: "Revolut", logo: "revolut" },
        { name: "Salesforce", logo: "salesforce" },
        { name: "Cisco", logo: "cisco" },
        { name: "Red Hat", logo: "red-hat" },
        { name: "Intel", logo: "intel" },
        { name: "Adobe", logo: "adobe" },
        { name: "IBM", logo: "ibm" },
        { name: "SAP", logo: "sap" },
        { name: "Lenovo", logo: "lenovo" },
        { name: "Linear", logo: "linear" },
        // Measured and ready to swap in: Shopee ("shopee"), Shopify ("shopify"), MongoDB ("mongodb"),
        // Inditex ("inditex"), Zara ("zara"), HackerOne ("hackerone") and Bosch ("bosch").
      ].map((item) => ({
        name: item.name,
        logo: `/logos/companies/${item.logo}.svg`,
        metrics: logoMetrics.companies[item.logo],
      })),
    },
    providers: {
      label: t("home.providers.label"),
      items: [
        { name: "Anthropic", logo: "anthropic" },
        { name: "OpenAI", logo: "openai" },
        { name: "Google", logo: "google" },
        { name: "GitHub Copilot", logo: "github-copilot" },
        { name: "xAI", logo: "xai" },
        { name: "DeepSeek", logo: "deepseek" },
        { name: "Mistral", logo: "mistral" },
        { name: "Ollama", logo: "ollama" },
        { name: "OpenRouter", logo: "openrouter" },
        { name: "Amazon Bedrock", logo: "amazon-bedrock" },
        { name: "Moonshot AI", logo: "moonshotai" },
        { name: "Z.ai", logo: "zai" },
      ].map((item) => ({
        name: item.name,
        logo: `/logos/providers/${item.logo}.svg`,
        metrics: logoMetrics.providers[item.logo],
      })),
    },
    // Services with official MCP servers (icons from Simple Icons), and the ways to extend OpenCode.
    tools: {
      title: t("home.tools.title"),
      lead: rich(t("home.tools.lead"), {
        mcp: docs("/mcp-servers/"),
        plugins: docs("/plugins/"),
        skills: docs("/skills/"),
      }),
      items: [
        { name: "GitHub", logo: "github" },
        { name: "Linear", logo: "linear" },
        { name: "Figma", logo: "figma" },
        { name: "Sentry", logo: "sentry" },
        { name: "Notion", logo: "notion" },
        { name: "Slack", logo: "slack" },
        { name: "Supabase", logo: "supabase" },
        { name: "Stripe", logo: "stripe" },
      ].map((item) => ({
        name: item.name,
        logo: `/logos/tools/${item.logo}.svg`,
        wordmark: `/logos/tools/wordmarks/${item.logo}.svg`,
        metrics: logoMetrics.toolWordmarks[item.logo],
      })),
    },
    // Each feature links to its page in the v2 docs.
    what: {
      title: t("home.what.title"),
      // The docs link ends the lead, like the links in the other sections' copy.
      lead: rich(t("home.what.lead"), { docs: docs("/") }),
      features: [
        // `copy` names the feature's Design mode copy (home.feature.<copy>.title and .body).
        {
          title: t("home.what.anyModel.title"),
          href: docs("/models/"),
          body: t("home.what.anyModel.body"),
          copy: "anyModel" as const,
        },
        {
          title: t("home.what.anyDevice.title"),
          href: docs("/"),
          body: t("home.what.anyDevice.body"),
          copy: "anyDevice" as const,
        },
        {
          title: t("home.what.multiSession.title"),
          href: docs("/cli/tui/#sessions"),
          body: t("home.what.multiSession.body"),
        },
        {
          title: t("home.what.plugins.title"),
          href: docs("/plugins/"),
          body: t("home.what.plugins.body"),
        },
        {
          title: t("home.what.mcp.title"),
          href: docs("/mcp-servers/"),
          body: t("home.what.mcp.body"),
        },
        {
          title: t("home.what.agents.title"),
          href: docs("/agents/"),
          body: t("home.what.agents.body"),
        },
        { title: t("home.what.skills.title"), href: docs("/skills/"), body: t("home.what.skills.body") },
        {
          title: t("home.what.commands.title"),
          href: docs("/commands/"),
          body: t("home.what.commands.body"),
        },
        {
          title: t("home.what.permissions.title"),
          href: docs("/permissions/"),
          body: t("home.what.permissions.body"),
        },
        {
          title: t("home.what.undo.title"),
          href: docs("/snapshots/"),
          body: t("home.what.undo.body"),
        },
      ],
    },
    openSource: {
      title: t("home.openSource.title"),
      /** Inline HTML with <strong> around the numbers. */
      lead: t("home.growth.body", {
        stars: config.github.starsFormatted.full,
        contributors: config.stats.contributors,
        commits: config.stats.commits,
        monthlyUsers: config.stats.monthlyUsers,
      }),
      stats: [
        { label: t("home.growth.githubStars"), value: config.github.starsFormatted.compact },
        { label: t("home.growth.contributors"), value: config.stats.contributorsCompact },
        { label: t("home.growth.monthlyDevs"), value: config.stats.monthlyUsers },
      ],
    },
    console: {
      title: t("site.nav.console"),
      headline: t("home.console.headline"),
      body: t("home.console.body"),
      cta: { text: t("home.console.cta"), href: "/console" },
      // The slim option: one line that names the Console, and a second action.
      slimHeadline: t("home.console.slimHeadline"),
      sales: { text: t("home.console.sales"), href: "/console/enterprise" },
    },
    faq: homeFaq(t, route),
  }
}
