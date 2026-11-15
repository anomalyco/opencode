import { config } from "~/config"
import { docsUrl, v1DocsUrl } from "~/lib/docs"
import { docsInstalls } from "~/lib/install-commands"
import { blocks, codeFence, link, richToMarkdown, type RichText } from "~/lib/markdown"

// The docs mock in the new site layout, shared by the page and its Markdown version. Content mirrors
// https://opencode.ai/docs/ (the Intro page).

export const docsProducts = [
  { label: "Docs", href: docsUrl() },
  { label: "CLI", href: docsUrl("/cli") },
  { label: "Build", href: docsUrl("/build") },
  { label: "API", href: docsUrl("/api") },
  { label: "Console", href: docsUrl("/console") },
  { label: "V1", href: v1DocsUrl() },
]

export const docsPages = [
  { label: "Intro", href: docsUrl() },
  { label: "Config", href: docsUrl("/config") },
  { label: "V1 migration", href: docsUrl("/migrate-v1") },
  { label: "Troubleshoot", href: docsUrl("/troubleshooting") },
]

export const docsConfigure = [
  "Agents",
  "Models",
  "Skills",
  "Themes",
  "Commands",
  "Plugins",
  "Providers",
  "Web search",
  "Network",
  "Snapshots",
  "Compaction",
  "Formatters",
  "References",
  "Attachments",
  "Tools",
  "MCP servers",
  "Permissions",
  "Policies",
  "Instructions",
  "Warming",
  // The live docs' slugs: hyphenated labels, except Web search, which is /websearch.
].map((label) => ({
  label,
  href: docsUrl(`/${label === "Web search" ? "websearch" : label.toLowerCase().replaceAll(" ", "-")}`),
}))

export { docsInstalls }

const update = "https://opencode.ai/update/api/latest"

export type DownloadGroup = { platform: string; links: string[][] }

export const cliDownloads: DownloadGroup[] = [
  {
    platform: "macOS",
    links: [
      ["Apple silicon", `${update}/cli/opencode/opencode-darwin-arm64.zip`],
      ["Intel", `${update}/cli/opencode/opencode-darwin-x64.zip`],
      ["Intel (baseline)", `${update}/cli/opencode/opencode-darwin-x64-baseline.zip`],
    ],
  },
  {
    platform: "Windows",
    links: [
      ["ARM64", `${update}/cli/opencode/opencode-windows-arm64.zip`],
      ["x64", `${update}/cli/opencode/opencode-windows-x64.zip`],
      ["x64 (baseline)", `${update}/cli/opencode/opencode-windows-x64-baseline.zip`],
    ],
  },
  {
    platform: "Linux (glibc)",
    links: [
      ["ARM64", `${update}/cli/opencode/opencode-linux-arm64.tar.gz`],
      ["x64", `${update}/cli/opencode/opencode-linux-x64.tar.gz`],
      ["x64 (baseline)", `${update}/cli/opencode/opencode-linux-x64-baseline.tar.gz`],
    ],
  },
  {
    platform: "Linux (musl)",
    links: [
      ["ARM64", `${update}/cli/opencode/opencode-linux-arm64-musl.tar.gz`],
      ["x64", `${update}/cli/opencode/opencode-linux-x64-musl.tar.gz`],
      ["x64 (baseline)", `${update}/cli/opencode/opencode-linux-x64-baseline-musl.tar.gz`],
    ],
  },
]

export const desktopDownloads: DownloadGroup[] = [
  {
    platform: "macOS",
    links: [
      ["Apple silicon", `${update}/desktop/opencode/opencode-desktop-mac-arm64.dmg`],
      ["Intel", `${update}/desktop/opencode/opencode-desktop-mac-x64.dmg`],
    ],
  },
  {
    platform: "Windows",
    links: [
      ["x64", `${update}/desktop/opencode/opencode-desktop-win-x64.exe`],
      ["ARM64", `${update}/desktop/opencode/opencode-desktop-win-arm64.exe`],
    ],
  },
  {
    platform: "Linux (.deb)",
    links: [
      ["x64", `${update}/desktop/opencode/opencode-desktop-linux-amd64.deb`],
      ["ARM64", `${update}/desktop/opencode/opencode-desktop-linux-arm64.deb`],
    ],
  },
  {
    platform: "Linux (.rpm)",
    links: [
      ["x64", `${update}/desktop/opencode/opencode-desktop-linux-x86_64.rpm`],
      ["ARM64", `${update}/desktop/opencode/opencode-desktop-linux-aarch64.rpm`],
    ],
  },
  {
    platform: "Linux (AppImage)",
    links: [
      ["x64", `${update}/desktop/opencode/opencode-desktop-linux-x86_64.AppImage`],
      ["ARM64", `${update}/desktop/opencode/opencode-desktop-linux-arm64.AppImage`],
    ],
  },
]

