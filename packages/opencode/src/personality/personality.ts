import { Effect, Context, Layer, Option } from "effect"
import { serviceUse } from "@/effect/service-use"
import path from "path"
import fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { ConfigPersonality } from "@/config/personality"

export interface Interface {
  readonly getLearningFile: (personalityName: string) => Effect.Effect<string>
  readonly appendLearning: (params: {
    personalityName: string
    lesson: string
    date?: string
  }) => Effect.Effect<void>
  readonly readLearnings: (personalityName: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Personality") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const result: Interface = {
      getLearningFile: Effect.fn("Personality.getLearningFile")(function* (personalityName: string) {
        const learningPath = path.join(Global.Path.data, "agents", personalityName, "learnings.md")
        
        // Ensure directory exists
        yield* Effect.promise(() => fs.mkdir(path.dirname(learningPath), { recursive: true }))
        
        // Create file if it doesn't exist
        try {
          yield* Effect.promise(() => fs.access(learningPath))
        } catch {
          const template = `# تعلمت شخصية ${personalityName}

## الدروس المستفادة

هذا الملف يحتوي على جميع الدروس والتعلميات التي اكتسبتها شخصية ${personalityName} من خلال التفاعلات والأخطاء السابقة.

---

## كيفية إضافة درس جديد

أضف قسمًا جديدًا بالتنسيق التالي:

\`\`\`markdown
## [YYYY-MM-DD] عنوان الدرس

- وصف الخطأ أو الموقف
- ما تم تعلمه منه
- كيف سيتم تجنبه في المستقبل
\`\`\`
`
          yield* Effect.promise(() => fs.writeFile(learningPath, template, "utf-8"))
        }
        
        return learningPath
      }),

      appendLearning: Effect.fn("Personality.appendLearning")(function* (params: {
        personalityName: string
        lesson: string
        date?: string
      }) {
        const learningPath = yield* result.getLearningFile(params.personalityName)
        const content = yield* Effect.promise(() => fs.readFile(learningPath, "utf-8"))
        
        const date = params.date ?? new Date().toISOString().split("T")[0]
        const newSection = `\n---\n\n## [${date}] درس جديد\n\n${params.lesson}\n`
        
        yield* Effect.promise(() => fs.appendFile(learningPath, newSection, "utf-8"))
      }),

      readLearnings: Effect.fn("Personality.readLearnings")(function* (personalityName: string) {
        const learningPath = yield* result.getLearningFile(personalityName)
        return yield* Effect.promise(() => fs.readFile(learningPath, "utf-8"))
      }),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer
