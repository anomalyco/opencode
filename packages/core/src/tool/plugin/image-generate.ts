export * as ImageGenerateTool from "./image-generate.js"

import path from "path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Identifier } from "@opencode/schema/identifier"
import type { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { Duration, Effect, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Generate } from "../../generate.js"
import { Mime } from "../../mime.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { collectBoundedResponseBody } from "../http-body.js"

export const name = "image_generate"
export const MAX_INPUT_BYTES = 20 * 1024 * 1024
const DOWNLOAD_TIMEOUT = Duration.seconds(30)
const GENERATE_TIMEOUT = Duration.minutes(5)
const INPUT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
}
// Families tried in order when the session's provider has no image model, before falling back to the newest.
const PREFERRED_FAMILIES = ["gpt-image", "gemini-flash", "gemini-pro", "grok", "flux"]

export const description =
  'Generate or edit an image. Pass images to edit them or to guide style and subject. To make several images, call the tool once per image with distinct prompts. Omit model to use the default; to choose one, find image models with the models tool and type: "image". The result is saved as a PNG and shown to you; mention its path to the user. Each call costs money, so don\'t regenerate unless asked or the result is clearly wrong.'

export const Input = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "What to create, or for edits, what to change. Be specific about subject, style, composition and any text that should appear in the image.",
  }),
  images: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  ).annotate({
    description:
      "Images to edit or use as references, in order. Local file paths (relative to the session directory or absolute) or https URLs. Omit to create a new image.",
  }),
  aspect: Schema.optionalKey(Schema.Literals(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"])).annotate({
    description:
      "Shape of the image. 1:1 for icons and avatars, 16:9 for banners and screenshots, 9:16 for phone screens, 3:2 or 2:3 for photos. Defaults to the model's choice.",
  }),
  resolution: Schema.optionalKey(Schema.Literals(["1K", "2K"])).annotate({
    description:
      "Size tier. 1K is about 1024x1024 pixels. Use 2K only when small text or fine detail matters; it is slower and costs more. Defaults to the model's choice.",
  }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      'NEVER set this unless the user asks for a particular image model. Written as "providerID/modelID". Do not guess the ID: look it up with the models tool using type: "image".',
  }),
  path: Schema.optionalKey(Schema.String).annotate({
    description:
      "Where to save the PNG, relative to the session directory or absolute. Never overwrites. Defaults to a new file in the session's temp folder.",
  }),
})

export const Output = Schema.Struct({
  path: Schema.String,
  model: Schema.String.annotate({ description: "providerID/modelID" }),
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
})

