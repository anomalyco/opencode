import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@kancode/core/agent"
import { AppNodeBuilder } from "@kancode/core/effect/app-node-builder"
import { LayerNode } from "@kancode/core/effect/layer-node"
import { FSUtil } from "@kancode/core/fs-util"
import { AbsolutePath } from "@kancode/core/schema"
import { SkillV2 } from "@kancode/core/skill"
import { SkillDiscovery } from "@kancode/core/skill/discovery"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const urls = new Map<string, AbsolutePath[]>()
let pulls = 0
const discovery = Layer.succeed(
  SkillDiscovery.Service,
  SkillDiscovery.Service.of({
    pull: (url) => {
      pulls++
      return Effect.succeed(urls.get(url) ?? [])
    },
  }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([SkillV2.node, AgentV2.node]), [[SkillDiscovery.node, discovery]]),
)

function write(directory: string, name: string, description: string) {
  return fs.writeFile(
    path.join(directory, name, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---
# ${name}`,
  )
}

describe("SkillV2", () => {
  it.live("registers sources and resolves later source precedence", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "review"), { recursive: true })
            await fs.mkdir(path.join(second, "review"), { recursive: true })
            await write(first, "review", "First")
            await write(second, "review", "Second")
            await fs.writeFile(path.join(first, "foo.md"), "---\nslash: true\n---\n# foo")
          })

          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => {
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(second) })
            expect(editor.list()).toEqual([
              { type: "directory", path: AbsolutePath.make(first) },
              { type: "directory", path: AbsolutePath.make(second) },
            ])
          })

          expect(yield* skill.sources()).toEqual([
            { type: "directory", path: AbsolutePath.make(first) },
            { type: "directory", path: AbsolutePath.make(second) },
          ])
          expect(yield* skill.list()).toEqual([
            SkillV2.Info.make({
              name: "foo",
              slash: true,
              location: AbsolutePath.make(path.join(first, "foo.md")),
              content: "# foo",
            }),
            {
              name: "review",
              description: "Second",
              location: AbsolutePath.make(path.join(second, "review", "SKILL.md")),
              content: "# review",
            },
          ])
        }),
      ),
    ),
  )

  it.live("loads URL sources and filters skills for agents", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "deploy"), { recursive: true })
            await write(tmp.path, "deploy", "Deploy production")
          })
          pulls = 0
          urls.set("https://example.test/skills/", [AbsolutePath.make(tmp.path)])

          const agents = yield* AgentV2.Service
          yield* agents.transform((editor) =>
            editor.update(AgentV2.ID.make("reviewer"), (agent) => {
              agent.permissions.push({ action: "skill", resource: "deploy", effect: "deny" })
            }),
          )

          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => editor.source({ type: "url", url: "https://example.test/skills/" }))

          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect(pulls).toBe(1)
          expect(SkillV2.available(yield* skill.list(), (yield* agents.get(AgentV2.ID.make("reviewer")))!)).toEqual([])
        }),
      ),
    ),
  )

  describe("origin", () => {
    // Sanity: path.sep is the only separator used by origin(), so the same
    // expected substrings work on both posix and win32.
    const sep = path.sep

    it.effect("returns '' for the built-in sentinel (part of KanCode)", () =>
      Effect.sync(() => {
        expect(SkillV2.origin("<built-in>")).toBe("")
      }),
    )

    it.effect("returns the external dir label for project and global skill paths", () =>
      Effect.sync(() => {
        const cases: Array<[string, string]> = [
          [path.join("/home", "me", ".claude", "skills", "agent-browser", "SKILL.md"), ".claude"],
          [path.join("/proj", ".agents", "skills", "deploy", "SKILL.md"), ".agents"],
          [path.join("/proj", ".cursor", "skills", "rules", "SKILL.md"), ".cursor"],
          [path.join("/proj", ".codex", "skills", "rules", "SKILL.md"), ".codex"],
          [path.join("/proj", ".kilo", "skills", "rules", "SKILL.md"), ".kilo"],
          [path.join("/proj", ".opencode", "skills", "rules", "SKILL.md"), ".opencode"],
          // Legacy OpenCode layout under .opencode uses skill/ (singular).
          [path.join("/proj", ".opencode", "skill", "rules", "SKILL.md"), ".opencode"],
        ]
        for (const [loc, expected] of cases) {
          expect(SkillV2.origin(loc)).toBe(expected)
        }
      }),
    )

    it.effect("returns '' for .kancode, config-dir, and custom skills.paths locations", () =>
      Effect.sync(() => {
        const cases = [
          path.join("/proj", ".kancode", "skill", "rules", "SKILL.md"),
          path.join("/proj", ".kancode", "skills", "rules", "SKILL.md"),
          // Pulled-from-URL skills land under a cache hash dir; not an external dir.
          path.join("/home", "me", ".cache", "kancode", "skills", "1a2b3c", "deploy", "SKILL.md"),
          // Arbitrary custom skills.paths location.
          path.join("/abs", "custom", "skills", "deploy", "SKILL.md"),
        ]
        for (const loc of cases) {
          expect(SkillV2.origin(loc)).toBe("")
        }
        // Sanity that sep-based assertions actually exercised a real separator.
        expect(sep).toBeTruthy()
      }),
    )
  })
})
