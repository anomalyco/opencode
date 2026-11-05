import {
  acpDocs,
  androidSoon,
  extensions,
  installs,
  mobileStores,
  sdkDocs,
  type PageSlug,
} from "~/component/site/product-data"
import type { Translate } from "~/i18n"
import { v1DocsUrl } from "~/lib/docs"
import { desktopBuilds, desktopInstall, getDownloadHref } from "~/lib/download"
import { homeContent } from "~/lib/home-content"
import { sdkInstalls } from "~/lib/install-commands"
import { blocks, codeFence, link, richToMarkdown, type MarkdownContext } from "~/lib/markdown"

/** The download lists' copy (product pages and /product), for the pages and their Markdown. `route` localizes a site path. */
export function downloadContent(t: Translate, route: (path: string) => string) {
  return {
    title: t("download.title"),
    // Only the English description names Android; the translations name no phones yet.
    description:
      androidSoon && /android/i.test(t("download.meta.description"))
        ? t("download.meta.descriptionAndroidSoon")
        : t("download.meta.description"),
    desktop: {
      title: "Desktop",
      builds: desktopBuilds.map((build) => ({
        id: build.id,
        platform: build.platform,
        label: t(build.label),
        href: route(getDownloadHref(build.id)),
      })),
      install: desktopInstall,
    },
    mobile: {
      title: "Mobile",
      stores: mobileStores.map((store) => ({
        ...store,
        href: store.href.startsWith("/") ? route(store.href) : store.href,
      })),
    },
    terminal: { title: "Terminal", installs },
    extensions: {
      title: "Extensions",
      items: ["VS Code", "Cursor", "Zed", "Windsurf", "VSCodium"].map((label) => ({
        label,
        href: v1DocsUrl("/ide/"),
      })),
    },
    integrations: {
      title: "Integrations",
      items: [
        // One line each, from the GitHub and GitLab docs.
        {
          id: "github",
          label: "GitHub",
          body: "Use OpenCode in GitHub Actions.",
          href: v1DocsUrl("/github/"),
        },
        {
          id: "gitlab",
          label: "GitLab",
          body: "Use OpenCode in GitLab CI/CD or Duo.",
          href: v1DocsUrl("/gitlab/"),
        },
      ],
    },
    actions: { download: t("download.action.download"), install: t("download.action.install") },
    faq: homeContent(t, route).faq,
  }
}

/**
 * The download sections. `apps: false` leaves out Desktop, Mobile and
 * Terminal, as at the bottom of /product.
 */
export function downloadSectionsMarkdown(
  context: MarkdownContext,
  options?: { apps?: boolean; editors?: boolean; beforeFaq?: string },
) {
  const content = downloadContent(context.t, context.route)
  return blocks(
    options?.apps !== false && downloadAppsMarkdown(context),
    options?.editors !== false && `## ${content.extensions.title}`,
    options?.editors !== false && content.extensions.items.map((item) => `- ${link(item.label, item.href)}`).join("\n"),
    `## ${content.integrations.title}`,
    content.integrations.items.map((item) => `- ${link(item.label, item.href)}: ${item.body}`).join("\n"),
    options?.beforeFaq,
    `## ${content.faq.title}`,
    ...content.faq.items.map((item) => blocks(`### ${item.question}`, richToMarkdown(item.answer)).trimEnd()),
  )
}

/**
 * What a product page's Download section shows beyond the shared lists (desktop builds, mobile
 * stores): its lead, commands to copy, links and a docs link. Shared by the page and its Markdown.
 */
export function productDownloads(slug: PageSlug, route: (path: string) => string) {
  const none = { lead: undefined, commandsLead: undefined, commands: [], links: [], more: undefined }
  const result: {
    lead?: string
    /** A line above the commands, when something else comes between them and the lead. */
    commandsLead?: string
    commands: readonly { id: string; command: string }[]
    links: readonly { label: string; href: string; external?: boolean }[]
    more?: { label: string; href: string }
  } =
    slug === "mobile"
      ? {
          ...none,
        }
      : slug === "terminal"
        ? { ...none, commands: installs }
        : slug === "sdk"
          ? { ...none, commands: sdkInstalls, more: { label: "Read the SDK docs", href: route(sdkDocs) } }
          : slug === "ide"
            ? {
                ...none,
                lead: "Run opencode in your editor's integrated terminal and the extension installs itself, or install it yourself.",
                links: [
                  { label: "VS Code Marketplace", href: extensions.href, external: true },
                  {
                    label: "Open VSX (Cursor, Windsurf, VSCodium)",
                    href: "https://open-vsx.org/extension/sst-dev/opencode",
                    external: true,
                  },
                ],
                more: { label: "Set up Zed, JetBrains IDEs and other ACP editors", href: route(acpDocs) },
              }
            : slug === "mini"
              ? {
                  ...none,
                  lead: "Mini comes with the OpenCode CLI. Install it with any of these, then run opencode mini.",
                  commands: [...installs, { id: "run", command: "opencode mini" }],
                }
              : none
  return result
}

