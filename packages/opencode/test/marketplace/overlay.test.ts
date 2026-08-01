import { describe, expect, test } from "bun:test"
import type { MarketplaceInstallPlan, MarketplaceState } from "@opencode-ai/core/marketplace"
import { composeMarketplaceConfig, decomposeMarketplaceConfig } from "@/marketplace/overlay"

const now = "2026-07-29T00:00:00.000Z"

function state(
  entries: Array<{ key: string; version: string; plan: MarketplaceInstallPlan; priority?: number }>,
): MarketplaceState {
  return {
    revision: 3,
    installed: Object.fromEntries(
      entries.map(({ key, version, plan, priority }, index) => [
        key,
        {
          source: "community",
          catalog: "tools",
          item: key,
          name: key,
          kind: "bundle" as const,
          version,
          fingerprint: `${key}-${version}`,
          installed_at: now,
          updated_at: now,
          plan,
          active_plan: plan,
          receipt: {},
          enabled: true,
          publisher: `Publisher ${index}`,
          ...(priority === undefined ? {} : { priority }),
        },
      ]),
    ),
  }
}

describe("marketplace runtime overlay", () => {
  test("projects installed plans without changing the base config", () => {
    const base = {
      plugin: ["example-plugin@1.0.0"],
      command: { keep: { template: "keep" } },
      mcp: { docs: { type: "remote", url: "https://user.example/mcp" } },
    }
    const registry = state([
      {
        key: "review",
        version: "2.0.0",
        plan: {
          plugins: ["example-plugin@2.0.0"],
          skills: { paths: ["/artifacts/review/skills"] },
          commands: { review: { template: "review" } },
          mcp: { docs: { type: "remote", url: "https://package.example/mcp" } },
        },
      },
    ])

    const effective = composeMarketplaceConfig(base, registry)
    expect(effective.plugin).toEqual(["example-plugin@2.0.0"])
    expect(effective.command).toEqual({ keep: { template: "keep" }, review: { template: "review" } })
    expect(effective.mcp?.docs).toEqual({ type: "remote", url: "https://package.example/mcp" })
    expect(effective.skills?.paths).toEqual(["/artifacts/review/skills"])
    expect(base).toEqual({
      plugin: ["example-plugin@1.0.0"],
      command: { keep: { template: "keep" } },
      mcp: { docs: { type: "remote", url: "https://user.example/mcp" } },
    })
    expect(decomposeMarketplaceConfig(effective, base, registry)).toEqual(base)
  })

  test("preserves explicit user edits while removing unchanged overlay values", () => {
    const base = { mcp: { docs: { type: "remote", url: "https://user.example/mcp" } } }
    const registry = state([
      {
        key: "review",
        version: "1.0.0",
        plan: { mcp: { docs: { type: "remote", url: "https://package.example/mcp" } } },
      },
    ])
    const effective = composeMarketplaceConfig(base, registry)
    effective.mcp = { docs: { type: "remote", url: "https://edited.example/mcp" } }

    expect(decomposeMarketplaceConfig(effective, base, registry)).toEqual({
      mcp: { docs: { type: "remote", url: "https://edited.example/mcp" } },
    })
  })

  test("automatically reveals the previous provider when packages are removed", () => {
    const base = { command: { review: { template: "user" } } }
    const first = {
      key: "first",
      version: "1.0.0",
      plan: { commands: { review: { template: "first" } } },
    }
    const second = {
      key: "second",
      version: "1.0.0",
      plan: { commands: { review: { template: "second" } } },
    }

    expect(composeMarketplaceConfig(base, state([first, second])).command?.review).toEqual({ template: "second" })
    expect(composeMarketplaceConfig(base, state([first])).command?.review).toEqual({ template: "first" })
    expect(composeMarketplaceConfig(base, state([])).command?.review).toEqual({ template: "user" })
  })

  test("uses explicit package priority instead of insertion order", () => {
    const low = { key: "low", version: "1.0.0", priority: 1, plan: { commands: { review: { template: "low" } } } }
    const high = { key: "high", version: "1.0.0", priority: 10, plan: { commands: { review: { template: "high" } } } }

    expect(composeMarketplaceConfig({}, state([high, low])).command?.review).toEqual({ template: "high" })
  })
})
