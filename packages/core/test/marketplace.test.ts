import { describe, expect, test } from "bun:test"
import {
  OFFICIAL_MARKETPLACE_SOURCE,
  createMarketplaceSource,
  installMarketplaceItem,
  loadMarketplace,
  marketplaceDisabledSkillNames,
  marketplaceEnabledMcpNames,
  marketplaceItemEnabled,
  marketplaceMcpEnabled,
  marketplacePermissions,
  marketplaceSkillComponents,
  marketplaceSkillEnabled,
  marketplaceSources,
  marketplaceStatus,
  parseMarketplaceCatalog,
  removeMarketplaceSource,
  setMarketplaceItemEnabled,
  setMarketplaceMcpEnabled,
  setMarketplaceSkillEnabled,
  toggleMarketplaceSource,
  uninstallMarketplaceItem,
  upsertMarketplaceSource,
  type MarketplaceHostConfig,
  type MarketplaceListing,
} from "@opencode-ai/core/marketplace"

function listing(version = "1.0.0"): MarketplaceListing {
  return {
    key: "community:tools:review",
    source: {
      id: "community",
      name: "Community",
      url: "https://example.test/catalog.json",
      trust: "community",
    },
    catalog: {
      schema: "opencode.marketplace/v1",
      id: "tools",
      name: "Tools",
      items: [],
    },
    item: {
      id: "review",
      name: "Review kit",
      description: "Installs a plugin, skill source, agent, command, and MCP server.",
      kind: "bundle",
      version,
      install: {
        plugins: [["example-plugin@2.0.0", { strict: true }]],
        skills: { urls: ["https://example.test/skills/"] },
        agents: { reviewer: { description: "Review changes", mode: "subagent" } },
        commands: { review: { template: "Review the current changes" } },
        mcp: { docs: { type: "remote", url: "https://example.test/mcp" } },
        instructions: [".opencode/review.md"],
      },
    },
  }
}

function keyedListing(id: string, version = "1.0.0") {
  const result = listing(version)
  result.key = `community:tools:${id}`
  result.item.id = id
  result.item.name = `Review kit ${id}`
  return result
}

