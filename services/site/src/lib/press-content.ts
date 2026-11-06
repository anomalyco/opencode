import { productDetails, products, type ProductSlug } from "~/component/site/product-data"
import { config } from "~/config"
import type { Translate } from "~/i18n"
import { brandAssets } from "~/lib/media"
import { pressEmail } from "~/lib/contact"
import type { ChangelogRelease } from "~/lib/changelog"
import pressMedia from "../../public/press-media/manifest.json"
import { blocks, link, richToMarkdown, type MarkdownContext } from "~/lib/markdown"
import { rich } from "~/i18n/rich"
import { mediaUrl } from "~/lib/media"

/** The press kit copy, shared by the page and its Markdown version. `route` localizes a site path. */
export function pressContent(t: Translate, route: (path: string) => string) {
  return {
    title: "OpenCode | Press kit with company facts and brand assets",
    description:
      "The OpenCode press kit, with facts about OpenCode and Anomaly, the company behind it, plus logos and wordmarks to download and a contact for press questions.",
    hero: { title: "Press", body: "Facts, brand assets and contacts for writing about OpenCode and Anomaly." },
    company: {
      title: "About Anomaly",
      lead: "Anomaly is the company behind OpenCode. It builds open source tools for developers.",
      more: "Other projects include SST and OpenTUI, all open source on [GitHub](github).",
      // Facts checked on 2026-11-02 against each project's site, README and the GitHub API
      // (gh api repos/anomalyco/<repo>): stars, MIT licence and repo creation date. Star counts
      // are rounded down. Models.dev counts come from https://models.dev/api.json (8,938 models,
      // 235 providers, written as 200+ like the rest of the site). Each description is tuned to wrap to exactly three lines at 1280 and 1440
      // wide (378 and 330px columns); re-measure after changing the copy.
      projects: [
        {
          name: "OpenCode",
          body: "The open source coding agent, with apps for desktop, mobile and the terminal, and an SDK. MIT licensed, 220,000+ GitHub stars.",
          href: "https://opencode.ai",
        },
        {
          name: "SST",
          body: "A framework to build full-stack apps on your own infrastructure. MIT licensed, open since 2020, with over 26,000 GitHub stars.",
          href: "https://sst.dev",
        },
        {
          name: "OpenTUI",
          body: "A library for terminal UIs in TypeScript, React or Solid, with a core in Zig. OpenCode uses it in production. Over 13,000 GitHub stars.",
          href: "https://opentui.com",
        },
        {
          name: "Models.dev",
          body: "An open source database of AI model specs, pricing and capabilities, with a public API. It lists 8,900+ models from 200+ providers.",
          href: "https://models.dev",
        },
        {
          name: "Hex",
          body: "Voice dictation for Mac, Windows and Linux. Hex transcribes on your device and pastes into any app, so audio never leaves it.",
          href: "https://anoma.ly/hex",
        },
        {
          name: "OpenTunnel",
          body: "A CLI and SDK that give apps on your machine a public HTTPS URL. TLS ends on your machine, so the relay never sees plaintext.",
          href: "https://opentunnel.xyz",
        },
      ],
      learnMore: "To learn more, go to [anoma.ly](site).",
      links: { github: "https://github.com/anomalyco", site: "https://anoma.ly" },
    },
    about: {
      title: "About OpenCode",
      // Both versions name the products in the site's order (products in product-data.ts): desktop,
      // mobile, terminal, SDK.
      boilerplate: {
        long: `OpenCode is an open source coding agent. It comes as a desktop app, a mobile app, a terminal UI and an SDK, and it works with models from any provider, including Claude, GPT and Gemini. OpenCode is MIT licensed and made by Anomaly. It has over ${config.github.starsFormatted.full} GitHub stars and more than ${config.stats.contributors.replace("+", "")} contributors, and over ${config.stats.monthlyUsers.replace("M", " million")} developers use it every month.`,
        short:
          "OpenCode is an open source coding agent by Anomaly, with apps for desktop, mobile and the terminal, and an SDK.",
      },
      // More products, checked on 2026-11-04 against the live opencode.ai/console, /console/go and /data pages,
      // the Console docs (/docs/go, /docs/zen and the Console section's SSO, SCIM and Budgets pages)
      // and the go.* strings in i18n/en.ts. No colons, per the site's copy rules.
      products: [
        {
          name: "OpenCode Console",
          long: "OpenCode Console is the web app where developers and teams buy and manage AI model access for OpenCode and other coding agents. It offers pay-as-you-go inference for frontier and open-weight models, charged per request from prepaid credits, and OpenCode Go subscriptions. Teams get workspaces with Member, Admin and Owner roles, workspace and per-user spending limits, single sign-on with Okta, Microsoft Entra ID or Google Workspace, and SCIM. Console supports more than 30 providers, so teams can connect provider accounts they already have, and its own inference is optional. It is at opencode.ai/console.",
          short:
            "OpenCode Console is Anomaly's web app for pay-as-you-go AI model access, OpenCode Go subscriptions and team controls such as budgets and single sign-on.",
        },
        {
          name: "OpenCode Go",
          long: "OpenCode Go is a subscription for developers who want a fixed monthly price for coding models. Go costs $10/month, Go Plus costs $40/month with higher limits, and Go Teams costs $20/month per member. Each plan includes a curated set of models tested for agentic coding. Usage limits are monthly dollar amounts for each model, with rolling 5-hour and weekly allowances of 20% and 50% of the monthly limit. Subscribers can top up credit, fall back to a pay-as-you-go balance and cancel any time. Go works with OpenCode and other agents. It is at opencode.ai/console/go.",
          short:
            "OpenCode Go is a monthly subscription from Anomaly that gives developers monthly usage limits on a curated set of coding models, from $10/month.",
        },
        {
          name: "OpenCode Data",
          long: "OpenCode Data is a public dashboard that shows which AI models developers use in OpenCode and how that mix changes over time. It publishes a leaderboard of top models, token usage, session and token costs, cache ratios, market share and a breakdown by country. The figures are aggregated every hour, with days and weeks in UTC. User and session counts are approximate, and costs use list prices from the OpenCode model catalog. Journalists can cite it as OpenCode Data (opencode.ai/data) with the update time shown on the page.",
          short:
            "OpenCode Data is a public dashboard at opencode.ai/data that ranks AI models by real usage in OpenCode, with tokens, costs and market share updated hourly.",
        },
      ],
    },
    facts: {
      title: "At a glance",
      // Stars match the GitHub API on 2026-11-02 (223,909). Contributors and monthly developers come
      // from the site config (config.stats), the same numbers as the home page. License: LICENSE (MIT).
      // First release: the v0.0.1 tag, 2025-04-21.
      items: [
        { label: t("home.growth.githubStars"), value: config.github.starsFormatted.compact },
        { label: t("home.growth.contributors"), value: config.stats.contributorsCompact },
        { label: t("home.growth.monthlyDevs"), value: config.stats.monthlyUsers },
        { label: "License", value: "MIT" },
        { label: "First release", value: "2025" },
        { label: "Made by", value: "Anomaly" },
      ],
    },
    milestones: {
      title: "Milestones",
      // Sources: the v0.0.1 and v2.0.0 git tags; STATS.md (1,005,287 GitHub and npm downloads on
      // 2025-10-19, 10,190,453 on 2026-01-29); the v1.0.0 GitHub release (2025-10-31); the v1.0.147
      // GitHub release (2025-12-11), the first with a desktop installer (OpenCode_1.0.146_aarch64.dmg);
      // and the GitHub API star count on 2026-11-02. Each line fits on one line at 1280 and 1440 wide.
      items: [
        { date: "Apr 2025", text: "First release, v0.0.1" },
        { date: "Oct 2025", text: "1 million+ downloads" },
        { date: "Oct 2025", text: "OpenCode 1.0" },
        { date: "Dec 2025", text: "Desktop app ships" },
        { date: "Jan 2026", text: "10 million+ downloads" },
        { date: "Sep 2026", text: "OpenCode 2.0" },
        { date: "Nov 2026", text: `${config.github.starsFormatted.full}+ GitHub stars` },
      ],
    },
    news: {
      title: "Latest releases",
      intro: "OpenCode ships often. These are the newest releases with new features.",
      changelog: { text: "Full changelog", href: route("/changelog") },
      feed: { text: "RSS feed", href: "/changelog.xml" },
    },
    media: {
      title: "Media",
      intro:
        "Stills and short videos of each app, recorded from the real product. You can use them to write about OpenCode.",
      note: "All captures use the dark theme. Stills and posters are JPGs up to 1920 × 1080, or 1080 × 1350 in portrait. Videos are MP4 clips with no sound.",
      products: products.map((product) => ({
        name: product.name,
        slug: product.slug,
        zip: {
          href: mediaUrl(`/press-media/zips/opencode-${product.slug}-media.zip`),
          size: megabytes(pressMedia[product.slug].zipBytes),
        },
        items: mediaItems(product.slug, product.name),
      })),
    },
    people: {
      title: "People",
      // TODO(press): no names, roles, bios or photos are confirmed. Add 2–4 founders or leaders as
      // { name, role, bio (two lines), photo (square, at least 2,000 px), href? }, and a zip of the
      // photos plus bios.md as photosZip. The section stays hidden while the list is empty.
      items: [] as { name: string; role: string; bio: string; photo?: string; href?: string }[],
      photosZip: undefined as string | undefined,
    },
    anomalyLogo: {
      title: "Anomaly logo",
      body: "The Anomaly mark and wordmark, in black and white. PNGs are 2048 px wide.",
      // David's SVGs (public/press/anomaly), with white copies and 2048 px PNGs made by rsvg-convert.
      assets: (["mark", "wordmark"] as const).flatMap((kind) =>
        (["black", "white"] as const).map((color) => {
          const file = `anomaly-${kind}${color === "white" ? "-white" : ""}`
          return {
            kind,
            color,
            name: `${kind === "mark" ? "Mark" : "Wordmark"}, ${color}`,
            file,
            svg: `/press/anomaly/${file}.svg`,
            png: `/press/anomaly/${file}.png`,
            width: kind === "mark" ? 720 : 1639,
            height: kind === "mark" ? 720 : 719,
          }
        }),
      ),
      all: { text: "Download all", href: mediaUrl("/press/anomaly/anomaly-logo.zip"), size: "0.3 MB" },
    },
    coverage: {
      title: "Coverage",
      // TODO(press): no press coverage links exist in the repo. Add real articles, podcasts and talks
      // as { outlet, title, href, date (YYYY-MM-DD), type }. The section stays hidden while empty.
      items: [] as {
        outlet: string
        title: string
        href: string
        date: string
        type: "Article" | "Podcast" | "Talk"
      }[],
    },
    brand: {
      title: "Brand",
      before:
        "Download the OpenCode logos and wordmarks in one ZIP file. For individual files, variants and usage rules, go to the ",
      link: { text: "Brand page", href: route("/brand") },
      after: ".",
      usage:
        "You can use these files to write about OpenCode. Do not change them, and do not suggest that OpenCode endorses your work.",
      all: { text: t("brand.downloadAll"), href: brandAssets },
    },
    product: {
      title: "Product",
      items: products.map((product) => ({
        name: product.name,
        href: route(`/${product.slug}`),
        body: productPress[product.slug],
      })),
    },
    contact: {
      title: "Contact",
      // Addresses already published elsewhere: pressEmail (lib/contact.ts), SECURITY.md (advisories,
      // then security@anoma.ly after 6 business days) and the terms and billing pages (help@anoma.ly).
      items: [
        {
          title: "Press",
          body: "For journalists and analysts. We reply to media requests only.",
          links: [{ text: pressEmail, href: `mailto:${pressEmail}` }],
        },
        {
          title: "Support",
          body: "For help with OpenCode, open an issue or ask the community. For account and billing questions, email us.",
          links: [
            { text: "GitHub issues", href: `${config.github.repoUrl}/issues` },
            { text: "Discord", href: config.social.discord },
            { text: "help@anoma.ly", href: "mailto:help@anoma.ly" },
          ],
        },
        {
          title: "Security",
          body: "Report a vulnerability through GitHub. If nobody replies in 6 business days, email us.",
          links: [
            { text: "Report a vulnerability", href: `${config.github.repoUrl}/security/advisories/new` },
            { text: "security@anoma.ly", href: "mailto:security@anoma.ly" },
          ],
        },
      ],
    },
  }
}

