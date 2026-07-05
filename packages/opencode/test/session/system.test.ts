import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationError, LocationServices } from "@opencode-ai/core/location-services"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { Provider } from "../../src/provider/provider"
import { MCP } from "../../src/mcp"
import { testEffect } from "../lib/effect"

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
  {
    name: "manual-skill",
    location: "/tmp/manual-skill/SKILL.md",
    content: "# manual-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  LayerNode.compile(SystemPrompt.node, [
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        instructions: () =>
          Effect.succeed([
            {
              name: "guide-server",
              instructions: "Use lookup before mutate.",
              tools: [],
            },
            {
              name: "tool-server",
              instructions: "Prefer search before update.",
              tools: ["tool-server_search", "tool-server_update"],
            },
          ]),
      }),
    ],
    [
      Skill.node,
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          require: (name) => {
            const info = skills.find((skill) => skill.name === name)
            if (info) return Effect.succeed(info)
            return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((skill) => skill.name) }))
          },
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ],
  ]),
)

describe("session.system", () => {
  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
      expect(output).not.toContain("manual-skill")
    }),
  )

  it.effect("MCP output includes connected server instructions", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build)

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          '  <server name="tool-server">',
          "    Prefer search before update.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )

  it.effect("MCP output omits servers when all advertised tools are denied", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const output = yield* prompt.mcp(build, Permission.fromConfig({ "tool-server_*": "deny" }))

      expect(output).toBe(
        [
          "<mcp_instructions>",
          '  <server name="guide-server">',
          "    Use lookup before mutate.",
          "  </server>",
          "</mcp_instructions>",
        ].join("\n"),
      )
    }),
  )
})

// Regression test for #35427: SystemPrompt.environment() must not crash the
// request when the location-services layer fails to boot (e.g. when a session
// references a directory that no longer exists). The references block should
// degrade to empty rather than propagate the Die defect.
describe("session.system (degraded location layer)", () => {
  // Build a LocationServiceMap layer where get(ref) returns a layer that fails
  // to construct.  This mimics what happens when a stored session directory no
  // longer exists on disk — the location-service layer boots and hits ENOENT.
  // A minimal LayerMap that makes get() always return a layer that dies.
  // The Die defect propagates through the catchCause in environment().
  const failingLocationsLayer = Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          Layer.effect(
            Location.Service,
            Effect.fail(new Error("simulated location layer boot failure")),
          ),
        { idleTimeToLive: "1 minute" },
      )
    }) as unknown as Effect.Effect<LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>>,
  )

  const it2 = testEffect(
    LayerNode.compile(SystemPrompt.node, [
      [LocationServiceMap.node, failingLocationsLayer],
      [
        MCP.node,
        Layer.mock(MCP.Service, {
          instructions: () => Effect.succeed([]),
        }),
      ],
      [
        Skill.node,
        Layer.succeed(
          Skill.Service,
          Skill.Service.of({
            get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
            require: (name) => {
              const info = skills.find((skill) => skill.name === name)
              if (info) return Effect.succeed(info)
              return Effect.fail(new Skill.NotFoundError({ name, available: skills.map((skill) => skill.name) }))
            },
            all: () => Effect.succeed(skills),
            dirs: () => Effect.succeed([]),
            available: () => Effect.succeed(skills),
          }),
        ),
      ],
    ]),
  )

  it2.instance("environment() succeeds when location layer fails to boot", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      // Cast: only providerID and api.id are read by environment()
      const model = { providerID: "test", api: { id: "test-model" } } as unknown as Provider.Model
      const parts = yield* prompt.environment(model)

      // Should still produce the env block, but skip references gracefully.
      expect(parts.some((p) => p.includes("<env>"))).toBe(true)
      expect(parts.some((p) => p.includes("<available_references>"))).toBe(false)
    }),
  )
})