describe("marketplace catalogs", () => {
  test("loads enabled catalogs and reports source failures", async () => {
    const source = createMarketplaceSource({ url: "https://example.test/catalog.json", name: "Example" })
    const config = upsertMarketplaceSource({}, source)
    const result = await loadMarketplace({
      config,
      fetch: async (url) => {
        if (String(url).includes("example.test")) {
          return Response.json({
            schema: "opencode.marketplace/v1",
            id: "example",
            name: "Example",
            items: [
              {
                id: "skill",
                name: "Skill",
                description: "A reusable skill",
                kind: "skill",
                version: "1.0.0",
                install: { skills: { urls: ["https://example.test/skills/"] } },
              },
            ],
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    expect(result.errors).toEqual([])
    expect(result.listings.map((item) => item.key)).toEqual([`${source.id}:example:skill`])
    expect(result.listings[0]?.source.name).toBe("Example")
  })

  test("validates catalog entries", () => {
    expect(() => parseMarketplaceCatalog({ schema: "other", id: "x", name: "X", items: [] })).toThrow(
      "Unsupported marketplace schema",
    )
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "x",
        name: "X",
        items: [
          { id: "same", name: "One", description: "One", kind: "skill", version: "1", install: {} },
          { id: "same", name: "Two", description: "Two", kind: "skill", version: "1", install: {} },
        ],
      }),
    ).toThrow("Duplicate marketplace item id")
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "ambiguous:catalog",
        name: "X",
        items: [],
      }),
    ).toThrow("cannot contain colons")
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "large",
        name: "Large",
        items: Array.from({ length: 2_001 }, (_, index) => ({
          id: `item-${index}`,
          name: "Item",
          description: "Item",
          kind: "skill",
          version: "1",
          install: {},
        })),
      }),
    ).toThrow("too many items")
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "plugins",
        name: "Plugins",
        items: [
          {
            id: "duplicates",
            name: "Duplicates",
            description: "Duplicates",
            kind: "plugin",
            version: "1.0.0",
            install: { plugins: ["example-plugin@1.0.0", "example-plugin@2.0.0"] },
          },
        ],
      }),
    ).toThrow("duplicate package identity")
  })

  test("loads light and dark plugin icons relative to the catalog", async () => {
    const source = createMarketplaceSource({ url: "https://example.test/catalog/marketplace.json" })
    const result = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async () =>
        Response.json({
          schema: "opencode.marketplace/v1",
          id: "visual",
          name: "Visual",
          items: [
            {
              id: "plugin",
              name: "Visual plugin",
              description: "Has themed marketplace artwork.",
              kind: "plugin",
              version: "1.0.0",
              icon: { "src-light": "./assets/icon-light.png", "src-dark": "./assets/icon-dark.png" },
              brand_color: "#10a37f",
              install: { plugins: ["visual-plugin"] },
            },
          ],
        }),
    })

    expect(result.listings[0]?.item.icon).toEqual({
      "src-light": "https://example.test/catalog/assets/icon-light.png",
      "src-dark": "https://example.test/catalog/assets/icon-dark.png",
    })
    expect(result.listings[0]?.item.brand_color).toBe("#10A37F")
    expect(
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "single-icon",
        name: "Single icon",
        items: [
          {
            id: "plugin",
            name: "Plugin",
            description: "Uses one arbitrary image.",
            kind: "plugin",
            version: "1.0.0",
            icon: "https://example.test/custom-artwork.webp",
            install: {},
          },
        ],
      }).items[0]?.icon,
    ).toEqual({ "src-light": "https://example.test/custom-artwork.webp" })
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "old-icon-fields",
        name: "Old icon fields",
        items: [
          {
            id: "plugin",
            name: "Plugin",
            description: "Uses an unsupported icon field.",
            kind: "plugin",
            version: "1.0.0",
            icon: { src: "https://example.test/icon.png" },
            install: {},
          },
        ],
      }),
    ).toThrow("catalog.items[0].icon.src-light")
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "visual",
        name: "Visual",
        items: [
          {
            id: "unsafe",
            name: "Unsafe",
            description: "Unsafe icon",
            kind: "plugin",
            version: "1.0.0",
            icon: "../secret.png",
            install: {},
          },
        ],
      }),
    ).toThrow("absolute HTTP or HTTPS")
  })

  test("resolves local MCP command artifacts relative to the catalog", async () => {
    const source = createMarketplaceSource({ url: "https://example.test/catalog/marketplace.json" })
    const result = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async () =>
        Response.json({
          schema: "opencode.marketplace/v1",
          id: "tools",
          name: "Tools",
          items: [
            {
              id: "review",
              name: "Review",
              description: "Review tools",
              kind: "mcp",
              version: "1.0.0",
              install: {
                mcp: { review: { type: "local", command: ["node", "./mcp/review.mjs"] } },
              },
            },
          ],
        }),
    })

    expect(result.listings[0]?.item.install.mcp?.review).toEqual({
      type: "local",
      command: ["node", "https://example.test/catalog/mcp/review.mjs"],
    })
  })

  test("loads a local directory catalog and resolves catalog-relative assets", async () => {
    const source = createMarketplaceSource({ url: "file:///tmp/team-marketplace/", name: "Local team" })
    const requests: string[] = []
    const result = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async (input) => {
        const url = String(input)
        requests.push(url)
        if (url.endsWith("/.opencode/marketplace.json")) return new Response("not found", { status: 404 })
        return Response.json({
          schema: "opencode.marketplace/v1",
          id: "local",
          name: "Local",
          items: [
            {
              id: "review",
              name: "Review",
              description: "Local bundle",
              kind: "bundle",
              version: "1.0.0",
              install: {
                plugins: ["./plugins/review.ts"],
                skills: {
                  paths: ["./skills/legacy"],
                  items: [
                    { id: "review", name: "review", path: "./skills/review" },
                    { id: "release", name: "release", url: "./skills/release/SKILL.md" },
                  ],
                },
                instructions: ["./instructions/review.md"],
              },
            },
          ],
        })
      },
    })

    expect(result.errors).toEqual([])
    expect(requests).toContain("file:///tmp/team-marketplace/.opencode/marketplace.json")
    expect(requests).toContain("file:///tmp/team-marketplace/marketplace.json")
    expect(result.listings[0]?.item.install).toEqual({
      plugins: ["file:///tmp/team-marketplace/plugins/review.ts"],
      skills: {
        urls: ["file:///tmp/team-marketplace/skills/legacy/"],
        items: [
          { id: "review", name: "review", url: "file:///tmp/team-marketplace/skills/review/" },
          { id: "release", name: "release", url: "file:///tmp/team-marketplace/skills/release/SKILL.md" },
        ],
      },
      instructions: ["file:///tmp/team-marketplace/instructions/review.md"],
    })
  })

  test("rejects encoded traversal in catalog-relative local assets", async () => {
    const source = createMarketplaceSource({ url: "file:///tmp/team-marketplace/marketplace.json" })
    const result = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async () =>
        Response.json({
          schema: "opencode.marketplace/v1",
          id: "unsafe-local",
          name: "Unsafe local",
          items: [
            {
              id: "unsafe",
              name: "Unsafe",
              description: "Encoded traversal",
              kind: "plugin",
              version: "1.0.0",
              install: { plugins: ["./%2e%2e/escape.ts"] },
            },
          ],
        }),
    })

    expect(result.listings).toEqual([])
    expect(result.errors[0]?.message).toContain("stay inside the catalog directory")
  })

  test("discovers a catalog from a Git repository URL", async () => {
    const source = createMarketplaceSource({ url: "https://git.example.test/ai/agent-marketplace.git" })
    const requests: string[] = []
    const result = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async (input) => {
        requests.push(String(input))
        if (String(input).includes("/-/raw/HEAD/")) {
          return Response.json({
            schema: "opencode.marketplace/v1",
            id: "agents",
            name: "Agents",
            items: [
              {
                id: "review",
                name: "Review",
                description: "Review agent",
                kind: "plugin",
                version: "1.0.0",
                icon: "./assets/review.png",
                install: {},
              },
            ],
          })
        }
        return new Response("not found", { status: 404 })
      },
    })

    expect(requests).toContain("https://git.example.test/ai/agent-marketplace/-/raw/HEAD/.opencode/marketplace.json")
    expect(result.errors).toEqual([])
    expect(result.listings[0]?.item.icon?.["src-light"]).toBe(
      "https://git.example.test/ai/agent-marketplace/-/raw/HEAD/.opencode/assets/review.png",
    )
  })

  test("discovers GitHub Copilot and Claude Code catalog locations", async () => {
    for (const catalogPath of [".github/plugin/marketplace.json", ".claude-plugin/marketplace.json"]) {
      const requests: string[] = []
      const source = createMarketplaceSource({ url: "github:example/plugins" })
      const result = await loadMarketplace({
        config: upsertMarketplaceSource({}, source),
        fetch: async (input) => {
          const url = String(input)
          requests.push(url)
          if (url.endsWith(`/${catalogPath}`)) {
            return Response.json({
              name: catalogPath.startsWith(".github") ? "copilot" : "claude",
              plugins: [
                {
                  name: "review",
                  description: "Review changes",
                  version: "1.0.0",
                  source: "./plugins/review",
                  skills: ["./skills/review"],
                  strict: false,
                },
              ],
            })
          }
          return new Response("not found", { status: 404 })
        },
      })

      expect(requests).toContain(`https://raw.githubusercontent.com/example/plugins/HEAD/${catalogPath}`)
      expect(result.errors).toEqual([])
      expect(result.listings[0]?.item.install.skills?.items?.[0]?.url).toBe(
        "https://raw.githubusercontent.com/example/plugins/HEAD/plugins/review/skills/review/",
      )
    }
  })

  test("reports useful errors when a GitHub repository has no supported catalog", async () => {
    const source = createMarketplaceSource({ url: "github:example/empty" })
    const result = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async (input) => new Response(`missing ${String(input)}`, { status: 404 }),
    })

    expect(result.listings).toEqual([])
    expect(result.errors[0]?.message).toContain("HTTP 404")
    expect(result.errors[0]?.message).not.toBe("")
  })

  test("rejects oversized catalog responses before parsing", async () => {
    const source = createMarketplaceSource({ url: "https://example.test/catalog.json" })
    const result = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async () =>
        new Response("{}", {
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        }),
    })

    expect(result.listings).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toContain("exceeds")

    const streamed = await loadMarketplace({
      config: upsertMarketplaceSource({}, source),
      fetch: async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
    })
    expect(streamed.listings).toEqual([])
    expect(streamed.errors[0]?.message).toContain("exceeds")
  })

  test("rejects executable and credential-bearing metadata links", () => {
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "links",
        name: "Links",
        publisher: { name: "Publisher", url: "data:text/html,unsafe" },
        items: [],
      }),
    ).toThrow("HTTP or HTTPS")
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "links",
        name: "Links",
        items: [
          {
            id: "unsafe",
            name: "Unsafe",
            description: "Unsafe",
            kind: "skill",
            version: "1.0.0",
            homepage: "javascript:alert(1)",
            install: {},
          },
        ],
      }),
    ).toThrow("HTTP or HTTPS")
    expect(() =>
      parseMarketplaceCatalog({
        schema: "opencode.marketplace/v1",
        id: "links",
        name: "Links",
        homepage: "https://user:secret@example.test/catalog",
        items: [],
      }),
    ).toThrow("cannot contain credentials")
  })
})

