import { EOL } from "os"
import { Effect } from "effect"
import { Skill } from "../../../skill"
import { effectCmd } from "../../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"

export const SkillCommand = effectCmd({
  command: "skill",
  describe: "list all available skills",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.skill")(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const skill = yield* Skill.Service
      const skills = yield* skill.all()
      process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})
