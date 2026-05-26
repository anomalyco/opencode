import { Context, Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export interface Interface {
  readonly getSpecificationTemplate: (type: string, inventionType: string) => Effect.Effect<string>
  readonly getClaimsTemplate: (type: string) => Effect.Effect<string>
  readonly getOATemplate: () => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentTemplate") {}

const templateContent = {
  specification: "[Patent Specification Template - Content will be added in Task 11]",
  claims: "[Patent Claims Template - Content will be added in Task 11]",
  oa: "[Office Action Response Template - Content will be added in Task 11]",
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const getSpecificationTemplate = Effect.fn("PatentTemplate.getSpecificationTemplate")(
      function* (type: string, inventionType: string) {
        const templatePath = `templates/specification-${type}-${inventionType}.txt`
        const content = yield* fs
          .readFileString(templatePath)
          .pipe(Effect.catch(() => Effect.succeed(templateContent.specification)))
        return content
      },
    )

    const getClaimsTemplate = Effect.fn("PatentTemplate.getClaimsTemplate")(function* (type: string) {
      const templatePath = `templates/claims-${type}.txt`
      const content = yield* fs.readFileString(templatePath).pipe(Effect.catch(() => Effect.succeed(templateContent.claims)))
      return content
    })

    const getOATemplate = Effect.fn("PatentTemplate.getOATemplate")(function* () {
      const templatePath = "templates/oa.txt"
      const content = yield* fs.readFileString(templatePath).pipe(Effect.catch(() => Effect.succeed(templateContent.oa)))
      return content
    })

    return Service.of({ getSpecificationTemplate, getClaimsTemplate, getOATemplate })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as PatentTemplate from "./template"