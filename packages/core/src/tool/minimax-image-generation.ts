export * as MiniMaxImageGenerationTool from "./minimax-image-generation"

import { ToolFailure } from "@opencode-ai/llm"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { collectBoundedResponseBody } from "./http-body"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "minimax_image_generation"
export const GLOBAL_ENDPOINT = "https://api.minimax.io/v1/image_generation"
export const CN_ENDPOINT = "https://api.minimaxi.com/v1/image_generation"
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024
export const TIMEOUT_SECONDS = 120

export const Region = Schema.Literals(["global_en", "cn_zh"])
export type Region = typeof Region.Type

export interface Config {
  readonly apiKey?: string
  readonly region: Region
}

export class ConfigService extends Context.Service<ConfigService, Config>()("@opencode/v2/MiniMaxImageConfig") {}

export const defaultConfigLayer = Layer.sync(ConfigService, () =>
  ConfigService.of({
    apiKey: process.env.MINIMAX_API_KEY,
    region: process.env.MINIMAX_API_REGION === "cn_zh" ? "cn_zh" : "global_en",
  }),
)

export const configNode = makeLocationNode({ service: ConfigService, layer: defaultConfigLayer, deps: [] })

export const endpoint = (region: Region) => (region === "cn_zh" ? CN_ENDPOINT : GLOBAL_ENDPOINT)

export const Model = Schema.Literals(["image-01", "image-01-live"])
export const ResponseFormat = Schema.Literals(["url", "base64"])
const AspectRatio = Schema.Literals(["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"])

const Dimension = Schema.Int.check(Schema.isBetween({ minimum: 512, maximum: 2048 }))

export const Input = Schema.Struct({
  model: Schema.optional(Model).annotate({ description: "Image model. Defaults to image-01." }),
  prompt: Schema.String.annotate({ description: "Image description, up to 1500 characters." }),
  aspectRatio: Schema.optional(AspectRatio),
  width: Schema.optional(Dimension).annotate({ description: "Image width from 512 to 2048, divisible by 8." }),
  height: Schema.optional(Dimension).annotate({ description: "Image height from 512 to 2048, divisible by 8." }),
  responseFormat: Schema.optional(ResponseFormat).annotate({
    description: "Return temporary URLs or base64 image data. URLs expire after 24 hours.",
  }),
  seed: Schema.optional(Schema.Int),
  n: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(9))),
  promptOptimizer: Schema.optional(Schema.Boolean),
})

const Request = Schema.Struct({
  model: Model,
  prompt: Schema.String,
  aspect_ratio: Schema.optional(AspectRatio),
  width: Schema.optional(Dimension),
  height: Schema.optional(Dimension),
  response_format: ResponseFormat,
  seed: Schema.optional(Schema.Int),
  n: PositiveInt.check(Schema.isLessThanOrEqualTo(9)),
  prompt_optimizer: Schema.Boolean,
})

const Count = Schema.Union([Schema.Int, Schema.String])
const Response = Schema.Struct({
  data: Schema.Struct({
    image_urls: Schema.optional(Schema.Array(Schema.String)),
    image_base64: Schema.optional(Schema.Array(Schema.String)),
  }),
  metadata: Schema.optional(
    Schema.Struct({
      success_count: Schema.optional(Count),
      failed_count: Schema.optional(Count),
    }),
  ),
  base_resp: Schema.Struct({
    status_code: Schema.Int,
    status_msg: Schema.optional(Schema.String),
  }),
})
const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(Response))

const Output = Schema.Struct({
  region: Region,
  model: Model,
  responseFormat: ResponseFormat,
  images: Schema.Array(Schema.String),
  successCount: Schema.Int,
  failedCount: Schema.Int,
})

const mime = (data: string) => {
  if (data.startsWith("iVBOR")) return { type: "image/png", extension: "png" }
  if (data.startsWith("/9j/")) return { type: "image/jpeg", extension: "jpg" }
  if (data.startsWith("UklGR")) return { type: "image/webp", extension: "webp" }
  return { type: "application/octet-stream", extension: "bin" }
}

const number = (value: string | number | undefined, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

const validate = (input: typeof Input.Type) => {
  if (input.prompt.length === 0 || input.prompt.length > 1500) return Effect.fail(new Error("Invalid prompt length"))
  if ((input.width === undefined) !== (input.height === undefined))
    return Effect.fail(new Error("Width and height must be set together"))
  if ((input.width !== undefined && input.width % 8 !== 0) || (input.height !== undefined && input.height % 8 !== 0))
    return Effect.fail(new Error("Width and height must be divisible by 8"))
  return Effect.void
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const http = yield* HttpClient.HttpClient
    const config = yield* ConfigService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Generate images from a text prompt with MiniMax. Supports global and China deployments configured by MINIMAX_API_REGION.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) =>
            output.responseFormat === "url"
              ? [{ type: "text", text: output.images.join("\n") }]
              : output.images.map((data, index) => {
                  const media = mime(data)
                  return {
                    type: "file" as const,
                    data,
                    mime: media.type,
                    name: `minimax-image-${index + 1}.${media.extension}`,
                  }
                }),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* validate(input)
              const apiKey = config.apiKey
              if (!apiKey) return yield* Effect.fail(new Error("MiniMax API key is not configured"))
              const model = input.model ?? "image-01"
              const responseFormat = input.responseFormat ?? "url"
              yield* permission.assert({
                action: name,
                resources: [input.prompt],
                save: ["*"],
                metadata: { ...input, model, responseFormat, region: config.region },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const request = yield* HttpClientRequest.post(endpoint(config.region)).pipe(
                HttpClientRequest.bearerToken(apiKey),
                HttpClientRequest.schemaBodyJson(Request)({
                  model,
                  prompt: input.prompt,
                  aspect_ratio: input.aspectRatio,
                  width: input.width,
                  height: input.height,
                  response_format: responseFormat,
                  seed: input.seed,
                  n: input.n ?? 1,
                  prompt_optimizer: input.promptOptimizer ?? false,
                }),
              )
              const response = yield* HttpClient.filterStatusOk(http).execute(request)
              const body = yield* collectBoundedResponseBody(
                response,
                MAX_RESPONSE_BYTES,
                () => new Error(`Image response exceeded ${MAX_RESPONSE_BYTES} bytes`),
              )
              const payload = yield* decodeResponse(new TextDecoder().decode(body))
              if (payload.base_resp.status_code !== 0) return yield* Effect.fail(new Error("Image generation failed"))
              const images = responseFormat === "base64" ? payload.data.image_base64 : payload.data.image_urls
              if (!images || images.length === 0)
                return yield* Effect.fail(new Error("Image generation returned no images"))
              return {
                region: config.region,
                model,
                responseFormat,
                images,
                successCount: number(payload.metadata?.success_count, images.length),
                failedCount: number(payload.metadata?.failed_count, 0),
              }
            }).pipe(
              Effect.timeout(Duration.seconds(TIMEOUT_SECONDS)),
              Effect.mapError(() => new ToolFailure({ message: "Unable to generate images" })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/minimax-image-generation",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, LayerNodePlatform.httpClient, configNode],
})