export const docsToc = [
  { id: "cli", label: "CLI" },
  { id: "desktop", label: "Desktop" },
  { id: "web", label: "Web" },
  { id: "docker", label: "Docker" },
  { id: "connect", label: "Connect" },
  { id: "customize", label: "Customize" },
  { id: "learn", label: "Learn" },
]

/** The Intro article: its prose, by section. */
export const docsIntro = {
  title: "Intro",
  /** The page's `<title>`, 50–60 characters. */
  metaTitle: "OpenCode | Install OpenCode and connect a provider",
  description:
    "Get started with OpenCode. Install the CLI, desktop app, web or Docker version, connect a model provider, and find your way around the rest of the docs.",
  lead: "OpenCode is an open source coding agent. It's available as a desktop app, a terminal interface, a mobile app and an SDK.",
  cli: [
    [
      "The npm package uses a postinstall script to select the native ",
      { code: "opencode" },
      " binary for your platform. The Bun and pnpm commands explicitly allow the required script; Vite+ requires no additional flag. The mise command requires mise 2026.10.9 or later; older versions install OpenCode 1.",
    ],
    ["Windows package managers are not supported."],
    ["Download a standalone CLI binary for your platform."],
  ] satisfies RichText[],
  desktop: "Download the latest OpenCode Desktop build for your platform.",
  web: {
    lead: ["Access the OpenCode web interface with the ", { code: "opencode pair" }, " command."] satisfies RichText,
    command: "opencode pair",
    output: "  Open a link to connect. Links work once and expire in 5 minutes.",
    url: "http://127.0.0.1:49374/auth/connect/...",
  },
  docker: [
    "Docker images use versioned tags, for example ",
    { code: "ghcr.io/anomalyco/opencode:2.0.0" },
    ".",
  ] satisfies RichText,
  connect: [
    [
      "OpenCode has built-in support for many LLM providers. You can connect to them directly ",
      { text: "in the TUI", href: docsUrl("/cli/providers") },
      " with ",
      { code: "/connect" },
      ".",
    ],
    ["See ", { text: "Providers", href: docsUrl("/providers") }, " to configure custom providers."],
    [
      "If you'd like easy access to the best coding models, you can try out ",
      { text: "OpenCode Console", href: docsUrl("/console") },
      ".",
    ],
    [
      "You can also try ",
      { text: "OpenCode Go", href: docsUrl("/console/go") },
      ", a subscription plan from $10/month that grants you access to the best coding models.",
    ],
  ] satisfies RichText[],
  customize: [
    "Make OpenCode your own by editing the ",
    { text: "OpenCode config", href: docsUrl("/config") },
    ", ",
    { text: "loading plugins", href: docsUrl("/plugins") },
    ", ",
    { text: "connecting MCP servers", href: docsUrl("/mcp-servers") },
    ", or ",
    { text: "creating commands", href: docsUrl("/commands") },
    ". For terminal interface themes and keybindings, see ",
    { text: "CLI settings", href: docsUrl("/cli/config") },
    ".",
  ] satisfies RichText,
  learn: [
    "If you are interested in an in-depth course on OpenCode, Boot.dev has created an excellent ",
    { text: "AI Coding with OpenCode", href: "https://www.boot.dev/courses/learn-ai-coding", external: true },
    " course in consultation with our team. All the information in the course is free to read and watch, though some interactive features may require payment.",
  ] satisfies RichText,
}

/** The docs Intro page as Markdown, with the docs navigation after it. */
export function docsMarkdown() {
  const intro = docsIntro
  const downloads = (groups: DownloadGroup[]) =>
    groups
      .map((group) => `- **${group.platform}:** ${group.links.map((item) => link(item[0], item[1])).join(" · ")}`)
      .join("\n")
  const list = (items: { label: string; href: string }[]) =>
    items.map((item) => `- ${link(item.label, item.href)}`).join("\n")

  return blocks(
    `# ${intro.title}`,
    intro.lead,
    "## CLI",
    codeFence("bash", docsInstalls.map((item) => `# ${item.label}\n${item.code}`).join("\n\n")),
    ...intro.cli.map(richToMarkdown),
    downloads(cliDownloads),
    "## Desktop",
    intro.desktop,
    downloads(desktopDownloads),
    "## Web",
    richToMarkdown(intro.web.lead),
    codeFence("bash", `$ ${intro.web.command}\n\n${intro.web.output}\n\n  ${intro.web.url}`),
    "## Docker",
    richToMarkdown(intro.docker),
    "## Connect",
    ...intro.connect.map(richToMarkdown),
    "## Customize",
    richToMarkdown(intro.customize),
    "## Learn",
    richToMarkdown(intro.learn),
    "---",
    `Docs index for agents: ${link("llms.txt", docsLlms)}. Source: ${link("GitHub", config.github.repoUrl)}`,
    "### Docs",
    list(docsProducts),
    "### Pages",
    list(docsPages),
    "### Configure",
    list(docsConfigure),
  )
}

/** The docs' own llms.txt, which the docs serve under /docs on opencode.ai. */
export const docsLlms = "/docs/llms.txt"
