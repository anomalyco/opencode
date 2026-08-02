import type {
  MarketplaceCatalog,
  MarketplaceCatalogItem,
  MarketplaceFetch,
  MarketplaceSkill,
  MarketplaceSource,
} from "./marketplace"

type PluginSource =
  | string
  | { source: "local"; path: string }
  | { source: "github"; repo: string; path?: string; ref?: string; sha?: string }
  | { source: "url" | "git-subdir"; url: string; path?: string; ref?: string; sha?: string }
  | { source: "npm"; package: string; version?: string; registry?: string }

type PluginEntry = {
  name: string
  source: PluginSource
  policy?: { installation: "AVAILABLE" | "INSTALLED_BY_DEFAULT" | "NOT_AVAILABLE"; authentication: string }
  category?: string
  description?: string
  displayName?: string
  version?: string
  author?: string | { name?: string; url?: string }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  skills?: string | string[]
  mcpServers?: string | Record<string, unknown>
  commands?: string | string[]
  agents?: string | string[]
  hooks?: unknown
  lspServers?: unknown
  strict?: boolean
}

type PluginManifest = Omit<PluginEntry, "source" | "policy" | "category" | "strict"> & {
  interface?: {
    displayName?: string
    shortDescription?: string
    longDescription?: string
    developerName?: string
    capabilities?: string[]
    brandColor?: string
    composerIcon?: string
    logo?: string
  }
  apps?: unknown
  extensions?: unknown
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function relative(value: string, label: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "")
  if (normalized === "." || (!normalized && /^\.\/?$/.test(value))) return "./"
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`${label} must be a safe relative path`)
  }
  return `./${normalized}`
}

function relativeList(value: unknown, label: string) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return values.map((item, index) => relative(text(item, `${label}[${index}]`), `${label}[${index}]`))
}

function marketplaceRoot(url: string) {
  const parsed = new URL(url)
  if (
    parsed.pathname.endsWith("/.agents/plugins/marketplace.json") ||
    parsed.pathname.endsWith("/.github/plugin/marketplace.json")
  )
    return new URL("../../", parsed)
  if (
    parsed.pathname.endsWith("/.codex-plugin/marketplace.json") ||
    parsed.pathname.endsWith("/.claude-plugin/marketplace.json") ||
    parsed.pathname.endsWith("/.plugin/marketplace.json")
  )
    return new URL("../", parsed)
  return new URL("./", parsed)
}

