import { base } from "../config"

export interface DocsNavItem {
  title: string
  slug: string
}

export interface DocsNavGroup {
  title?: string
  items: DocsNavItem[]
}

export interface DocsSection {
  key: "docs" | "cli" | "build" | "api" | "console"
  title: string
  landingSlug: string
  groups: DocsNavGroup[]
}

export const docsSections: DocsSection[] = [
  {
    key: "docs",
    title: "Docs",
    landingSlug: "index",
    groups: [
      {
        items: [
          { title: "Intro", slug: "index" },
          { title: "Config", slug: "config" },
          { title: "Migrate from V1", slug: "migrate-v1" },
          { title: "Troubleshooting", slug: "troubleshooting" },
        ],
      },
      {
        title: "Configure",
        items: [
          { title: "Agents", slug: "agents" },
          { title: "Models", slug: "models" },
          { title: "Skills", slug: "skills" },
          { title: "Themes", slug: "themes" },
          { title: "Commands", slug: "commands" },
          { title: "Plugins", slug: "plugins" },
          { title: "Providers", slug: "providers" },
          { title: "Web search", slug: "websearch" },
          { title: "Network", slug: "network" },
          { title: "Snapshots", slug: "snapshots" },
          { title: "Compaction", slug: "compaction" },
          { title: "Formatters", slug: "formatters" },
          { title: "References", slug: "references" },
          { title: "Attachments", slug: "attachments" },
          { title: "Tools", slug: "tools" },
          { title: "MCP servers", slug: "mcp-servers" },
          { title: "Permissions", slug: "permissions" },
          { title: "Policies", slug: "policies" },
          { title: "Instructions", slug: "instructions" },
          { title: "Warming", slug: "warming" },
        ],
      },
    ],
  },
  {
    key: "cli",
    title: "CLI",
    landingSlug: "cli",
    groups: [
      {
        items: [
          { title: "Intro", slug: "cli" },
          { title: "TUI", slug: "cli/tui" },
          { title: "Settings", slug: "cli/config" },
          { title: "Web", slug: "cli/web" },
          { title: "Providers", slug: "cli/providers" },
          { title: "Commands", slug: "cli/commands" },
          { title: "ACP", slug: "cli/acp" },
          { title: "Theme", slug: "cli/theme" },
          { title: "Plugins", slug: "cli/plugins" },
          { title: "Keybinds", slug: "cli/keybinds" },
        ],
      },
    ],
  },
  {
    key: "build",
    title: "Build",
    landingSlug: "build",
    groups: [
      {
        items: [{ title: "Intro", slug: "build" }],
      },
      {
        title: "Plugins",
        items: [
          { title: "Overview", slug: "build/plugins" },
          { title: "Server", slug: "build/plugins/server" },
          { title: "TUI", slug: "build/plugins/cli" },
          { title: "GUI", slug: "build/plugins/gui" },
          { title: "RPC", slug: "build/plugins/rpc" },
          { title: "Migrate from V1", slug: "build/plugins/migrate-v1" },
        ],
      },
      {
        title: "Client",
        items: [{ title: "JavaScript", slug: "build/client" }],
      },
      {
        title: "SDK",
        items: [
          { title: "Overview", slug: "build/sdk" },
          { title: "Cloudflare", slug: "build/sdk/cloudflare" },
        ],
      },
      {
        title: "Effect",
        items: [
          { title: "Plugins", slug: "build/plugins/effect" },
          { title: "RPC", slug: "build/plugins/effect/rpc" },
          { title: "Client", slug: "build/client/effect" },
          { title: "SDK", slug: "build/sdk/effect" },
        ],
      },
    ],
  },
  {
    key: "api",
    title: "API",
    landingSlug: "api",
    groups: [
      {
        title: "API",
        items: [{ title: "Overview", slug: "api" }],
      },
    ],
  },
  {
    key: "console",
    title: "Console",
    landingSlug: "console",
    groups: [
      {
        items: [
          { title: "Intro", slug: "console" },
          { title: "Models", slug: "console/models" },
          { title: "Providers", slug: "console/providers" },
          { title: "Web search", slug: "console/websearch" },
          { title: "Go", slug: "console/go" },
        ],
      },
      {
        title: "Workspace",
        items: [
          { title: "Basics", slug: "console/workspaces" },
          { title: "Members", slug: "console/members" },
          { title: "SSO", slug: "console/sso" },
          { title: "SCIM", slug: "console/scim" },
          { title: "Budgets", slug: "console/budgets" },
          { title: "Billing", slug: "console/billing" },
        ],
      },
      {
        title: "API",
        items: [
          { title: "Overview", slug: "console/api" },
          { title: "Inference", slug: "console/api/inference" },
          { title: "Providers", slug: "console/api/providers" },
        ],
      },
      {
        title: "Harnesses",
        items: [
          { title: "Overview", slug: "console/harnesses" },
          { title: "Claude Code", slug: "console/harnesses/claude-code" },
          { title: "Codex", slug: "console/harnesses/codex" },
          { title: "Hermes", slug: "console/harnesses/hermes" },
          { title: "Pi", slug: "console/harnesses/pi" },
          { title: "Raycast", slug: "console/harnesses/raycast" },
        ],
      },
    ],
  },
]

// Pages whose URL has no trailing slash. The slash form redirects to them (middleware.ts).
const assetSlugs = new Set(["api"])

export function docsHref(slug: string, anchor?: string) {
  const path = slug === "index" ? "" : `${slug.replace(/\/index$/, "")}${assetSlugs.has(slug) ? "" : "/"}`
  return `${base}${path}${anchor ? `#${anchor}` : ""}`
}

/**
 * The Markdown twin of a docs page: its URL without the trailing slash, plus `.md`. The intro's is
 * `/docs/index.md`, so it stays under the docs' prefix (middleware.ts also answers `/docs.md`).
 */
export function docsMarkdownHref(slug: string) {
  return slug === "index" ? `${base}index.md` : `${docsHref(slug).replace(/\/$/, "")}.md`
}

/** A content file's slug: its path under content/ without `.mdx` or a trailing `/index`. */
export function docsSlug(file: string) {
  const slug = file.replace(/\.mdx$/, "")
  return slug === "index" ? slug : slug.replace(/\/index$/, "")
}

export function getDocsSection(slug: string) {
  return (
    docsSections.find((section) => section.groups.some((group) => group.items.some((item) => item.slug === slug))) ??
    docsSections[0]
  )
}
