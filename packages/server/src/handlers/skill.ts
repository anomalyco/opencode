import { Skill } from "@opencode/core/skill"
import { FileNotFoundError, SkillLoadError, SkillNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers
    .handle("skill.list", () => response(Skill.Service.use((skill) => skill.list())))
    .handle("skill.file", (ctx) =>
      Effect.gen(function* () {
        const skills = yield* Skill.Service
        // The path after /api/experimental/skill/<id>/file/.
        const raw = new URL(ctx.request.url, "http://localhost").pathname.split("/").slice(6).join("/")
        const notFound = new FileNotFoundError({ path: raw, message: `File not found: ${raw}` })
        const file = yield* Effect.try({
          try: () => Skill.parseFilePath(decodeURIComponent(raw)),
          catch: () => notFound,
        })
        if (!file) return yield* notFound
        return yield* skills.read(ctx.params.skillID, file).pipe(
          Effect.catchTags({
            "Skill.NotFoundError": (error) =>
              Effect.fail(
                new SkillNotFoundError({ skill: ctx.params.skillID, message: `Skill not found: ${error.skill}` }),
              ),
            "Skill.FileNotFoundError": (error) =>
              Effect.fail(new FileNotFoundError({ path: error.file, message: `File not found: ${error.file}` })),
            "Skill.LoadError": (error) =>
              Effect.fail(new SkillLoadError({ skill: ctx.params.skillID, message: error.message })),
          }),
        )
      }),
    ),
)
