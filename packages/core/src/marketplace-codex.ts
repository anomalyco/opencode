import type { MarketplaceCatalog, MarketplaceCatalogItem, MarketplaceFetch, MarketplaceSource } from "./marketplace"

type CodexEntry = {
  name: string
  source:
    | string
    | { source: "local"; path: string }
    | { source: "url" | "git-subdir"; url: string; path?: string; ref?: string; sha?: string }
    | { source: "npm"; package: string; version?: string; registry?: string }
  policy: { installation: "AVAILABLE" | "INSTALLED_BY_DEFAULT" | "NOT_AVAILABLE"; authentication: string }
  category: string
  description?: string
}

type CodexManifest = {
  name: string
  version: string
  description: string
  author?: { name: string; url?: string }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  skills?: string
  mcpServers?: string
  apps?: string
  hooks?: string
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
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function relative(value: string, label: string) {
  const normalized = value.replaceAll("\\", "/")
  if (!normalized.startsWith("./") || normalized.split("/").includes("..")) {
    throw new Error(`${label} must be a safe ./-relative path`)
  }
  return normalized
}

function marketplaceRoot(url: string) {
  const parsed = new URL(url)
  if (parsed.pathname.endsWith("/.agents/plugins/marketplace.json")) return new URL("../../", parsed)
  if (parsed.pathname.endsWith("/.claude-plugin/marketplace.json")) return new URL("../", parsed)
  return new URL("./", parsed)
}

function pluginRoot(entry: CodexEntry, catalogURL: string): URL | undefined {
  const source = typeof entry.source === "string" ? { source: "local" as const, path: entry.source } : entry.source
  if (source.source === "local") {
    return new URL(
      `${relative(source.path, `plugin ${entry.name} source`).replace(/\/$/, "")}/`,
      marketplaceRoot(catalogURL),
    )
  }
  if (source.source === "npm") {
    if (source.registry && new URL(source.registry).origin !== "https://registry.npmjs.org") return undefined
    const packageName = source.package
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")
    return new URL(`https://unpkg.com/${packageName}@${encodeURIComponent(source.version ?? "latest")}/`)
  }
  const repository = new URL(source.url)
  const revision = source.sha ?? source.ref ?? "HEAD"
  const pathname = repository.pathname.replace(/\.git$/, "").replace(/^\//, "")
  const root = ((): URL | undefined => {
    if (repository.hostname === "github.com") {
      const [owner, name] = pathname.split("/")
      if (!owner || !name) return undefined
      return new URL(`https://raw.githubusercontent.com/${owner}/${name}/${revision}/`)
    }
    if (repository.hostname === "gitlab.com" && pathname.split("/").length >= 2) {
      return new URL(`https://gitlab.com/${pathname}/-/raw/${revision}/`)
    }
    return undefined
  })()
  if (!root) return undefined
  return source.source === "git-subdir" && source.path
    ? new URL(`${relative(source.path, `plugin ${entry.name} source`).replace(/\/$/, "")}/`, root)
    : root
}

async function json(fetcher: MarketplaceFetch, url: string, source: MarketplaceSource) {
  const response = await fetcher(url, { headers: source.headers, cache: "no-store" })
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`)
  return response.json()
}

function parseEntry(value: unknown, index: number): CodexEntry {
  const entry = record(value, `marketplace.plugins[${index}]`)
  const policy = record(entry.policy, `marketplace.plugins[${index}].policy`)
  const installation = text(policy.installation, `marketplace.plugins[${index}].policy.installation`)
  if (!["AVAILABLE", "INSTALLED_BY_DEFAULT", "NOT_AVAILABLE"].includes(installation)) {
    throw new Error(`Unsupported Codex installation policy: ${installation}`)
  }
  const rawSource =
    typeof entry.source === "string" ? entry.source : record(entry.source, `marketplace.plugins[${index}].source`)
  const source = (() => {
    if (typeof rawSource === "string") return relative(rawSource, `marketplace.plugins[${index}].source`)
    const kind = text(rawSource.source, `marketplace.plugins[${index}].source.source`)
    if (kind === "local") {
      return {
        source: "local" as const,
        path: relative(
          text(rawSource.path, `marketplace.plugins[${index}].source.path`),
          `marketplace.plugins[${index}].source.path`,
        ),
      }
    }
    if (kind === "url" || kind === "git-subdir") {
      return {
        source: kind,
        url: text(rawSource.url, `marketplace.plugins[${index}].source.url`),
        ...(kind === "git-subdir"
          ? {
              path: relative(
                text(rawSource.path, `marketplace.plugins[${index}].source.path`),
                `marketplace.plugins[${index}].source.path`,
              ),
            }
          : {}),
        ...(typeof rawSource.ref === "string" ? { ref: rawSource.ref } : {}),
        ...(typeof rawSource.sha === "string" ? { sha: rawSource.sha } : {}),
      } as CodexEntry["source"]
    }
    if (kind === "npm") {
      const registry = typeof rawSource.registry === "string" ? new URL(rawSource.registry) : undefined
      if (
        registry &&
        (registry.protocol !== "https:" || registry.username || registry.password || registry.search || registry.hash)
      ) {
        throw new Error(`marketplace.plugins[${index}].source.registry must be a credential-free HTTPS URL`)
      }
      const packageName = text(rawSource.package, `marketplace.plugins[${index}].source.package`)
      if (!/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(packageName))
        throw new Error(`Invalid npm package: ${packageName}`)
      const version = typeof rawSource.version === "string" ? rawSource.version.trim() : undefined
      if (version && /^(?:file:|https?:|git(?:\+|:)|\.{0,2}\/)/i.test(version)) {
        throw new Error(`Unsupported npm version selector: ${version}`)
      }
      return {
        source: "npm" as const,
        package: packageName,
        ...(version ? { version } : {}),
        ...(registry ? { registry: registry.href } : {}),
      }
    }
    throw new Error(`Unsupported Codex plugin source: ${kind}`)
  })()
  return {
    name: text(entry.name, `marketplace.plugins[${index}].name`),
    source,
    policy: {
      installation: installation as CodexEntry["policy"]["installation"],
      authentication: text(policy.authentication, `marketplace.plugins[${index}].policy.authentication`),
    },
    category: text(entry.category, `marketplace.plugins[${index}].category`),
    ...(typeof entry.description === "string" ? { description: entry.description } : {}),
  }
}

function parseManifest(value: unknown) {
  const manifest = record(value, "plugin manifest")
  return manifest as CodexManifest
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
        const expanded = item.replaceAll("${PLUGIN_ROOT}", pluginRoot).replaceAll("$PLUGIN_ROOT", pluginRoot)
        return expanded.startsWith("./")
          ? new URL(relative(expanded, `MCP server ${name} command`), root).href
          : expanded
      }
      return [
        name,
        {
          type: "local",
          command: [command, ...args].map(expand),
          ...(config.env ? { environment: config.env } : {}),
        },
      ]
    }),
  )
}

async function adaptEntry(
  fetcher: MarketplaceFetch,
  source: MarketplaceSource,
  catalogURL: string,
  entry: CodexEntry,
): Promise<MarketplaceCatalogItem | undefined> {
  if (entry.policy.installation === "NOT_AVAILABLE") return undefined
  const root = pluginRoot(entry, catalogURL)
  if (!root) throw new Error(`Unsupported Codex plugin source for ${entry.name}`)
  const manifest = parseManifest(await json(fetcher, new URL(".codex-plugin/plugin.json", root).href, source))
  const name = text(manifest.name, "plugin.name")
  const version = text(manifest.version, "plugin.version")
  const description = text(manifest.description, "plugin.description")
  const skills = manifest.skills ? relative(manifest.skills, "plugin.skills") : "./skills/"
  const mcp = manifest.mcpServers
    ? await json(fetcher, new URL(relative(manifest.mcpServers, "plugin.mcpServers"), root).href, source)
    : undefined
  const mcpRecord = mcp ? record(mcp, "plugin MCP config") : undefined
  const servers = mcpRecord && (mcpRecord.mcp_servers ?? mcpRecord.mcpServers)
  const installMcp = normalizeMcp(record(servers ?? mcpRecord ?? {}, "plugin MCP servers"), root)
  const unsupported = [
    manifest.apps ? "Codex registered apps" : undefined,
    manifest.hooks ? "Codex lifecycle hooks" : undefined,
  ].filter((item): item is string => item !== undefined)
  const unsupportedCapabilities = [
    manifest.apps ? "codex-apps" : undefined,
    manifest.hooks ? "codex-hooks" : undefined,
  ].filter((item): item is string => item !== undefined)
  return {
    id: name,
    name: manifest.interface?.displayName ?? name,
    description:
      manifest.interface?.longDescription ?? manifest.interface?.shortDescription ?? entry.description ?? description,
    kind: "plugin",
    version,
    ...(manifest.author?.name || manifest.interface?.developerName
      ? { publisher: { name: manifest.author?.name ?? manifest.interface!.developerName! } }
      : {}),
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    ...(manifest.repository ? { repository: manifest.repository } : {}),
    ...(manifest.license ? { license: manifest.license } : {}),
    tags: [entry.category, ...(manifest.keywords ?? [])],
    ...(manifest.interface?.brandColor ? { brand_color: manifest.interface.brandColor } : {}),
    ...(manifest.interface?.composerIcon || manifest.interface?.logo
      ? {
          icon: {
            "src-light": new URL(
              relative(manifest.interface.composerIcon ?? manifest.interface.logo!, "plugin icon"),
              root,
            ).href,
          },
        }
      : {}),
    permissions: [...(manifest.interface?.capabilities ?? []), ...unsupported],
    ...(unsupportedCapabilities.length ? { compatibility: { capabilities: unsupportedCapabilities } } : {}),
    install: {
      skills: { urls: [new URL(skills, root).href] },
      ...(Object.keys(installMcp).length ? { mcp: installMcp } : {}),
    },
  }
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
    if (names.has(entry.name)) throw new Error(`Duplicate Codex plugin name: ${entry.name}`)
    names.add(entry.name)
  }
  const resolved = await Promise.allSettled(
    entries.map((entry) => adaptEntry(input.fetcher, input.source, input.catalogURL, entry)),
  )
  const failures = resolved.flatMap((result) => (result.status === "rejected" ? [String(result.reason)] : []))
  if (failures.length) throw new Error(failures.join("; "))
  const items = resolved.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []))
  const iface = marketplace.interface === undefined ? undefined : record(marketplace.interface, "marketplace.interface")
  const id = text(marketplace.name, "marketplace.name")
  return {
    schema: "opencode.marketplace/v1",
    id,
    name: typeof iface?.displayName === "string" ? iface.displayName : id,
    items,
  }
}