export type PressMediaItem = {
  id: string
  kind: "image" | "video"
  title: string
  /** The full-size still, or the video's poster. */
  image: string
  video?: string
  thumb: string
  width: number
  height: number
}

/**
 * A product's media, all from the real product: stills (script/press-media.sh picks the frames),
 * then the films and showcase clips with their posters. The films are the "locked" set: real
 * OpenCode UI (and the native iOS app for Mobile) in locked-off shots joined by hard cuts; the
 * showcase clips are the product page's feature clips.
 */
function mediaItems(slug: ProductSlug, name: string): PressMediaItem[] {
  const videos = "/product-videos"
  const thumb = (id: string) => `/press-media/thumbs/${slug}-${id}.jpg`
  const film = (set: "locked", aspect: "landscape" | "portrait", title: string) => ({
    id: `${set}-${aspect}`,
    kind: "video" as const,
    title,
    image: `${videos}/${set}/${slug}-${aspect}.jpg`,
    video: mediaUrl(`${videos}/${set}/${slug}-${aspect}.mp4`),
    thumb: thumb(`${set}-${aspect}`),
    width: aspect === "landscape" ? 1920 : 1080,
    height: aspect === "landscape" ? 1080 : 1350,
  })
  return [
    film("locked", "landscape", `${name} film`),
    ...pressMedia[slug].frames.map((_, index) => ({
      id: `frame-${index + 1}`,
      kind: "image" as const,
      title: `${name} still ${index + 1}`,
      image: `/press-media/frames/${slug}-frame-${index + 1}.jpg`,
      thumb: thumb(`frame-${index + 1}`),
      width: 1920,
      height: 1080,
    })),
    ...productDetails[slug].showcase.slice(0, 3).map((clip, index) => ({
      id: `feature-${index + 1}`,
      kind: "video" as const,
      title: clip.title,
      image: `${videos}/features/${slug}-${index + 1}.jpg`,
      video: mediaUrl(`${videos}/features/${slug}-${index + 1}.mp4`),
      thumb: thumb(`feature-${index + 1}`),
      width: 1600,
      height: 1000,
    })),
    film("locked", "portrait", `${name} film, portrait`),
  ]
}

