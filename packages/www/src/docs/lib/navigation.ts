export interface DocsNavItem {
  title: string
  slug: string
}

export interface DocsNavGroup {
  title?: string
  items: DocsNavItem[]
}

export interface DocsSection {
  key: "docs" | "cli" | "build" | "api"
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
        ],
      },
      {
        title: "Configure",
        items: [
          { title: "LSP", slug: "lsp" },
          { title: "Agents", slug: "agents" },
          { title: "Models", slug: "models" },
          { title: "Skills", slug: "skills" },
          { title: "Themes", slug: "themes" },
          { title: "Commands", slug: "commands" },
          { title: "Providers", slug: "providers" },
          { title: "Snapshots", slug: "snapshots" },
          { title: "Compaction", slug: "compaction" },
          { title: "Formatters", slug: "formatters" },
          { title: "References", slug: "references" },
          { title: "Attachments", slug: "attachments" },
          { title: "MCP servers", slug: "mcp-servers" },
          { title: "Permissions", slug: "permissions" },
          { title: "Instructions", slug: "instructions" },
          { title: "Session sharing", slug: "sharing" },
          { title: "Session warming", slug: "warming" },
        ],
      },
      {
        items: [
          { title: "Migrate from V1", slug: "migrate-v1" },
          { title: "Troubleshooting", slug: "troubleshooting" },
        ],
      },
    ],
  },
  {
    key: "cli",
    title: "CLI",
    landingSlug: "cli/index",
    groups: [
      {
        title: "Intro",
        items: [
          { title: "Intro", slug: "cli/index" },
          { title: "Config", slug: "cli/config" },
        ],
      },
      {
        title: "Configure",
        items: [
          { title: "Theme", slug: "cli/theme" },
          { title: "Plugins", slug: "cli/plugins" },
          { title: "Keybinds", slug: "cli/keybinds" },
        ],
      },
      {
        items: [{ title: "Providers", slug: "cli/providers" }],
      },
    ],
  },
  {
    key: "build",
    title: "Build",
    landingSlug: "build/index",
    groups: [
      {
        title: "Build",
        items: [
          { title: "SDK", slug: "build/sdk" },
          { title: "Build", slug: "build/index" },
          { title: "Client", slug: "build/client" },
          { title: "Plugins", slug: "build/plugins" },
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
]

export function docsHref(slug: string, anchor?: string) {
  const path = slug === "index" ? "" : `${slug.replace(/\/index$/, "")}/`
  return `${import.meta.env.BASE_URL}docs/${path}${anchor ? `#${anchor}` : ""}`
}

export function getDocsSection(slug: string) {
  return (
    docsSections.find((section) => section.groups.some((group) => group.items.some((item) => item.slug === slug))) ??
    docsSections[0]
  )
}