describe("marketplace installation", () => {
  test("detects conflicts, force-installs, and restores previous values", () => {
    const config: MarketplaceHostConfig = {
      plugin: [["example-plugin@1.0.0", { strict: false }]],
      agent: { reviewer: { description: "Existing" } },
      command: { keep: { template: "Keep me" } },
    }
    const conflict = installMarketplaceItem(config, listing())
    expect(conflict.ok).toBe(false)
    if (conflict.ok) throw new Error("Expected conflict")
    expect(conflict.conflicts.map((item) => item.path)).toEqual(["plugin.example-plugin", "agent.reviewer"])

    const installed = installMarketplaceItem(config, listing(), { force: true })
    expect(installed.ok).toBe(true)
    if (!installed.ok) throw new Error("Expected install")
    expect(installed.config.plugin).toEqual([["example-plugin@2.0.0", { strict: true }]])
    expect(installed.config.agent?.reviewer).toEqual({ description: "Review changes", mode: "subagent" })
    expect(installed.config.command?.keep).toEqual({ template: "Keep me" })
    const receipt = installed.config.marketplace?.installed?.[listing().key]
    expect(receipt?.version).toBe("1.0.0")
    expect(receipt?.snapshot).not.toHaveProperty("install")

    const removed = uninstallMarketplaceItem(installed.config, listing().key)
    expect(removed.preserved).toEqual([])
    expect(removed.config.plugin).toEqual([["example-plugin@1.0.0", { strict: false }]])
    expect(removed.config.agent?.reviewer).toEqual({ description: "Existing" })
    expect(removed.config.command).toEqual({ keep: { template: "Keep me" } })
    expect(removed.config.skills?.urls).toEqual([])
    expect(removed.config.marketplace?.installed?.[listing().key]).toBeUndefined()
  })

  test("matches registry package identities without changing non-registry specs", () => {
    const config: MarketplaceHostConfig = {
      plugin: [
        "example-plugin@1.0.0",
        "@example/scoped-plugin@1.0.0",
        "alias-plugin@npm:example-plugin@1.0.0",
        "github:example/plugin",
        "https://example.test/plugin.tgz",
        "file:../plugin",
      ],
    }
    const registry = listing()
    registry.item.install = {
      plugins: ["example-plugin@2.0.0", "@example/scoped-plugin@2.0.0", "alias-plugin@npm:example-plugin@2.0.0"],
    }
    const conflict = installMarketplaceItem(config, registry)
    expect(conflict.ok).toBe(false)
    if (conflict.ok) throw new Error("Expected conflict")
    expect(conflict.conflicts.map((item) => item.path)).toEqual([
      "plugin.example-plugin",
      "plugin.@example/scoped-plugin",
      "plugin.alias-plugin",
    ])

    const remote = listing()
    remote.item.install = {
      plugins: ["github:other/plugin", "https://other.test/plugin.tgz", "file:../other-plugin"],
    }
    expect(installMarketplaceItem(config, remote).ok).toBe(true)
  })

  test("preserves settings edited after installation", () => {
    const installed = installMarketplaceItem({}, listing(), { force: true })
    if (!installed.ok) throw new Error("Expected install")
    installed.config.agent = { ...installed.config.agent, reviewer: { description: "User override" } }
    installed.config.plugin = ["example-plugin@3.0.0"]

    const removed = uninstallMarketplaceItem(installed.config, listing().key)
    expect(removed.preserved).toEqual(["plugin.example-plugin", "agent.reviewer"])
    expect(removed.config.plugin).toEqual(["example-plugin@3.0.0"])
    expect(removed.config.agent?.reviewer).toEqual({ description: "User override" })
  })

  test("keeps shared receipts valid when packages are removed out of order", () => {
    const firstListing = keyedListing("first")
    const secondListing = keyedListing("second")
    const original: MarketplaceHostConfig = {
      plugin: [["example-plugin@1.0.0", { strict: false }]],
      agent: { reviewer: { description: "Existing" } },
    }

    const first = installMarketplaceItem(original, firstListing, { force: true })
    if (!first.ok) throw new Error("Expected first install")
    const second = installMarketplaceItem(first.config, secondListing)
    if (!second.ok) throw new Error("Expected shared install")

    const withoutFirst = uninstallMarketplaceItem(second.config, firstListing.key)
    expect(withoutFirst.preserved).toEqual([])
    expect(withoutFirst.config.plugin).toEqual([["example-plugin@2.0.0", { strict: true }]])
    expect(withoutFirst.config.agent?.reviewer).toEqual({ description: "Review changes", mode: "subagent" })
    expect(withoutFirst.config.skills?.urls).toEqual(["https://example.test/skills/"])

    const withoutSecond = uninstallMarketplaceItem(withoutFirst.config, secondListing.key)
    expect(withoutSecond.preserved).toEqual([])
    expect(withoutSecond.config.plugin).toEqual([["example-plugin@1.0.0", { strict: false }]])
    expect(withoutSecond.config.agent?.reviewer).toEqual({ description: "Existing" })
    expect(withoutSecond.config.skills?.urls).toEqual([])
    expect(withoutSecond.config.command).toEqual({})
    expect(withoutSecond.config.mcp).toEqual({})
    expect(withoutSecond.config.instructions).toEqual([])
  })

  test("splices overridden receipt chains when an earlier package is removed first", () => {
    const firstListing = keyedListing("first")
    const secondListing = keyedListing("second")
    secondListing.item.install.plugins = [["example-plugin@3.0.0", { strict: true }]]
    secondListing.item.install.agents = { reviewer: { description: "Second", mode: "subagent" } }
    const original: MarketplaceHostConfig = {
      plugin: [["example-plugin@1.0.0", { strict: false }]],
      agent: { reviewer: { description: "Existing" } },
    }

    const first = installMarketplaceItem(original, firstListing, { force: true })
    if (!first.ok) throw new Error("Expected first install")
    const second = installMarketplaceItem(first.config, secondListing, { force: true })
    if (!second.ok) throw new Error("Expected overriding install")

    const withoutFirst = uninstallMarketplaceItem(second.config, firstListing.key)
    expect(withoutFirst.config.plugin).toEqual([["example-plugin@3.0.0", { strict: true }]])
    expect(withoutFirst.config.agent?.reviewer).toEqual({ description: "Second", mode: "subagent" })

    const withoutSecond = uninstallMarketplaceItem(withoutFirst.config, secondListing.key)
    expect(withoutSecond.config.plugin).toEqual([["example-plugin@1.0.0", { strict: false }]])
    expect(withoutSecond.config.agent?.reviewer).toEqual({ description: "Existing" })
  })

  test("preserves managed values when an installation receipt is incomplete", () => {
    const item = keyedListing("incomplete")
    item.item.install = { plugins: ["example-plugin@2.0.0"] }
    const installed = installMarketplaceItem({}, item, { force: true })
    if (!installed.ok) throw new Error("Expected install")
    installed.config.marketplace!.installed![item.key]!.receipt = {}

    const removed = uninstallMarketplaceItem(installed.config, item.key)
    expect(removed.preserved).toEqual(["plugin.example-plugin"])
    expect(removed.config.plugin).toEqual(["example-plugin@2.0.0"])
  })

  test("detects updates without offering catalog downgrades", () => {
    const installed = installMarketplaceItem({}, listing("1.0.0"), { force: true })
    if (!installed.ok) throw new Error("Expected install")
    expect(marketplaceStatus(installed.config, listing("1.0.0"))).toBe("installed")
    expect(marketplaceStatus(installed.config, listing("1.1.0"))).toBe("update")
    expect(marketplaceStatus(installed.config, listing("0.9.0"))).toBe("installed")

    const republished = listing("1.0.0")
    republished.item.description = "Republished metadata"
    expect(marketplaceStatus(installed.config, republished)).toBe("installed")
    expect(marketplacePermissions(listing().item)).toContain("Runs third-party plugin code inside OpenCode")
    expect(marketplacePermissions(listing().item)).toContain("Starts or connects to MCP servers")
  })

  test("keeps installed items manageable after their catalog disappears", async () => {
    const installed = installMarketplaceItem({}, listing(), { force: true })
    if (!installed.ok) throw new Error("Expected install")

    const loaded = await loadMarketplace({ config: installed.config })
    const orphan = loaded.listings.find((item) => item.key === listing().key)
    expect(orphan?.orphaned).toBe(true)
    expect(orphan && marketplaceStatus(installed.config, orphan)).toBe("installed")

    const removed = uninstallMarketplaceItem(installed.config, listing().key)
    expect(removed.config.marketplace?.installed?.[listing().key]).toBeUndefined()
    expect(removed.config.plugin).toEqual([])
  })

  test("toggles a plugin, each skill, and each MCP while remembering explicit MCP choices", () => {
    const item = listing()
    item.item.install.skills = {
      items: [
        { id: "review", name: "review", path: ".opencode/skills/review" },
        { id: "release", name: "release", path: ".opencode/skills/release" },
      ],
    }
    item.item.install.mcp = {
      docs: { type: "remote", url: "https://example.test/docs" },
      issues: { type: "remote", url: "https://example.test/issues", enabled: false },
    }
    const installed = installMarketplaceItem({}, item, { force: true })
    if (!installed.ok) throw new Error("Expected install")

    expect(marketplaceItemEnabled(installed.config, item.key)).toBe(true)
    expect(marketplaceSkillComponents(item.item.install).map((skill) => skill.id)).toEqual(["review", "release"])
    expect(marketplaceMcpEnabled(installed.config, item.key, "docs")).toBe(true)
    expect(marketplaceMcpEnabled(installed.config, item.key, "issues")).toBe(false)
    expect(marketplaceEnabledMcpNames(installed.config, item.key)).toEqual(["docs"])
    expect(installed.config.mcp?.issues).toMatchObject({ enabled: false })

    const skill = setMarketplaceSkillEnabled(installed.config, item.key, "release", false)
    if (!skill.ok) throw new Error("Expected skill toggle")
    expect(marketplaceSkillEnabled(skill.config, item.key, "release")).toBe(false)
    expect(skill.config.skills?.paths).toEqual([".opencode/skills/review"])
    expect(marketplaceDisabledSkillNames(skill.config)).toEqual(["release"])

    const mcp = setMarketplaceMcpEnabled(skill.config, item.key, "docs", false)
    if (!mcp.ok) throw new Error("Expected MCP toggle")
    expect(mcp.config.mcp?.docs).toMatchObject({ enabled: false })

    const disabled = setMarketplaceItemEnabled(mcp.config, item.key, false)
    if (!disabled.ok) throw new Error("Expected plugin toggle")
    expect(marketplaceSkillEnabled(disabled.config, item.key, "review")).toBe(true)
    expect(marketplaceSkillEnabled(disabled.config, item.key, "release")).toBe(false)
    expect(marketplaceMcpEnabled(disabled.config, item.key, "docs")).toBe(false)
    expect(marketplaceMcpEnabled(disabled.config, item.key, "issues")).toBe(false)
    expect(marketplaceEnabledMcpNames(disabled.config, item.key)).toEqual([])
    expect(disabled.config.plugin).toEqual([])
    expect(disabled.config.skills?.paths).toEqual([])
    expect(disabled.config.mcp).toEqual({})

    const enabled = setMarketplaceItemEnabled(disabled.config, item.key, true)
    if (!enabled.ok) throw new Error("Expected plugin toggle")
    expect(enabled.config.plugin).toEqual([["example-plugin@2.0.0", { strict: true }]])
    expect(enabled.config.skills?.paths).toEqual([".opencode/skills/review"])
    expect(enabled.config.mcp?.docs).toMatchObject({ enabled: false })
    expect(enabled.config.mcp?.issues).toMatchObject({ enabled: false })
    expect(marketplaceEnabledMcpNames(enabled.config, item.key)).toEqual([])

    const docs = setMarketplaceMcpEnabled(enabled.config, item.key, "docs", true)
    if (!docs.ok) throw new Error("Expected MCP toggle")
    expect(marketplaceMcpEnabled(docs.config, item.key, "docs")).toBe(true)
    expect(marketplaceEnabledMcpNames(docs.config, item.key)).toEqual(["docs"])
    expect(docs.config.mcp?.docs).not.toHaveProperty("enabled", false)
    expect(docs.config.mcp?.issues).toMatchObject({ enabled: false })
  })

  test("preserves component choices across marketplace updates", () => {
    const first = listing("1.0.0")
    first.item.install.skills = { items: [{ id: "review", name: "review", path: "skills/review" }] }
    const installed = installMarketplaceItem({}, first, { force: true })
    if (!installed.ok) throw new Error("Expected install")
    const skill = setMarketplaceSkillEnabled(installed.config, first.key, "review", false)
    if (!skill.ok) throw new Error("Expected skill toggle")
    const mcp = setMarketplaceMcpEnabled(skill.config, first.key, "docs", false)
    if (!mcp.ok) throw new Error("Expected MCP toggle")

    const next = listing("1.1.0")
    next.item.install.skills = {
      items: [
        { id: "review", name: "review", path: "skills/review" },
        { id: "release", name: "release", path: "skills/release" },
      ],
    }
    const updated = installMarketplaceItem(mcp.config, next, { force: true })
    if (!updated.ok) throw new Error("Expected update")
    expect(marketplaceSkillEnabled(updated.config, next.key, "review")).toBe(false)
    expect(marketplaceSkillEnabled(updated.config, next.key, "release")).toBe(true)
    expect(marketplaceMcpEnabled(updated.config, next.key, "docs")).toBe(false)
  })
})

