import path from "path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { EntityRepo, EntityRepoError } from "../repo/entity"
import { EntityType } from "../schema/types"
import { ToolRuntime, ToolRuntimeError } from "./runtime"
import type { ToolEntityContent, ToolSignature } from "./types"

export class ToolRepoError extends Schema.TaggedErrorClass<ToolRepoError>()("ToolRepoError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

type ErrorUnion = ToolRepoError | ToolRuntimeError | EntityRepoError

const makeFilePath = (name: string) => path.join(process.cwd(), "tools", `${name}.ts`)

const writeFile = Effect.fn("ToolRepo.writeFile")(function* (filePath: string, code: string) {
  yield* Effect.tryPromise({
    try: () => Bun.write(filePath, code),
    catch: (cause) => new ToolRepoError({ message: `Failed to write tool file "${filePath}"`, cause }),
  })
})

const findEntity = Effect.fn("ToolRepo.findEntity")(function* <T>(list: T[], predicate: (item: T) => boolean) {
  const found = list.find(predicate)
  if (!found) return yield* new ToolRepoError({ message: "Tool not found" })
  return found
})

const toSignature = (entity: {
  name: string
  description: string | null
  content: Record<string, unknown> | null
}): ToolSignature => {
  const c = entity.content as unknown as ToolEntityContent | undefined
  return {
    name: entity.name,
    description: entity.description ?? "",
    input: c?.input_schema ?? {},
    output: c?.output_schema ?? {},
  }
}

export interface ToolRepoInterface {
  create(input: {
    name: string
    description: string
    input_schema: Record<string, string>
    output_schema: Record<string, string>
    code: string
  }): Effect.Effect<ToolSignature, ErrorUnion>

  get(name: string): Effect.Effect<Option.Option<ToolSignature>, ErrorUnion>

  list(): Effect.Effect<ToolSignature[], ErrorUnion>

  update(
    name: string,
    input: Partial<{
      description: string
      input_schema: Record<string, string>
      output_schema: Record<string, string>
      code: string
    }>,
  ): Effect.Effect<ToolSignature, ErrorUnion>

  delete(name: string): Effect.Effect<void, ErrorUnion>

  run(name: string, args: unknown): Effect.Effect<unknown, ErrorUnion>
}

export class ToolRepo extends Context.Service<ToolRepo, ToolRepoInterface>()("@opencode-ai/database/ToolRepo") {
  static layer = Layer.effect(
    ToolRepo,
    Effect.gen(function* () {
      const entities = yield* EntityRepo
      const runtime = yield* ToolRuntime

      return ToolRepo.of({
        create: Effect.fn("ToolRepo.create")(function* ({ name, description, input_schema, output_schema, code }) {
          const filePath = makeFilePath(name)
          yield* writeFile(filePath, code)

          yield* entities.create({
            type: EntityType.Tool,
            name,
            description,
            content: { file_path: filePath, input_schema, output_schema } as unknown as Record<string, unknown>,
          })

          return yield* runtime.register(name, filePath)
        }),

        get: Effect.fn("ToolRepo.get")(function* (name) {
          const list = yield* entities.list({ type: EntityType.Tool })
          const entity = Option.fromNullishOr(list.find((e) => e.name === name))
          if (Option.isNone(entity)) return Option.none() as Option.Option<ToolSignature>
          return Option.some(toSignature(entity.value))
        }),

        list: Effect.fn("ToolRepo.list")(function* () {
          const list = yield* entities.list({ type: EntityType.Tool })
          return list.map(toSignature)
        }),

        update: Effect.fn("ToolRepo.update")(function* (name, input) {
          const list = yield* entities.list({ type: EntityType.Tool })
          const entity = yield* findEntity(list, (e) => e.name === name)

          const filePath = makeFilePath(name)

          if (input.code) {
            yield* writeFile(filePath, input.code)
          }

          const oldContent = entity.content as unknown as ToolEntityContent | undefined
          const content: ToolEntityContent = {
            file_path: filePath,
            input_schema: input.input_schema ?? oldContent?.input_schema ?? {},
            output_schema: input.output_schema ?? oldContent?.output_schema ?? {},
          }

          yield* entities.update(entity.id, {
            description: input.description,
            content: content as unknown as Record<string, unknown>,
          })

          return yield* runtime.reload(name, filePath)
        }),

        delete: Effect.fn("ToolRepo.delete")(function* (name) {
          const list = yield* entities.list({ type: EntityType.Tool })
          const entity = list.find((e) => e.name === name)
          if (entity) {
            yield* entities.delete(entity.id)
          }
          yield* runtime.unregister(name)
        }),

        run: Effect.fn("ToolRepo.run")(function* (name, args) {
          const isRegistered = yield* runtime.isRegistered(name)
          if (!isRegistered) {
            const list = yield* entities.list({ type: EntityType.Tool })
            const entity = yield* findEntity(list, (e) => e.name === name)
            const content = entity.content as unknown as ToolEntityContent
            yield* runtime.register(name, content.file_path)
          }
          return yield* runtime.execute(name, args)
        }),
      })
    }),
  ).pipe(Layer.provide(EntityRepo.layer), Layer.provide(ToolRuntime.layer))
}
