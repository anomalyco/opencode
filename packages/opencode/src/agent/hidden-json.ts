import { jsonSchema, streamText, tool, type ModelMessage, wrapLanguageModel } from "ai"
import { ProviderTransform } from "@/provider"
import type { Provider } from "@/provider"
import { LLM } from "@/session/llm"
import z from "zod"

type Language = Parameters<typeof wrapLanguageModel>[0]["model"]

export type HiddenJSONModel = {
  model: Provider.Model
  language: Language
  options: Record<string, unknown>
  temperature?: number
  prompt?: string
  oauth?: boolean
}

function bad(err: unknown) {
  if (!(err instanceof Error)) return false
  if (err.name === "AI_APICallError") return true
  if (err.message.includes("AI_APICallError: Bad Request")) return true
  return "statusCode" in err && err.statusCode === 400
}

function call(
  cfg: HiddenJSONModel,
  messages: ModelMessage[],
  tools?: Record<string, ReturnType<typeof tool>>,
  toolChoice?: "required",
) {
  const next = LLM.applyBoundary({
    system: cfg.prompt ? [cfg.prompt] : [],
    messages,
    options: cfg.options,
    oauth: !!cfg.oauth,
  })
  return streamText({
    model: wrapLanguageModel({
      model: cfg.language,
      middleware: [
        {
          specificationVersion: "v3" as const,
          async transformParams(args) {
            if (args.type === "stream") {
              // @ts-expect-error
              args.params.prompt = ProviderTransform.message(args.params.prompt, cfg.model, next.options)
            }
            return args.params
          },
        },
      ],
    }),
    messages: next.messages,
    ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
    ...(Object.keys(next.options).length === 0
      ? {}
      : { providerOptions: ProviderTransform.providerOptions(cfg.model, next.options) }),
    maxRetries: 0,
    tools: tools ?? {},
    ...(toolChoice ? { toolChoice } : {}),
  })
}

async function text<S extends z.ZodTypeAny>(input: { cfg: HiddenJSONModel; messages: ModelMessage[]; schema: S }) {
  const result = await call(input.cfg, input.messages)
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error
  }
  return input.schema.parse(JSON.parse(await result.text))
}

async function structured<S extends z.ZodTypeAny>(input: {
  cfg: HiddenJSONModel
  messages: ModelMessage[]
  schema: S
  toolDescription?: string
}) {
  let out: z.infer<S> | undefined
  const schema = ProviderTransform.schema(input.cfg.model, z.toJSONSchema(input.schema))
  const { $schema, ...toolSchema } = schema

  const result = await call(
    input.cfg,
    input.messages,
    {
      StructuredOutput: tool({
        description: input.toolDescription ?? "Return the JSON payload in the required schema.",
        inputSchema: jsonSchema(toolSchema as any),
        execute: async (args: unknown) => {
          out = input.schema.parse(args)
          return { ok: true }
        },
      } as any),
    },
    "required",
  )

  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error
  }

  if (out !== undefined) return out
  return input.schema.parse(JSON.parse(await result.text))
}

async function once<S extends z.ZodTypeAny>(input: {
  cfg: HiddenJSONModel
  messages: ModelMessage[]
  schema: S
  toolDescription?: string
}) {
  if (input.cfg.model.capabilities.toolcall) {
    try {
      return await structured(input)
    } catch (err) {
      if (!bad(err)) throw err
    }
  }

  return text(input)
}

export async function runHiddenJSON<S extends z.ZodTypeAny>(input: {
  model: HiddenJSONModel | HiddenJSONModel[]
  messages: ModelMessage[]
  schema: S
  toolDescription?: string
}) {
  const list = Array.isArray(input.model) ? input.model : [input.model]
  let last: unknown
  for (const cfg of list) {
    try {
      const output = await once({
        cfg,
        messages: input.messages,
        schema: input.schema,
        toolDescription: input.toolDescription,
      })
      return { output, model: cfg.model }
    } catch (err) {
      if (!bad(err)) throw err
      last = err
    }
  }
  throw last ?? new Error("hidden json call failed")
}