function repositoryRoot(repository: URL, revision: string) {
  const pathname = repository.pathname.replace(/\.git$/, "").replace(/^\//, "")
  if (repository.hostname === "github.com") {
    const [owner, name] = pathname.split("/")
    if (!owner || !name) return
    return new URL(`https://raw.githubusercontent.com/${owner}/${name}/${revision}/`)
  }
  if (repository.hostname === "gitlab.com" && pathname.split("/").length >= 2) {
    return new URL(`https://gitlab.com/${pathname}/-/raw/${revision}/`)
  }
}

function pluginRoot(entry: PluginEntry, catalogURL: string): URL | undefined {
  const source = typeof entry.source === "string" ? { source: "local" as const, path: entry.source } : entry.source
  if (source.source === "local") {
    return new URL(
      `${relative(source.path, `plugin ${entry.name} source`).replace(/\/$/, "")}/`,
      marketplaceRoot(catalogURL),
    )
  }
  if (source.source === "npm") {
    if (source.registry && new URL(source.registry).origin !== "https://registry.npmjs.org") return
    return new URL(
      `https://unpkg.com/${source.package
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}@${encodeURIComponent(source.version ?? "latest")}/`,
    )
  }
  const repository = source.source === "github" ? new URL(`https://github.com/${source.repo}.git`) : new URL(source.url)
  const root = repositoryRoot(repository, source.sha ?? source.ref ?? "HEAD")
  if (!root) return
  if (!source.path) return root
  return new URL(`${relative(source.path, `plugin ${entry.name} source`).replace(/\/$/, "")}/`, root)
}

async function json(fetcher: MarketplaceFetch, url: string, source: MarketplaceSource) {
  const response = await fetcher(url, { headers: source.headers, cache: "no-store" })
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`)
  return response.json()
}

async function optionalJson(fetcher: MarketplaceFetch, urls: string[], source: MarketplaceSource) {
  for (const url of urls) {
    const response = await fetcher(url, { headers: source.headers, cache: "no-store" }).catch((error) => {
      if (/HTTP 404\b/.test(String(error))) return undefined
      throw error
    })
    if (!response) continue
    if (response.ok) return response.json()
    if (response.status !== 404) throw new Error(`HTTP ${response.status} while loading ${url}`)
  }
}

function parseSource(value: unknown, index: number): PluginSource {
  const label = `marketplace.plugins[${index}].source`
  if (typeof value === "string") return relative(value, label)
  const source = record(value, label)
  const kind = text(source.source, `${label}.source`)
  if (kind === "local") return { source: "local", path: relative(text(source.path, `${label}.path`), `${label}.path`) }
  if (kind === "github") {
    const repo = text(source.repo, `${label}.repo`)
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "")
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error(`${label}.repo must use owner/repository`)
    return {
      source: "github",
      repo,
      ...(typeof source.path === "string" ? { path: relative(source.path, `${label}.path`) } : {}),
      ...(optionalText(source.ref) ? { ref: optionalText(source.ref) } : {}),
      ...(optionalText(source.sha) ? { sha: optionalText(source.sha) } : {}),
    }
  }
  if (kind === "url" || kind === "git-subdir") {
    return {
      source: kind,
      url: text(source.url, `${label}.url`),
      ...(typeof source.path === "string" ? { path: relative(source.path, `${label}.path`) } : {}),
      ...(optionalText(source.ref) ? { ref: optionalText(source.ref) } : {}),
      ...(optionalText(source.sha) ? { sha: optionalText(source.sha) } : {}),
    }
  }
  if (kind === "npm") {
    const registry = typeof source.registry === "string" ? new URL(source.registry) : undefined
    if (
      registry &&
      (registry.protocol !== "https:" || registry.username || registry.password || registry.search || registry.hash)
    ) {
      throw new Error(`${label}.registry must be a credential-free HTTPS URL`)
    }
    const packageName = text(source.package, `${label}.package`)
    if (!/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(packageName))
      throw new Error(`Invalid npm package: ${packageName}`)
    const version = optionalText(source.version)
    if (version && /^(?:file:|https?:|git(?:\+|:)|\.{0,2}\/)/i.test(version))
      throw new Error(`Unsupported npm version selector: ${version}`)
    return {
      source: "npm",
      package: packageName,
      ...(version ? { version } : {}),
      ...(registry ? { registry: registry.href } : {}),
    }
  }
  throw new Error(`Unsupported plugin source: ${kind}`)
}

function parseEntry(value: unknown, index: number): PluginEntry {
  const entry = record(value, `marketplace.plugins[${index}]`)
  const policy = entry.policy === undefined ? undefined : record(entry.policy, `marketplace.plugins[${index}].policy`)
  const installation = policy
    ? text(policy.installation, `marketplace.plugins[${index}].policy.installation`)
    : undefined
  if (installation && !["AVAILABLE", "INSTALLED_BY_DEFAULT", "NOT_AVAILABLE"].includes(installation)) {
    throw new Error(`Unsupported plugin installation policy: ${installation}`)
  }
  return {
    ...(entry as Omit<PluginEntry, "name" | "source" | "policy">),
    name: text(entry.name, `marketplace.plugins[${index}].name`),
    source: parseSource(entry.source, index),
    ...(policy
      ? {
          policy: {
            installation: installation as NonNullable<PluginEntry["policy"]>["installation"],
            authentication: optionalText(policy.authentication) ?? "ON_INSTALL",
          },
        }
      : {}),
  }
}

function normalizeMcp(value: Record<string, unknown>, root: URL) {
  return Object.fromEntries(
    Object.entries(value).map(([name, server]) => {
      const config = record(server, `MCP server ${name}`)
      const remote =
        typeof config.url === "string" ? config.url : typeof config.httpUrl === "string" ? config.httpUrl : undefined
      if (remote) return [name, { type: "remote", url: remote, ...(config.headers ? { headers: config.headers } : {}) }]
      const command = text(config.command, `MCP server ${name}.command`)
      const args = Array.isArray(config.args)
        ? config.args.map((arg, index) => text(arg, `MCP server ${name}.args[${index}]`))
        : []
      const expand = (item: string) => {
        const pluginRoot = root.href.replace(/\/$/, "")
        const expanded = item
          .replaceAll("${PLUGIN_ROOT}", pluginRoot)
          .replaceAll("$PLUGIN_ROOT", pluginRoot)
          .replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot)
          .replaceAll("$CLAUDE_PLUGIN_ROOT", pluginRoot)
        return expanded.startsWith("./")
          ? new URL(relative(expanded, `MCP server ${name} command`), root).href
          : expanded
      }
      return [
        name,
        { type: "local", command: [command, ...args].map(expand), ...(config.env ? { environment: config.env } : {}) },
      ]
    }),
  )
}

function author(value: PluginEntry["author"] | PluginManifest["author"]) {
  if (typeof value === "string") return value
  return optionalText(value?.name)
}

async function adaptEntry(
  fetcher: MarketplaceFetch,
  source: MarketplaceSource,
  catalogURL: string,
  entry: PluginEntry,
) {
  if (entry.policy?.installation === "NOT_AVAILABLE") return
  const root = pluginRoot(entry, catalogURL)
  if (!root) throw new Error(`Unsupported Codex plugin source for ${entry.name}`)
  const manifestValue = await optionalJson(
    fetcher,
    [
      ".codex-plugin/plugin.json",
      ".plugin/plugin.json",
      "plugin.json",
      ".github/plugin/plugin.json",
      ".claude-plugin/plugin.json",
    ].map((path) => new URL(path, root).href),
    source,
  )
  const manifest = (manifestValue ? record(manifestValue, "plugin manifest") : {}) as PluginManifest
  const name = optionalText(manifest.name) ?? entry.name
  const description =
    optionalText(manifest.interface?.longDescription) ??
    optionalText(manifest.interface?.shortDescription) ??
    optionalText(entry.description) ??
    optionalText(manifest.description) ??
    `Plugin ${name}`
  const skillPaths = relativeList(
    entry.skills ?? manifest.skills ?? (entry.policy ? "./skills/" : undefined),
    "plugin.skills",
  )
  const skillURLs = skillPaths
    .filter((skill) => skill.replace(/\/$/, "").split("/").at(-1) === "skills")
    .map((skill) => new URL(skill.endsWith("/") ? skill : `${skill}/`, root).href)
  const skills: MarketplaceSkill[] = skillPaths.flatMap((skill, index) => {
    if (skill.replace(/\/$/, "").split("/").at(-1) === "skills") return []
    const skillName = skill === "./" ? name : skill.replace(/\/$/, "").split("/").at(-1) || name
    return [
      {
        id: `${name}:${skillName}:${index}`,
        name: skillName,
        url: new URL(skill.endsWith("/") ? skill : `${skill}/`, root).href,
      },
    ]
  })
  const rawMcp = entry.mcpServers ?? manifest.mcpServers
  const mcpValue =
    typeof rawMcp === "string"
      ? await json(fetcher, new URL(relative(rawMcp, "plugin.mcpServers"), root).href, source)
      : rawMcp
  const mcpRecord = mcpValue ? record(mcpValue, "plugin MCP config") : undefined
  const servers = mcpRecord && (mcpRecord.mcp_servers ?? mcpRecord.mcpServers)
  const installMcp = normalizeMcp(record(servers ?? mcpRecord ?? {}, "plugin MCP servers"), root)
  const unsupported = [
    manifest.apps ? "Codex registered apps" : undefined,
    manifest.extensions ? "Copilot extensions" : undefined,
    entry.hooks || manifest.hooks ? "lifecycle hooks" : undefined,
    entry.lspServers ? "language servers" : undefined,
    entry.commands || manifest.commands ? "commands" : undefined,
    entry.agents || manifest.agents ? "agents" : undefined,
  ].filter((item): item is string => item !== undefined)
  const capabilities = [
    manifest.apps ? "codex-apps" : undefined,
    manifest.extensions ? "copilot-extensions" : undefined,
    entry.hooks || manifest.hooks ? "plugin-hooks" : undefined,
    entry.lspServers ? "claude-lsp" : undefined,
    entry.commands || manifest.commands ? "plugin-commands" : undefined,
    entry.agents || manifest.agents ? "plugin-agents" : undefined,
    !manifestValue && !skillURLs.length && !skills.length && !Object.keys(installMcp).length
      ? "plugin-manifest"
      : undefined,
    !skillURLs.length && !skills.length && !Object.keys(installMcp).length ? "plugin-components" : undefined,
  ].filter((item): item is string => item !== undefined)
  const publisher = author(manifest.author) ?? author(entry.author) ?? manifest.interface?.developerName
  const icon = manifest.interface?.composerIcon ?? manifest.interface?.logo
  return {
    id: name,
    name: manifest.interface?.displayName ?? entry.displayName ?? name,
    description,
    kind: "plugin",
    version: optionalText(manifest.version) ?? optionalText(entry.version) ?? "0.0.0",
    ...(publisher ? { publisher: { name: publisher } } : {}),
    ...((optionalText(manifest.homepage) ?? optionalText(entry.homepage))
      ? { homepage: optionalText(manifest.homepage) ?? optionalText(entry.homepage) }
      : {}),
    ...((optionalText(manifest.repository) ?? optionalText(entry.repository))
      ? { repository: optionalText(manifest.repository) ?? optionalText(entry.repository) }
      : {}),
    ...((optionalText(manifest.license) ?? optionalText(entry.license))
      ? { license: optionalText(manifest.license) ?? optionalText(entry.license) }
      : {}),
    tags: [entry.category, ...(manifest.keywords ?? entry.keywords ?? [])].filter((item): item is string =>
      Boolean(item),
    ),
    ...(manifest.interface?.brandColor ? { brand_color: manifest.interface.brandColor } : {}),
    ...(icon ? { icon: { "src-light": new URL(relative(icon, "plugin icon"), root).href } } : {}),
    permissions: [...(manifest.interface?.capabilities ?? []), ...unsupported],
    ...(capabilities.length ? { compatibility: { capabilities } } : {}),
    install: {
      ...(skillURLs.length || skills.length
        ? { skills: { ...(skillURLs.length ? { urls: skillURLs } : {}), ...(skills.length ? { items: skills } : {}) } }
        : {}),
      ...(Object.keys(installMcp).length ? { mcp: installMcp } : {}),
    },
  } satisfies MarketplaceCatalogItem
}

export async function adaptCodexMarketplace(
  value: unknown,
  input: { fetcher: MarketplaceFetch; source: MarketplaceSource; catalogURL: string },
): Promise<MarketplaceCatalog> {
  const marketplace = record(value, "marketplace")
  if (!Array.isArray(marketplace.plugins)) throw new Error("marketplace.plugins must be an array")
  const entries = marketplace.plugins.map(parseEntry)
  const names = new Set<string>()
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`Duplicate plugin name: ${entry.name}`)
    names.add(entry.name)
  }
  const resolved = await Promise.allSettled(
    entries.map((entry) => adaptEntry(input.fetcher, input.source, input.catalogURL, entry)),
  )
  const failures = resolved.flatMap((result) => (result.status === "rejected" ? [String(result.reason)] : []))
  if (failures.length) throw new Error(failures.join("; "))
  const items = resolved.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []))
  const iface = marketplace.interface === undefined ? undefined : record(marketplace.interface, "marketplace.interface")
  const owner = marketplace.owner === undefined ? undefined : record(marketplace.owner, "marketplace.owner")
  const id = text(marketplace.name, "marketplace.name")
  return {
    schema: "opencode.marketplace/v1",
    id,
    name: typeof iface?.displayName === "string" ? iface.displayName : id,
    ...(typeof marketplace.metadata === "object" && marketplace.metadata && "description" in marketplace.metadata
      ? { description: optionalText(marketplace.metadata.description) }
      : {}),
    ...(typeof owner?.name === "string" ? { publisher: { name: owner.name } } : {}),
    items,
  }
}
