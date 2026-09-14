export * as ConfigCompatibilityPlugin from "./compatibility.js"

import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect, FiberMap, PubSub, Semaphore, Stream } from "effect"
import { Config } from "../../config.js"
import { Watcher } from "../../filesystem/watcher.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"
import { SkillFile } from "./skill-file.js"

export const Plugin = define({
  id: "opencode.config.compatibility",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const watcher = yield* Watcher.Service
    const watches = yield* FiberMap.make<string>()
    const changes = yield* PubSub.sliding<string>(1)
    const lock = Semaphore.makeUnsafe(1)
    const skills: Skill.Info[] = []

    const watch = Effect.fn("ConfigCompatibilityPlugin.watch")(function* (
      target: string,
      type: "file" | "directory",
    ) {
      const updates = yield* watcher.subscribe({ path: target, type })
      yield* FiberMap.run(
        watches,
        `${type}:${target}`,
        updates.pipe(Stream.runForEach((update) => PubSub.publish(changes, update.path).pipe(Effect.asVoid))),
        { onlyIfMissing: true, startImmediately: true },
      )
    })

    const refresh = Effect.fn("ConfigCompatibilityPlugin.refresh")(
      function* () {
        yield* FiberMap.clear(watches)
        const roots = config.compatibility ? yield* config.compatibility() : { claude: [], agents: [] }
        const directories = [...roots.claude, ...roots.agents].map((root) => path.join(root, "skills"))
        const loaded = new Map<Skill.ID, Skill.Info>()
        for (const directory of directories) {
          const resolved = yield* fs.realPath(directory).pipe(Effect.orElseSucceed(() => undefined))
          if (!resolved) continue
          yield* watch(resolved, "directory")
          const files = yield* fs
            .scan("{*.md,**/SKILL.md}", { cwd: resolved, absolute: true, include: "file", symlink: true, dot: true })
            .pipe(Effect.orElseSucceed(() => [] as string[]))
          for (const filepath of files.toSorted()) {
            const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))
            if (!content) continue
            const parsed = SkillFile.parse(resolved, filepath, content)
            if (parsed._tag === "Parsed") loaded.set(parsed.skill.id, parsed.skill)
          }
        }
        skills.splice(0, skills.length, ...loaded.values())
      },
      (effect) => lock.withPermit(effect),
    )

    const reload = refresh().pipe(Effect.andThen(ctx.skill.reload()))
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* config.changes().pipe(
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()
    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })
  }),
})
