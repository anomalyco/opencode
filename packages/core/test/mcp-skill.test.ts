import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { McpSkillPlugin } from "@opencode/core/plugin/mcp-skill"
import { Mcp } from "@opencode/core/mcp/index"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { testEffect } from "./lib/effect"

// A served skill enters the same registry as a filesystem one, so the skill tool and the skill
// guidance need no knowledge of its origin. These tests drive the real producer against a stub MCP
// service, so the digest, length, and origin handling are the production code paths.
const digest = (input: string) => `sha256:${new Bun.CryptoHasher("sha256").update(input).digest("hex")}`

const document = (name: string) => `---\nname: ${name}\ndescription: Use ${name}.\n---\n\n# ${name}\n\nBody.\n`

const served = {
  uri: "skill://review/SKILL.md",
  name: "review",
  description: "Use review.",
  content: document("review"),
}

function mcpLayer(input: {
  readonly skills: ReadonlyArray<{
    readonly uri: string
    readonly name: string
    readonly description?: string
    readonly content: string
    readonly digest?: string
    readonly size?: number
    readonly connected?: boolean
  }>
  readonly contents?: ReadonlyArray<{ readonly uri: string; readonly text: string }>
}) {
  const listed = input.skills.map((skill) => {
    const entry = {
      uri: skill.uri,
      name: skill.name,
      files: [
        {
          uri: skill.uri,
          digest: skill.digest ?? digest(skill.content),
          size: skill.size ?? skill.content.length,
        },
        { uri: `${skill.uri.replace(/SKILL\.md$/, "")}reference.md`, digest: digest("ref"), size: 3 },
      ],
    }
    if (skill.description !== undefined) return { ...entry, description: skill.description }
    return entry
  })
  return Layer.succeed(
    Mcp.Service,
    Mcp.Service.of({
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
      servers: () =>
        Effect.succeed(
          input.skills.some((skill) => skill.connected === false)
            ? [{ name: "docs", status: { status: "disabled" as const } }]
            : [{ name: "docs", status: { status: "connected" as const } }],
        ),
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
      readResource: (request) => {
        const part =
          input.contents?.find((item) => item.uri === request.uri) ??
          input.skills.flatMap((skill) =>
            skill.uri === request.uri ? [{ uri: skill.uri, text: skill.content }] : [],
          )[0]
        if (!part) return Effect.succeed(undefined)
        return Effect.succeed(
          Mcp.ResourceContent.make({
            server: "docs",
            uri: part.uri,
            contents: [{ type: "text", uri: part.uri, text: part.text }],
          }),
        )
      },
      skills: () => Effect.succeed(listed),
    }),
  )
}

// The producer's effect needs only `ctx.skill` and an event stream, so the tests hand it the real
// Skill service and an empty stream rather than standing up the whole plugin host. The context is
// cast because the plugin declares the full host surface it does not use here.
const register = (skill: Skill.Interface) => {
  // SAFETY: every member the producer reads is supplied in the object below; the cast only drops
  // the host members it never touches.
  const context = {
    event: { subscribe: () => Stream.empty },
    skill: {
      transform: (fn: (editor: Skill.Editor) => void) => skill.transform(fn),
      reload: skill.reload,
    },
  } as never
  return McpSkillPlugin.Plugin.effect(context)
}

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Skill.node])))

describe("McpSkillPlugin", () => {
  it.effect("registers a served skill under an id namespaced by server", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* register(skill)
      const listed = yield* skill.list()
      expect(listed).toHaveLength(1)
      expect(String(listed[0].id)).toBe("mcp:docs:review")
      expect(String(listed[0].name)).toBe("review")
      expect(listed[0].description).toBe("Use review.")
      // The synthetic path must never be scanned, and origin must point at the resource URIs.
      expect(listed[0].origin).toEqual({
        type: "mcp",
        server: "docs",
        uri: "skill://review/SKILL.md",
        files: ["skill://review/reference.md"],
      })
    }).pipe(Effect.provide(mcpLayer({ skills: [served] }))),
  )

  it.effect("refuses a skill whose content does not match the published digest", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* register(skill)
      expect(yield* skill.list()).toEqual([])
    }).pipe(Effect.provide(mcpLayer({ skills: [{ ...served, digest: `sha256:${"0".repeat(64)}` }] }))),
  )

  it.effect("refuses a skill whose length does not match the published size", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      yield* register(skill)
      expect(yield* skill.list()).toEqual([])
    }).pipe(Effect.provide(mcpLayer({ skills: [{ ...served, size: served.content.length + 1 }] }))),
  )
})

describe("Skill.toModelOutput", () => {
  it.effect("reports a base directory for a filesystem skill", () =>
    Effect.sync(() => {
      const output = Skill.toModelOutput(
        Skill.Info.make({
          id: Skill.ID.make("review"),
          name: Skill.Name.make("review"),
          path: AbsolutePath.make("/skills/review/SKILL.md"),
          content: "# review",
        }),
        ["/skills/review/notes.md"],
      )
      expect(output).toContain("Base directory for this skill: /skills/review")
      expect(output).toContain("are relative to this base directory.")
    }),
  )

  it.effect("reports resource URIs rather than a base directory for a served skill", () =>
    Effect.sync(() => {
      const output = Skill.toModelOutput(
        Skill.Info.make({
          id: Skill.ID.make("mcp:docs:review"),
          name: Skill.Name.make("review"),
          path: AbsolutePath.make("/mcp/docs/review/SKILL.md"),
          content: "# review",
          origin: Skill.McpOrigin.make({
            type: "mcp",
            server: "docs",
            uri: "skill://review/SKILL.md",
            files: ["skill://review/reference.md"],
          }),
        }),
        ["skill://review/reference.md"],
      )
      // Naming the synthetic path as a base directory would send the model after files on disk
      // that do not exist, so a served skill points at resource URIs instead.
      expect(output).not.toContain("Base directory")
      expect(output).toContain('served by the MCP server "docs"')
      expect(output).toContain("<file>skill://review/reference.md</file>")
    }),
  )
})

const testContext = {
  event: { subscribe: () => Stream.empty },
}