/** A product page's Download section as Markdown. */
export function productDownloadMarkdown(slug: PageSlug, context: MarkdownContext) {
  const content = downloadContent(context.t, context.route)
  const details = productDownloads(slug, context.route)
  return blocks(
    "## Download",
    details.lead,
    slug === "desktop" &&
      blocks(
        content.desktop.builds.map((build) => `- ${link(build.label, build.href)}`).join("\n"),
        codeFence("bash", content.desktop.install.command),
      ).trimEnd(),
    slug === "mobile" && content.mobile.stores.map((store) => `- ${storeMarkdown(store)}`).join("\n"),
    slug === "mobile" && pairMarkdown(),
    details.links.length > 0 && details.links.map((item) => `- ${link(item.label, item.href)}`).join("\n"),
    details.commandsLead,
    details.commands.length > 0 &&
      codeFence("bash", details.commands.map((item) => `# ${item.id}\n${item.command}`).join("\n\n")),
    details.more && link(details.more.label, details.more.href),
  ).trimEnd()
}

/** A store as Markdown: its link and device, or, while it is coming soon, its name with no link. */
export function storeMarkdown(store: { label: string; device: string; href: string; soon: boolean; beta: boolean }) {
  if (store.soon) return `${store.label} (${store.device}, coming soon)`
  if (store.beta) return `${link(store.label, store.href)} (${store.device}, public beta)`
  return `${link(store.label, store.href)} (${store.device})`
}

/** The Desktop, Mobile and Terminal download sections. */
function downloadAppsMarkdown(context: MarkdownContext) {
  const content = downloadContent(context.t, context.route)
  return blocks(
    `## ${content.desktop.title}`,
    content.desktop.builds.map((build) => `- ${link(build.label, build.href)}`).join("\n"),
    codeFence("bash", content.desktop.install.command),
    `## ${content.mobile.title}`,
    content.mobile.stores.map((store) => `- ${storeMarkdown(store)}`).join("\n"),
    `## ${content.terminal.title}`,
    codeFence("bash", content.terminal.installs.map((item) => `# ${item.id}\n${item.command}`).join("\n\n")),
  ).trimEnd()
}

/**
 * Pairing a phone with OpenCode on a computer, for the Mobile page (pair-panel.tsx) and its Markdown.
 * From `opencode pair` (packages/cli/src/commands/handlers/pair.ts: one-time links that expire in 5
 * minutes, and a QR code of the reachable addresses; --remote pairs through the OpenTunnel address,
 * turning remote access on if needed) and the iOS app (scan the code or paste the link; Pair From
 * Anywhere; after pairing, the computer's recent sessions open).
 */
export function pairContent() {
  const command = "opencode pair --remote"
  return {
    title: "Connect your phone",
    cardTitle: "Pair your phone with one command",
    intro:
      "OpenCode Mobile is a remote for OpenCode on your computer. Your sessions keep running there; the app shows them and lets you steer them.",
    command,
    steps: [
      {
        title: "Get the app",
        body: androidSoon
          ? "Install the OpenCode beta on your iPhone from TestFlight. The Android app is coming soon."
          : "Install the OpenCode beta on your iPhone from TestFlight, or the app on your Android phone.",
      },
      {
        title: "Run this on your computer",
        body: "It prints a one-time link and a QR code. They work once and expire in 5 minutes.",
        command,
      },
      {
        title: "Scan the code",
        body: "Scan the QR code with the app, or paste the link. Your computer's recent sessions open on your phone.",
      },
    ],
    note: "--remote connects through an OpenTunnel address, so it works from any network. On the same Wi-Fi, run opencode service set hostname 0.0.0.0 once, then opencode pair.",
    facts: [
      "Pairing works from any network, because --remote connects through an OpenTunnel address.",
      "The link and code work once and expire in 5 minutes.",
      "Keep the computer on, because the agent runs there and not on the phone.",
      "On the same Wi-Fi, run opencode service set hostname 0.0.0.0 once, then opencode pair.",
    ],
  }
}

/** "Connect your phone" as Markdown. */
function pairMarkdown() {
  const pair = pairContent()
  return blocks(
    `### ${pair.title}`,
    pair.intro,
    pair.steps
      .map(
        (step, index) =>
          `${index + 1}. **${step.title}:** ${step.body}${step.command ? ` Run \`${step.command}\`.` : ""}`,
      )
      .join("\n"),
    pair.note,
  ).trimEnd()
}
