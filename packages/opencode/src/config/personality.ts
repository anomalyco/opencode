export * as ConfigPersonality from "./personality"

import path from "path"
import { Exit, Schema, SchemaGetter } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Glob } from "@opencode-ai/core/util/glob"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"
import { ConfigParse } from "./parse"
import { ConfigPermission } from "./permission"

const log = Log.create({ service: "config/personality" })

const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
])

const PersonalitySchema = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String.annotate({ description: "اسم الشخصية" }),
    model: Schema.optional(ConfigModelID).annotate({ description: "النموذج المستخدم" }),
    variant: Schema.optional(Schema.String).annotate({
      description: "Default model variant for this personality",
    }),
    temperature: Schema.optional(Schema.Finite).annotate({ description: "درجة الإبداع (0-1)" }),
    top_p: Schema.optional(Schema.Finite).annotate({ description: "Top-p sampling" }),
    prompt: Schema.optional(Schema.String).annotate({ description: "System prompt للشخصية" }),
    description: Schema.optional(Schema.String).annotate({ description: "وصف الشخصية ومتى تُستخدم" }),
    mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])).annotate({ description: "وضع التشغيل" }),
    hidden: Schema.optional(Schema.Boolean).annotate({
      description: "إخفاء هذه الشخصية من قائمة الاختيار",
    }),
    color: Schema.optional(Color).annotate({
      description: "لون الشخصية (hex أو theme color)",
    }),
    steps: Schema.optional(Schema.Finite).annotate({
      description: "أقصى عدد من الخطوات قبل التوقف",
    }),
    permission: Schema.optional(ConfigPermission.Info).annotate({ description: "قواعد الصلاحيات" }),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Any)).annotate({
      description: "خيارات إضافية مخصصة",
    }),
    traits: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "قائمة صفات الشخصية",
    }),
    learning_enabled: Schema.optional(Schema.Boolean).pipe(
      Schema.withDefaults(true),
    ).annotate({
      description: "تفعيل ميزة التعلم لهذه الشخصية",
    }),
    learning_file: Schema.optional(Schema.String).pipe(
      Schema.withDefaults("learnings.md"),
    ).annotate({
      description: "مسار ملف التعلم النسبي",
    }),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)

const KNOWN_KEYS = new Set([
  "name",
  "model",
  "variant",
  "prompt",
  "description",
  "temperature",
  "top_p",
  "mode",
  "hidden",
  "color",
  "steps",
  "options",
  "permission",
  "traits",
  "learning_enabled",
  "learning_file",
])

// Post-parse normalization
const normalize = (
  personality: Schema.Schema.Type<typeof PersonalitySchema>,
): Schema.Schema.Type<typeof PersonalitySchema> => {
  const options: Record<string, unknown> = { ...personality.options }
  for (const [key, value] of Object.entries(personality)) {
    if (!KNOWN_KEYS.has(key)) options[key] = value
  }

  return { ...personality, options }
}

export const Info = PersonalitySchema.pipe(
  Schema.decodeTo(PersonalitySchema, {
    decode: SchemaGetter.transform(normalize),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
).annotate({ identifier: "PersonalityConfig" })
export type Info = Schema.Schema.Type<typeof Info>

/**
 * تحميل الشخصيات من مجلد personalities/
 */
export async function load(dir: string) {
  const result: Record<string, Info> = {}

  // البحث في مجلدات personalities و personality
  for (const pattern of ["{personality,personalities}/**/*.md"]) {
    for (const item of await Glob.scan(pattern, {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch((err) => {
        log.error("failed to load personality", { personality: item, err })
        return undefined
      })
      if (!md) continue

      const name = configEntryNameFromPath(path.relative(dir, item), [
        "personality/",
        "personalities/",
      ])

      const config = {
        name,
        ...md.data,
        prompt: md.content.trim(),
        learning_enabled: md.data.learning_enabled ?? true,
        learning_file: md.data.learning_file ?? "learnings.md",
      }

      try {
        result[config.name] = ConfigParse.schema(Info, config, item)
      } catch (err) {
        log.error("failed to parse personality config", {
          personality: name,
          file: item,
          err,
        })
      }
    }
  }

  return result
}

/**
 * الحصول على مسار ملف التعلم للشخصية
 */
export function getLearningFilePath(
  baseDir: string,
  personalityName: string,
  learningFile: string = "learnings.md",
): string {
  return path.join(baseDir, ".opencode", "agents", personalityName, learningFile)
}
