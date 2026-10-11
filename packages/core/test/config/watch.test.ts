import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import type { ConfigDiscovery } from "@opencode/core/config/discovery"
import { ConfigWatch } from "@opencode/core/config/watch"
import { AbsolutePath } from "@opencode/core/schema"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/tmpdir"

const it = testEffect(AppNodeBuilder.build(FSUtil.node))

const project = path.resolve("watch-plan-project")
const root = AbsolutePath.make(path.join(project, ".opencode"))
const sources: ConfigDiscovery.Sources = {
  direct: ["opencode.json", "opencode.jsonc"].map((name) => AbsolutePath.make(path.join(project, name))),
  project: [{ path: root, present: false }],
  claude: [AbsolutePath.make(path.join(project, ".claude"))],
  agents: [AbsolutePath.make(path.join(project, ".agents"))],
}

describe("ConfigWatch.plan", () => {
  for (const source of ["global", "direct", "project", "explicit"] as const) {
    it.live(`watches the target of a symlinked ${source} config even when dangling`, () =>
      Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const directory = AbsolutePath.make(path.join(tmp.path, "config"))
            const file = AbsolutePath.make(path.join(directory, "opencode.json"))
            const target = path.join(tmp.path, "dotfiles", "target.json")
            const input: ConfigDiscovery.Sources = {
              direct: source === "direct" ? [file] : [],
              project: source === "project" ? [{ path: directory, present: true }] : [],
              claude: [],
              agents: [],
              global: source === "global" ? directory : undefined,
              explicit: source === "explicit" ? file : undefined,
            }
            yield* Effect.promise(async () => {
              await fs.mkdir(directory)
              await fs.mkdir(path.dirname(target))
              await fs.writeFile(target, "{}")
              await fs.symlink(path.relative(directory, target), file)
            })
            const present = yield* ConfigWatch.plan(input)
            expect(Array.from(present.values())).toContainEqual({
              path: path.dirname(target),
              type: "entries",
              names: ["target.json"],
            })
            yield* Effect.promise(() => fs.rm(target))
            expect(yield* ConfigWatch.plan(input)).toEqual(present)

            yield* Effect.promise(async () => {
              await fs.unlink(file)
              await fs.symlink("../dotfiles/replacement.json", file)
            })
            const retargeted = Array.from((yield* ConfigWatch.plan(input)).values())
            expect(retargeted).toContainEqual({ path: path.dirname(target), type: "entries", names: ["replacement.json"] })
            expect(retargeted).not.toContainEqual({ path: path.dirname(target), type: "entries", names: ["target.json"] })
          }),
        ),
      ),
    )
  }

  it.live("groups missing candidates and keeps parent watches when roots appear", () =>
    Effect.gen(function* () {
      const missing = yield* ConfigWatch.plan(sources)
      expect(Array.from(missing.values())).toEqual([
        {
          path: project,
          type: "entries",
          names: [".agents", ".claude", ".opencode", "opencode.json", "opencode.jsonc"],
        },
      ])
      const present = yield* ConfigWatch.plan({ ...sources, project: [{ path: root, present: true }] })
      expect(Array.from(present.values())).toEqual([
        { path: root, type: "directory", ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"] },
        ...missing.values(),
      ])
    }),
  )

  it.live("adds exact watches for explicit files only when not already covered", () =>
    Effect.gen(function* () {
      expect(yield* ConfigWatch.plan({ ...sources, explicit: sources.direct[0] })).toEqual(
        yield* ConfigWatch.plan(sources),
      )
      const present = { ...sources, project: [{ path: root, present: true }] }
      expect(
        yield* ConfigWatch.plan({ ...present, explicit: AbsolutePath.make(path.join(root, "custom.json")) }),
      ).toEqual(yield* ConfigWatch.plan(present))
      const directory = path.resolve("watch-plan-external")
      expect(
        Array.from(
          (yield* ConfigWatch.plan({
            ...sources,
            explicit: AbsolutePath.make(path.join(directory, "custom.json")),
          })).values(),
        ),
      ).toContainEqual({ path: directory, type: "entries", names: ["custom.json"] })
    }),
  )
})
