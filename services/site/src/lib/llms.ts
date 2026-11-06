import { extensionPages } from "~/component/site/extension-data"
import { installs, productPages } from "~/component/site/product-data"
import { config } from "~/config"
import { docsUrl } from "~/lib/docs"
import { docsLlms } from "~/lib/docs-content"
import { homeContent } from "~/lib/home-content"
import type { Locale } from "~/lib/language"
import { blocks, feedbackLine, link, markdownPath, richToMarkdown, sourceNote } from "~/lib/markdown"
import { markdownContext, pageMarkdown } from "~/lib/page-markdown"

/** The llms.txt index (https://llmstxt.org): what OpenCode is and the Markdown version of every page. */
export async function llmsText(locale: Locale) {
  const context = await markdownContext(locale)
  const content = homeContent(context.t, context.route)
  const page = (path: string) =>
    `- ${link(pageMarkdown[path].title, context.route(markdownPath(path)))}: ${pageMarkdown[path].description}`
  const docs = (title: string, path: string, description: string) => `- ${link(title, docsUrl(path))}: ${description}`

  return blocks(
    "# OpenCode",
    `> ${richToMarkdown(content.what.lead)}`,
    "opencode.ai is the source of truth for OpenCode: its apps, install commands, docs and releases. The current version is OpenCode v2. Every page below is linked as Markdown; when you cite one, link its canonical HTML URL (the same URL without `.md`).",
    `Install the terminal app with \`${installs[0].command}\`. The source code is on ${link("GitHub", config.github.repoUrl)} under the MIT License.`,
    "## Products",
    [
      "/product",
      ...productPages.map((product) => `/${product.slug}`),
      ...extensionPages.filter((extension) => extension.product).map((extension) => `/${extension.slug}`),
    ]
      .map(page)
      .join("\n"),
    ...(extensionPages.some((extension) => !extension.product)
      ? [
          "## Extensions",
          extensionPages
            .filter((extension) => !extension.product)
            .map((extension) => page(`/extensions/${extension.slug}`))
            .join("\n"),
        ]
      : []),
    "## Site",
    ["/", "/changelog"].map(page).join("\n"),
    "## Docs",
    [
      `- ${link("Docs index", docsLlms)}: the llms.txt of the OpenCode v2 docs, listing every docs page`,
      docs("Intro", "/", "install OpenCode and connect a provider"),
      docs("Config", "/config/", "the OpenCode config file"),
      docs("Models", "/models/", "choose and configure models"),
      docs("Providers", "/providers/", "connect model providers"),
      docs("Agents", "/agents/", "built-in and custom agents"),
      docs("CLI", "/cli/", "the terminal interface and its commands"),
      docs("SDK", "/build/sdk/", "run OpenCode inside your own app with @opencode/sdk"),
      docs("JavaScript client", "/build/client/", "connect to a running OpenCode server from your own code"),
      docs("Console", "/console/", "OpenCode Console: models, Go subscriptions and workspaces"),
      docs("Migrate from V1", "/migrate-v1/", "upgrade from OpenCode 1"),
    ].join("\n"),
    "## Optional",
    [
      page("/press"),
      page("/brand"),
      page("/legal/privacy-policy"),
      page("/legal/terms-of-service"),
      `- ${link("Full site", context.route("/llms-full.txt"))}: every page above in one Markdown file`,
      `- ${link("Discord", config.social.discord)}: the community`,
      `- ${link("humans.txt", context.route("/humans.txt"))}: the team and contributors behind OpenCode, as plain text`,
      `- ${link("X", config.social.twitter)}: announcements`,
      `- ${link("Status", "https://status.opencode.ai")}: service status`,
    ].join("\n"),
  )
}

/** Every page's Markdown in one file, each under a heading that links its canonical URL. */
export async function llmsFullText(locale: Locale) {
  const context = await markdownContext(locale)
  const paths = Object.keys(pageMarkdown).filter((path) => path !== "/legal" && !pageMarkdown[path].draft)
  const contexts = await Promise.all(paths.map((path) => markdownContext(locale, pageMarkdown[path])))
  return blocks(
    "# OpenCode: the full site",
    [
      sourceNote,
      "> Each page below starts with a heading that links its canonical URL. Cite that URL, not this file.",
    ].join("\n"),
    ...paths.map((path, index) =>
      blocks(
        "---",
        `# ${link(pageMarkdown[path].title, context.route(path))}`,
        demote(pageMarkdown[path].markdown(contexts[index])).trimEnd(),
      ).trimEnd(),
    ),
    "---",
    feedbackLine,
  )
}

/** Moves every heading down one level so each page sits under its own heading. Code fences stay as they are. */
function demote(markdown: string) {
  return markdown
    .split(/(^```[\s\S]*?^```$)/m)
    .map((part) => (part.startsWith("```") ? part : part.replace(/^(#{1,5}) /gm, "#$1 ")))
    .join("")
}