function megabytes(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`
}

/** The newest releases that add features, each with its feature titles. */
export function pressReleases(releases: ChangelogRelease[], route: (path: string) => string, locale = "en-US") {
  return releases
    .filter((release) => release.notes.features.length > 0)
    .slice(0, 5)
    .map((release) => ({
      tag: release.tag,
      href: route(`/changelog/${release.tag}`),
      // Dates on this page: "Oct 30, 2026" for days and "Oct 2026" for months (the milestones).
      date: new Date(release.date).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
      features: release.notes.features.map((feature) => feature.title),
    }))
}

// Longer than the carousel copy in product-data.ts, and tuned to wrap to exactly three lines at
// 1280 and 1440 wide (378 and 330px columns); re-measure after changing it. Sources: productDetails in product-data.ts
// (desktop tabs, diffs and built-in browser; mobile voice calls and approvals; terminal shells,
// remote servers and permissions; SDK typed client, sessions, prompts and event stream).
const productPress: Record<ProductSlug, string> = {
  desktop:
    "Run several agents at once, each in its own tab, on macOS, Windows and Linux. Review every change as a diff and preview it.",
  mobile:
    "The newest OpenCode app. Call a session to talk to the agent, then review and approve its changes from your phone, anywhere.",
  terminal:
    "A terminal UI that works in any shell, editor or remote server. See each edit as a diff and choose which commands run on their own.",
  sdk: "A typed TypeScript client for scripts, CI jobs and your own tools. Create sessions, send prompts and stream every event as it lands.",
}

/** The press kit as Markdown: every section, whatever the page's Settings show. */
export function pressMarkdown(context: MarkdownContext) {
  const content = pressContent(context.t, context.route)
  const company = content.company
  const releases = pressReleases(context.releases ?? [], context.route)
  return blocks(
    `# ${content.hero.title}`,
    content.hero.body,
    `## ${content.about.title}`,
    ...[{ name: "OpenCode", ...content.about.boilerplate }, ...content.about.products].flatMap((product) => [
      `### ${product.name}`,
      "#### Long version",
      product.long,
      "#### Short version",
      product.short,
    ]),
    `## ${content.facts.title}`,
    content.facts.items.map((fact) => `- ${fact.label}: ${fact.value}`).join("\n"),
    `## ${content.milestones.title}`,
    content.milestones.items.map((item) => `- ${item.date}: ${item.text}`).join("\n"),
    `## ${content.product.title}`,
    content.product.items.map((product) => `- **${link(product.name, product.href)}:** ${product.body}`).join("\n"),
    `## ${content.news.title}`,
    content.news.intro,
    releases.length > 0 &&
      releases
        .map(
          (release) =>
            `- ${release.date}, ${link(release.tag, release.href)}: **${release.features[0]}**${release.features
              .slice(1)
              .map((feature) => ` · ${feature}`)
              .join("")}`,
        )
        .join("\n"),
    `${link(content.news.changelog.text, content.news.changelog.href)} · ${link(content.news.feed.text, content.news.feed.href)}`,
    `## ${content.media.title}`,
    content.media.intro,
    content.media.note,
    content.media.products
      .map(
        (product) =>
          `- **${product.name}** (${link(`all ${product.name} media`, product.zip.href)}, ${product.zip.size}): ${product.items
            .map((item) => `${link(item.title, item.video ?? item.image)}`)
            .join(", ")}`,
      )
      .join("\n"),
    `## ${content.brand.title}`,
    `${content.brand.before}${link(content.brand.link.text, content.brand.link.href)}${content.brand.after}`,
    content.brand.usage,
    link(content.brand.all.text, content.brand.all.href),
    content.people.items.length > 0 && `## ${content.people.title}`,
    content.people.items.length > 0 &&
      content.people.items.map((person) => `- **${person.name}**, ${person.role}. ${person.bio}`).join("\n"),
    `## ${company.title}`,
    company.lead,
    richToMarkdown(rich(company.more, company.links)),
    company.projects.map((project) => `- **${link(project.name, project.href)}:** ${project.body}`).join("\n"),
    richToMarkdown(rich(company.learnMore, company.links)),
    `## ${content.anomalyLogo.title}`,
    content.anomalyLogo.body,
    content.anomalyLogo.assets
      .map((asset) => `- ${asset.name}: ${link("SVG", asset.svg)}, ${link("PNG", asset.png)}`)
      .join("\n"),
    `${link(content.anomalyLogo.all.text, content.anomalyLogo.all.href)} (${content.anomalyLogo.all.size})`,
    content.coverage.items.length > 0 && `## ${content.coverage.title}`,
    content.coverage.items.length > 0 &&
      content.coverage.items.map((item) => `- ${item.outlet}, ${link(item.title, item.href)}, ${item.date}`).join("\n"),
    `## ${content.contact.title}`,
    ...content.contact.items.flatMap((item) => [
      `### ${item.title}`,
      `${item.body}\n\n${item.links.map((entry) => link(entry.text, entry.href)).join(" · ")}`,
    ]),
  )
}
