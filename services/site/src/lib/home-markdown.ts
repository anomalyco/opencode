import { products } from "~/component/site/product-data"
import { siteLinks } from "~/component/site/links"
import { navDefaults } from "~/component/site/settings"
import { byos } from "~/lib/byos"
import { getStarted } from "~/lib/get-started"
import { homeContent, linkPhrases } from "~/lib/home-content"
import { blocks, inlineHtmlToMarkdown, link, richToMarkdown, type MarkdownContext } from "~/lib/markdown"
import { productActionMarkdown } from "~/lib/product-markdown"

/** The home page as Markdown, for `/index.md` and the in-page Markdown view. */
export function homeMarkdown(context: MarkdownContext) {
  const content = homeContent(context.t, context.route)
  const links = siteLinks(context.t, context.route)
  const start = getStarted(context.route)

  return blocks(
    `# ${content.hero.title}`,
    content.hero.subtitle.join(" "),
    `${content.companies.label}, including at ${content.companies.items.map((item) => item.name).join(", ")}.`,
    "## Products",
    ...products.map((product) =>
      blocks(
        `### ${link(product.name, context.route(`/${product.slug}`))}${"isNew" in product && product.isNew ? ` (${context.t("home.banner.badge")})` : ""}`,
        product.body,
        productActionMarkdown(product.slug, context),
      ).trimEnd(),
    ),
    `## ${content.what.title}`,
    richToMarkdown(content.what.lead),
    content.what.features.map((feature) => `- **${link(feature.title, feature.href)}:** ${feature.body}`).join("\n"),
    `## ${start.title}`,
    richToMarkdown(linkPhrases(start.lead, start.phrases)),
    `Free models today include ${start.freeModels.join(", ")}. ${start.plans.map((plan) => `${link(plan.name, plan.href)}: ${plan.amount}/month`).join(". ")}.`,
    `## ${byos.title}`,
    `${byos.headline} ${richToMarkdown(
      linkPhrases(
        byos.line,
        byos.planLinks.map((text) => ({ text, href: byos.plansHref })),
      ),
    )}`,
    `## ${content.tools.title}`,
    richToMarkdown(content.tools.lead),
    `Works with MCP servers for ${content.tools.items.map((item) => item.name).join(", ")} and more.`,
    `## ${content.openSource.title}`,
    inlineHtmlToMarkdown(content.openSource.lead),
    content.openSource.stats.map((stat) => `- ${stat.label}: ${stat.value}`).join("\n"),
    `## ${content.faq.title}`,
    ...content.faq.items.map((item) => blocks(`### ${item.question}`, richToMarkdown(item.answer)).trimEnd()),
    `## ${content.console.title}`,
    `**${content.console.headline}**`,
    content.console.body,
    `${link(content.console.cta.text, content.console.cta.href)}.`,
    "---",
    [
      ...links.nav.filter((item) => navDefaults.some((entry) => entry.id === item.id && entry.visible)),
      links.github,
      ...links.secondary,
      links.status,
    ]
      .map((item) => `- ${link(item.label, item.href)}`)
      .join("\n"),
    `© ${new Date().getFullYear()} ${link("Anomaly", "https://anoma.ly")}`,
  )
}