export const Plugin = {
  id: "opencode.tool.image-generate",
  effect: Effect.fn("ImageGenerateTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const generate = yield* Generate.Service
    const global = yield* Global.Service
    const http = yield* HttpClient.HttpClient
    const models = yield* Model.Service
    const permission = yield* Permission.Service

    const resolveModel = Effect.fn("ImageGenerateTool.resolveModel")(function* (
      input: string | undefined,
      sessionID: Session.ID,
      images: boolean,
    ) {
      const available = yield* models.available(["image"])
      if (!input) {
        const providerID = (yield* ctx.session.get({ sessionID })).model?.providerID
        const model = defaultModel(available, { providerID, images })
        if (model) return model
        return yield* new ToolFailure({
          message: images ? "None of the available image models accept input images." : "No image model is available.",
        })
      }
      const ref = yield* Effect.try({
        try: () => Model.Ref.parse(input),
        catch: () => new ToolFailure({ message: `Invalid model "${input}". Use "providerID/modelID".` }),
      })
      const model = available.find((model) => model.providerID === ref.providerID && model.id === ref.id)
      if (model === undefined)
        return yield* new ToolFailure({
          message: `Model "${ref.providerID}/${ref.id}" is not an available image model. Use the models tool with type: "image" to see what is available.`,
        })
      if (images && !acceptsImages(model)) {
        const capable = available.filter(acceptsImages).slice(0, 3)
        return yield* new ToolFailure({
          message:
            capable.length === 0
              ? `Model "${ref.providerID}/${ref.id}" does not accept input images, and no available image model does.`
              : `Model "${ref.providerID}/${ref.id}" does not accept input images. Image models that do: ${capable.map((model) => `${model.providerID}/${model.id}`).join(", ")}.`,
        })
      }
      return model
    })

    const readImage = Effect.fn("ImageGenerateTool.readImage")(function* (
      source: string,
      context: FileAccess.Invocation,
    ) {
      const bytes = yield* readBytes(source, context)
      const mime = Mime.detect(bytes)
      if (!INPUT_TYPES.includes(mime))
        return yield* new ToolFailure({ message: `${source} is not a PNG, JPEG, WebP or GIF image.` })
      return { data: Buffer.from(bytes).toString("base64"), mime, name: path.basename(source) }
    })

    const readBytes = Effect.fn("ImageGenerateTool.readBytes")(function* (
      source: string,
      context: FileAccess.Invocation,
    ) {
      if (/^https?:\/\//i.test(source)) {
        if (!source.toLowerCase().startsWith("https://"))
          return yield* new ToolFailure({ message: `Image URLs must use https: ${source}` })
        return yield* Effect.gen(function* () {
          const response = yield* http
            .execute(HttpClientRequest.get(source))
            .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))
          const type = (response.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? ""
          if (!INPUT_TYPES.includes(type))
            return yield* new ToolFailure({
              message: `${source} is not a PNG, JPEG, WebP or GIF image (${type || "no content type"}).`,
            })
          return yield* collectBoundedResponseBody(
            response,
            MAX_INPUT_BYTES,
            () => new ToolFailure({ message: `${source} is larger than 20 MiB.` }),
          )
        }).pipe(
          Effect.timeoutOrElse({
            duration: DOWNLOAD_TIMEOUT,
            orElse: () => Effect.fail(new ToolFailure({ message: `Timed out downloading ${source}.` })),
          }),
          Effect.mapError((error) =>
            error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to download ${source}`, error }),
          ),
        )
      }
      const target = yield* access.authorizeRead(source, context)
      const info = yield* environment.files
        .stat(target.absolute)
        .pipe(Effect.catchTag("Environment.NotFound", () => new ToolFailure({ message: `File not found: ${source}` })))
      if (info.size > MAX_INPUT_BYTES) return yield* new ToolFailure({ message: `${source} is larger than 20 MiB.` })
      return (yield* environment.files.read(target.absolute)).bytes
    })

    const exists = (file: string) =>
      environment.files.stat(file).pipe(
        Effect.as(true),
        Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
      )

    // Registered only while an image model is available, and re-evaluated whenever the model catalog changes.
    // Subscribing before the first read keeps a change in between from being missed.
    let enabled = false
    const refresh = models.available(["image"]).pipe(
      Effect.flatMap((available) => {
        if (available.length > 0 === enabled) return Effect.void
        enabled = available.length > 0
        return ctx.tool.reload()
      }),
    )
    yield* ctx.event.subscribe({ types: ["model.updated"] }).pipe(
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    enabled = (yield* models.available(["image"])).length > 0

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled) return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              const model = yield* resolveModel(input.model, context.sessionID, input.images !== undefined)
              const ref = `${model.providerID}/${model.id}`
              const target = input.path ? yield* access.resolve({ path: input.path, kind: "file" }) : undefined
              const requested =
                target?.absolute ??
                path.join(global.tmp, "images", context.sessionID, `image_${Identifier.create(false)}.png`)
              if (yield* exists(requested))
                return yield* new ToolFailure({ message: `${requested} already exists. Choose a new path.` })

              yield* permission.assert({
                action: name,
                resources: [ref],
                save: ["*"],
                metadata: { ...input, model: ref },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              if (target) {
                yield* access.authorizeExternal([target], context)
                yield* permission.assert({
                  action: "edit",
                  resources: [target.resource],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              }
              const images = input.images
                ? yield* Effect.forEach(input.images, (image) => readImage(image, context))
                : undefined

              const result = yield* generate
                .image({
                  model: Model.Ref.make({ providerID: model.providerID, id: model.id }),
                  prompt: input.prompt,
                  n: 1,
                  ...(images ? { images } : {}),
                  ...(input.aspect ? { aspect: input.aspect } : {}),
                  ...(input.resolution ? { resolution: input.resolution } : {}),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Image generation failed: ${error.message}`, error }),
                  ),
                  Effect.timeoutOrElse({
                    duration: GENERATE_TIMEOUT,
                    orElse: () =>
                      Effect.fail(new ToolFailure({ message: "Image generation timed out after 5 minutes." })),
                  }),
                )
              const image = result.images[0]
              if (!image) return yield* new ToolFailure({ message: `${ref} returned no image.` })
              const bytes = Buffer.from(image.data, "base64")
              const mime = Mime.detect(bytes)
              // Providers may return JPEG or WebP; core has no encoder, so the file keeps its real type.
              const extension = EXTENSIONS[mime] ?? path.extname(requested)
              const file =
                path.extname(requested).toLowerCase() === extension
                  ? requested
                  : path.join(path.dirname(requested), path.basename(requested, path.extname(requested)) + extension)
              if (yield* exists(file))
                return yield* new ToolFailure({ message: `${file} already exists. Choose a new path.` })
              yield* environment.files.write(file, bytes)
              const size = dimensions(bytes, mime)
              const note =
                file === requested ? "" : ` The model returned ${mime}, so it was saved with a ${extension} extension.`
              return {
                output: { path: file, model: ref, ...size },
                content: [
                  {
                    type: "text" as const,
                    text: `Saved ${size ? `${size.width}x${size.height} ` : ""}image to ${file} (${ref}).${note}`,
                  },
                  { type: "file" as const, uri: `data:${mime};base64,${image.data}`, mime, name: file },
                ],
                metadata: { path: file, model: ref },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to generate image", error }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

/** Same provider as the session first, then preferred families, then the newest. */
export function defaultModel(
  available: readonly Model.Info[],
  input: { readonly providerID?: string; readonly images: boolean },
) {
  const candidates = input.images ? available.filter(acceptsImages) : available
  const own = candidates.filter((model) => model.providerID === input.providerID)
  const pool = own.length > 0 ? own : candidates
  return PREFERRED_FAMILIES.flatMap((family) => pool.find((model) => model.family === family) ?? [])[0] ?? pool[0]
}

function acceptsImages(model: Model.Info) {
  return model.capabilities.input.some((item) => item.startsWith("image"))
}

/** Reads pixel dimensions from the image header. */
export function dimensions(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime === "image/png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) }
  if (mime === "image/gif" && bytes.length >= 10)
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  if (mime === "image/webp" && bytes.length >= 31) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16))
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === "VP8X")
      return {
        width: (view.getUint32(24, true) & 0xffffff) + 1,
        height: (view.getUint32(27, true) & 0xffffff) + 1,
      }
  }
  if (mime === "image/jpeg") {
    let offset = 2
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      offset += 2 + view.getUint16(offset + 2)
    }
  }
  return undefined
}
