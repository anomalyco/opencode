import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { McpSkillPlugin } from "@opencode/core/plugin/mcp-skill"
import { Mcp } from "@opencode/core/mcp/index"
import { Skill } from "@opencode/core/skill"
import { testEffect } from "./lib/effect"

// Regression: State replays every registered transform on each rebuild, so a producer that calls
// `ctx.skill.transform` once per sync stacks one registration per sync. The stale registrations keep
// re-adding skills a later sync withdrew, and the registry never converges. The producer must
// register exactly once and let that transform read its current state.
const digest = (input: string) => `sha256:${new Bun.CryptoHasher("sha256").update(input).digest("hex")}`

const document = (name: string) => `---\nname: ${name}\ndescription: Use ${name}.\n---\n\n# ${name}\n\nBody.\n`

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Skill.node])))

describe("McpSkillPlugin transform registration", () => {
  it.effect("registers one transform and withdraws cleanly across syncs", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const content = document("review")
      const uri = "skill://review/SKILL.md"
      let connected = true
      let registered = 0

      const mcp = Layer.succeed(
        Mcp.Service,
        Mcp.Service.of({
          transform: () => Effect.succeed({ dispose: Effect.void }),
          reload: () => Effect.void,
          servers: () =>
            Effect.succeed([
              { name: "docs", status: { status: connected ? ("connected" as const) : ("disabled" as const) } },
            ]),
          add: () => Effect.void,
          connect: () => Effect.void,
          disconnect: () => Effect.void,
          remove: () => Effect.void,
          tools: () => Effect.succeed([]),
          callTool: () => Effect.die("unused"),
          instructions: () => Effect.succeed([]),
          prompts: () => Effect.succeed([]),
          prompt: () => Effect.undefined,
          resourceCatalog: () => Effect.succeed(Mcp.ResourceCatalog.make({ resources: [], templates: [] })),
          resources: () => Effect.succeed(Mcp.ResourceCatalog.make({ resources: [], templates: [] })),
          readResource: () =>
            Effect.succeed(
              Mcp.ResourceContent.make({
                server: "docs",
                uri,
                contents: [{ type: "text", uri, text: content }],
              }),
            ),
          skills: () =>
            connected
              ? Effect.succeed([
                  {
                    uri,
                    name: "review",
                    description: "Use review.",
                    files: [{ uri, digest: digest(content), size: content.length }],
                  },
                ])
              : Effect.succeed([]),
        }),
      )

      // SAFETY: every member the producer reads is supplied below; the cast only drops host
      // members it never touches.
      const context = {
        event: { subscribe: () => Stream.empty },
        skill: {
          transform: (fn: (editor: Skill.Editor) => void) => {
            registered++
            return skill.transform(fn)
          },
          reload: skill.reload,
        },
      } as never

      yield* McpSkillPlugin.Plugin.effect(context).pipe(Effect.provide(mcp))

      // One registration, and the skill is present because the sync path really ran.
      expect(registered).toBe(1)
      expect((yield* skill.list()).map((item) => String(item.id))).toEqual(["mcp:docs:review"])

      // Rebuilds replay the single transform rather than registering another. `published` is the
      // producer's own state, so a rebuild alone does not withdraw anything: only a sync observes
      // the server, and that is what the event-driven test below covers.
      yield* skill.reload()
      yield* skill.reload()

      expect(registered).toBe(1)
      expect((yield* skill.list()).map((item) => String(item.id))).toEqual(["mcp:docs:review"])
    }),
  )

  it.effect("drains a status-change stream through the forked subscription", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const content = document("review")
      const uri = "skill://review/SKILL.md"
      let registered = 0
      let syncs = 0

      const mcp = Layer.succeed(
        Mcp.Service,
        Mcp.Service.of({
          transform: () => Effect.succeed({ dispose: Effect.void }),
          reload: () => Effect.void,
          servers: () => Effect.succeed([{ name: "docs", status: { status: "connected" as const } }]),
          add: () => Effect.void,
          connect: () => Effect.void,
          disconnect: () => Effect.void,
          remove: () => Effect.void,
          tools: () => Effect.succeed([]),
          callTool: () => Effect.die("unused"),
          instructions: () => Effect.succeed([]),
          prompts: () => Effect.succeed([]),
          prompt: () => Effect.undefined,
          resourceCatalog: () => Effect.succeed(Mcp.ResourceCatalog.make({ resources: [], templates: [] })),
          resources: () => Effect.succeed(Mcp.ResourceCatalog.make({ resources: [], templates: [] })),
          readResource: () =>
            Effect.succeed(
              Mcp.ResourceContent.make({
                server: "docs",
                uri,
                contents: [{ type: "text", uri, text: content }],
              }),
            ),
          skills: () =>
            Effect.succeed([
              {
                uri,
                name: "review",
                description: "Use review.",
                files: [{ uri, digest: digest(content), size: content.length }],
              },
            ]),
        }),
      )

      // SAFETY: every member the producer reads is supplied below; the cast only drops host
      // members it never touches.
      const context = {
        event: { subscribe: () => Stream.make({ type: "mcp.status.changed" }, { type: "mcp.status.changed" }) },
        skill: {
          transform: (fn: (editor: Skill.Editor) => void) => {
            registered++
            return skill.transform(fn)
          },
          reload: () => Effect.sync(() => void syncs++),
        },
      } as never

      yield* McpSkillPlugin.Plugin.effect(context).pipe(Effect.provide(mcp))
      // Let the forked fiber drain the two events it was handed.
      yield* TestClock.adjust("1 second")

      // Three reloads: the initial sync plus one per status change. All of them ran, and the
      // producer still holds a single registration. `reload` is stubbed here to count syncs, so the
      // registry is not rebuilt by the event path; `list()` is read against the real Skill service.
      expect(syncs).toBe(3)
      expect(registered).toBe(1)
    }),
  )
})