describe("marketplace sources", () => {
  test("adds, disables, and removes catalogs while hiding an empty built-in source", () => {
    const source = createMarketplaceSource({ url: "github:example/catalog", trust: "community" })
    const added = upsertMarketplaceSource({}, source)
    expect(marketplaceSources(added).map((item) => item.id)).toEqual([source.id])
    expect(source.url).toBe("https://github.com/example/catalog.git")

    const disabled = toggleMarketplaceSource(added, source.id, false)
    expect(marketplaceSources(disabled).find((item) => item.id === source.id)?.enabled).toBe(false)

    const removed = removeMarketplaceSource(disabled, source.id)
    expect(marketplaceSources(removed).map((item) => item.id)).toEqual([])
    expect(removeMarketplaceSource(removed, OFFICIAL_MARKETPLACE_SOURCE.id)).toEqual(removed)
  })

  test("updates reactive configuration proxies used by the UI", () => {
    const config = new Proxy<MarketplaceHostConfig>({ plugin: ["existing-plugin"] }, {})
    const source = createMarketplaceSource({ url: "https://example.test/catalog.json", name: "Example" })
    const added = upsertMarketplaceSource(config, source)

    expect(added).not.toBe(config)
    expect(added.plugin).toEqual(["existing-plugin"])
    expect(marketplaceSources(added)).toContainEqual(source)
    expect(config.marketplace).toBeUndefined()
  })

  test("does not let configured catalogs spoof official or verified provenance", () => {
    const spoofed = upsertMarketplaceSource(
      {},
      {
        id: OFFICIAL_MARKETPLACE_SOURCE.id,
        name: "Not OpenCode",
        url: "https://evil.example/catalog.json",
        trust: "official",
      },
    )
    expect(marketplaceSources(spoofed)[0]).toEqual(OFFICIAL_MARKETPLACE_SOURCE)

    const legacy = upsertMarketplaceSource(spoofed, {
      id: "legacy-verified",
      name: "Legacy",
      url: "https://example.test/catalog.json",
      trust: "verified",
    })
    expect(marketplaceSources(legacy).find((source) => source.id === "legacy-verified")?.trust).toBe("community")
  })

  test("requires HTTPS except for loopback development catalogs", () => {
    expect(() => createMarketplaceSource({ url: "http://example.test/catalog.json" })).toThrow("must use HTTPS")
    expect(() => createMarketplaceSource({ url: "https://user:secret@example.test/catalog.json" })).toThrow(
      "cannot contain credentials",
    )
    expect(createMarketplaceSource({ url: "http://127.0.0.1:4096/catalog.json" }).url).toBe(
      "http://127.0.0.1:4096/catalog.json",
    )
    expect(createMarketplaceSource({ url: "https://example.test/catalog.json#ignored" }).url).toBe(
      "https://example.test/catalog.json",
    )
  })
})
