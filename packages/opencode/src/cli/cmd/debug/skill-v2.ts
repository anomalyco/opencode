import { EOL } from "os"
import { Effect } from "effect"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { effectCmd } from "../../effect-cmd"

export const SkillV2Command = effectCmd({
  command: "skill-v2",
  describe: "list V2 skills (SkillV2) for the current directory; --watch reprints live",
  instance: false,
  builder: (yargs) =>
    yargs.option("watch", {
      type: "boolean",
      default: false,
      describe: "keep running and reprint the list every 2s, so edits to skill files show up live",
    }),
  handler: (args) =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      if (!args.watch) {
        process.stdout.write(JSON.stringify(yield* skill.list(), null, 2) + EOL)
        return
      }
      while (true) {
        const list = yield* skill.list()
        process.stdout.write(`\n[${new Date().toLocaleTimeString()}] ${list.length} skill(s):\n`)
        process.stdout.write(JSON.stringify(list, null, 2) + EOL)
        yield* Effect.sleep("2 seconds")
      }
    }).pipe(
      Effect.withSpan("Cli.debug.skillV2"),
      Effect.provide(
        LocationServiceMap.Service.get(
          Location.Ref.make({
            directory: AbsolutePath.make(process.cwd()),
          }),
        ),
      ),
      Effect.provide(locationServiceMapLayer),
    ),
})
