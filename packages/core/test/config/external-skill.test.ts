import fs from "fs/promises"
import nodeFs from "node:fs"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ConfigExternalSkillPlugin } from "@opencode-ai/core/config/plugin/external-skill"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const it = testEffect(Layer.empty)

function writeSkill(dir: string, name: string) {
  return fs.mkdir(path.join(dir, name), { recursive: true }).then(() =>
    fs.writeFile(
      path.join(dir, name, "SKILL.md"),
      `---
name: ${name}
description: ${name} skill
---
# ${name}`,
    ),
  )
}

describe("ConfigExternalSkillPlugin.Plugin", () => {
  it.live("registers global and project .claude/.agents skill directories", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (home) => Effect.promise(() => home[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((home) =>
        Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (project) => Effect.promise(() => project[Symbol.asyncDispose]()),
        ).pipe(
          Effect.flatMap((project) =>
            Effect.gen(function* () {
              const globalClaude = path.join(home.path, ".claude", "skills")
              const globalAgents = path.join(home.path, ".agents", "skills")
              const projectClaude = path.join(project.path, ".claude", "skills")
              const projectAgents = path.join(project.path, ".agents", "skills")
              yield* Effect.promise(async () => {
                await writeSkill(globalClaude, "global-claude")
                await writeSkill(globalAgents, "global-agents")
                await writeSkill(projectClaude, "project-claude")
                await writeSkill(projectAgents, "project-agents")
              })

              const sources: SkillV2.Source[] = []
              const transform = Effect.fnUntraced(function* (
                update: (draft: SkillV2.Draft) => void | Effect.Effect<void>,
              ) {
                const result = update({
                  source: (source) => {
                    sources.push(source)
                  },
                  list: () => sources,
                })
                if (Effect.isEffect(result)) yield* result
                return { dispose: Effect.sync(() => (sources.length = 0)) }
              })

              yield* ConfigExternalSkillPlugin.Plugin.effect(
                host({
                  skill: { transform, reload: () => Effect.void },
                }),
              ).pipe(
                Effect.provideService(
                  Global.Service,
                  Global.Service.of({ ...Global.make(), home: home.path }),
                ),
                Effect.provideService(
                  Location.Service,
                  Location.Service.of(location({ directory: AbsolutePath.make(project.path) })),
                ),
                Effect.provideService(
                  FSUtil.Service,
                  FSUtil.Service.of({
                    isDir: (p: string) => Effect.succeed(nodeFs.statSync(p).isDirectory()),
                    up: ({ targets, start, stop }: { targets: string[]; start: string; stop?: string }) =>
                      Effect.sync(() => {
                        const result: string[] = []
                        let current = start
                        while (true) {
                          for (const target of targets) {
                            const search = path.join(current, target)
                            try {
                              if (nodeFs.statSync(search).isDirectory()) result.push(search)
                            } catch {
                              // ignore
                            }
                          }
                          if (stop === current) break
                          const parent = path.dirname(current)
                          if (parent === current) break
                          current = parent
                        }
                        return result
                      }),
                  } as unknown as FSUtil.Interface),
                ),
              )

              expect(
                sources
                  .filter((s): s is Extract<typeof s, { type: "directory" }> => s.type === "directory")
                  .map((s) => String(s.path))
                  .toSorted(),
              ).toEqual([globalClaude, globalAgents, projectClaude, projectAgents].toSorted())
            }),
          ),
        ),
      ),
    ),
  )
})
