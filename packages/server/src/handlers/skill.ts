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
        const id = ctx.params.skillID
        // The path after /api/experimental/skill/<id>/file/.
        const raw = new URL(ctx.request.url, "http://localhost").pathname.split("/").slice(6).join("/")
        const file = yield* Effect.try({
          try: () => decodeURIComponent(raw),
          catch: () => new FileNotFoundError({ path: raw, message: `File not found: ${raw}` }),
        })
        if (!(yield* skills.get(id)))
          return yield* new SkillNotFoundError({ skill: id, message: `Skill not found: ${id}` })
        const value = yield* (file === "SKILL.md" ? skills.content(id) : skills.file(id, file)).pipe(
          Effect.mapError((error) => new SkillLoadError({ skill: id, message: error.message })),
        )
        if (value === undefined) return yield* new FileNotFoundError({ path: file, message: `File not found: ${file}` })
        return typeof value === "string" ? new TextEncoder().encode(value) : value
      }),
    ),
)
