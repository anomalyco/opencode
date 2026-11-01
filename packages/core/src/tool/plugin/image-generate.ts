export * as ImageGenerateTool from "./image-generate.js"

import path from "path"
import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import { Identifier } from "@opencode/schema/identifier"
import { Global } from "@opencode/util/global"
import { Duration, Effect, Schema, Scope, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Generate } from "../../generate.js"
import { ImageNotice } from "../../image/notice.js"
import { Job } from "../../job.js"
import { Mime } from "../../mime.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"
import { collectBoundedResponseBody } from "../http-body.js"

export const name = "experimental_image_generate"
export const MAX_INPUT_BYTES = 20 * 1024 * 1024
const DOWNLOAD_TIMEOUT = Duration.seconds(30)
const GENERATE_TIMEOUT = Duration.minutes(30)
const INPUT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
}

export const description = [
  "Generates a new image, or edits existing ones.",
  "Only call this when the user asks you to create or edit an image. If you think an image would help but the user didn't ask for one, ask them first instead of generating it.",
  "Images you pass are used as the source to edit, or as references for style and subject.",
  "Each call makes one image. For several images, call it once per image.",
  "It runs in the background: the call starts a job and returns right away, and you are notified automatically when the image is saved, with its path. Never poll, sleep, or check for the file while you wait.",
  "Don't repeat a request unless the user asks.",
].join("\n")

export const Input = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "What to create, or for edits, what to change. Be specific about subject, style, composition and any text that should appear in the image.",
  }),
  images: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  ).annotate({
    description:
      "Images to edit, or to use as references for style and subject when creating a new image, in order. Local file paths (relative to the session directory or absolute) or http(s) URLs.",
  }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      'NEVER set this unless the user explicitly asks for a particular image model or variant. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look it up with the models tool using type: "image", filtering to your own provider first.',
  }),
  path: Schema.optionalKey(Schema.String).annotate({
    description:
      "Where to save the image, relative to the session directory or absolute. The extension is replaced with the image's real format, and an existing file is overwritten. Defaults to a new file in the session's temp folder.",
  }),
})

export const Output = Schema.Struct({
  id: Schema.String.annotate({ description: "The image job's ID, repeated in its completion notice" }),
  path: Schema.String.annotate({ description: "Where the image is saved, without its extension" }),
  model: Schema.String.annotate({ description: "providerID/modelID" }),
})

export const Plugin = {
  id: "opencode.tool.image-generate",
  effect: Effect.fn("ImageGenerateTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const generate = yield* Generate.Service
    const global = yield* Global.Service
    const http = yield* HttpClient.HttpClient
    const config = yield* Config.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const sessions = yield* Session.Service
    const models = yield* Model.Service
    const permission = yield* Permission.Service

    const resolveModel = Effect.fn("ImageGenerateTool.resolveModel")(function* (
      input: string | undefined,
      sessionID: SessionSchema.ID,
      images: boolean,
    ) {
      const available = yield* models.available(["image"])
      if (!input) {
        // A configured default is a preference: when it can't serve this call, pick automatically and say so.
        const configured = configuredModel(yield* config.entries())
        const preferred = configured
          ? available.find((model) => model.providerID === configured.providerID && model.id === configured.model)
          : undefined
        const variantMissing =
          configured?.variant !== undefined &&
          preferred !== undefined &&
          !preferred.variants.some((variant) => variant.id === configured.variant)
        if (preferred && !variantMissing && (!images || acceptsImages(preferred)))
          return { model: preferred, variant: configured?.variant }
        const providerID = (yield* ctx.session.get({ sessionID })).model?.providerID
        const model = defaultModel(available, { providerID, images })
        if (!model)
          return yield* new ToolFailure({
            message: images
              ? "None of the available image models accept input images."
              : "No image model is available.",
          })
        if (!configured) return { model }
        const ref = `${configured.providerID}/${configured.model}${configured.variant ? `#${configured.variant}` : ""}`
        const reason = !preferred
          ? "isn't available"
          : variantMissing
            ? `has no variant "${configured.variant}"`
            : "doesn't accept input images"
        return { model, note: ` ${ref} ${reason}; used ${model.providerID}/${model.id}.` }
      }
      const ref = yield* Effect.try({
        try: () => Model.Ref.parse(input),
        catch: () =>
          new ToolFailure({
            message: `Invalid model "${input}". Use "providerID/modelID" or "providerID/modelID#variant".`,
          }),
      })
      const model = available.find((model) => model.providerID === ref.providerID && model.id === ref.id)
      if (model === undefined)
        return yield* new ToolFailure({
          message: `Model "${ref.providerID}/${ref.id}" is not an available image model. Use the models tool with type: "image" to see what is available.`,
        })
      if (ref.variant !== undefined && !model.variants.some((variant) => variant.id === ref.variant))
        return yield* new ToolFailure({
          message:
            model.variants.length === 0
              ? `Model "${ref.providerID}/${ref.id}" has no variants. Omit the variant.`
              : `Variant "${ref.variant}" is not available for "${ref.providerID}/${ref.id}". Available: ${model.variants.map((variant) => variant.id).join(", ")}.`,
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
      return { model, variant: ref.variant }
    })

    const readImage = Effect.fn("ImageGenerateTool.readImage")(function* (
      source: string,
      context: FileAccess.Invocation,
      fetchAllowed: (url: string) => ReturnType<typeof permission.assert>,
    ) {
      const bytes = yield* readBytes(source, context, fetchAllowed)
      const mime = Mime.detect(bytes)
      if (!INPUT_TYPES.includes(mime))
        return yield* new ToolFailure({ message: `${source} is not a PNG, JPEG, WebP or GIF image.` })
      return { data: Buffer.from(bytes).toString("base64"), mime, name: path.basename(source) }
    })

    const readBytes = Effect.fn("ImageGenerateTool.readBytes")(function* (
      source: string,
      context: FileAccess.Invocation,
      fetchAllowed: (url: string) => ReturnType<typeof permission.assert>,
    ) {
      if (/^https?:\/\//i.test(source)) {
        // Downloads follow the same rule as the webfetch tool, so denying web access also covers image URLs.
        yield* fetchAllowed(source)
        return yield* Effect.gen(function* () {
          const response = yield* http
            .execute(HttpClientRequest.get(source))
            .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))
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

    const notifyWhenDone = Effect.fn("ImageGenerateTool.notifyWhenDone")(
      function* (input: { sessionID: SessionSchema.ID; id: string; notificationID: SessionMessage.ID; file: string }) {
        const info = (yield* jobs.wait({ id: input.id })).info
        if (!info || info.status === "running") return
        yield* sessions.synthetic({
          id: input.notificationID,
          sessionID: input.sessionID,
          description: "Image generation",
          text: ImageNotice.text({
            id: input.id,
            state: info.status,
            body:
              info.status === "completed"
                ? (info.output ?? "")
                : info.status === "error"
                  ? (info.error ?? `Image request failed for ${input.file}.`)
                  : `Image request for ${input.file} was cancelled.`,
          }),
          metadata: { source: name, jobID: input.id, state: info.status, path: input.file },
        })
        yield* jobs.completeBackground(input.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    // On by default. `experimental.image_generate: false` is still honored for configs from when the tool was opt-in;
    // permissions are the supported way to turn it off. Internal plugins are not re-run on config changes, so reload the
    // tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())

    // Registered only while an image model is available, re-evaluated whenever the catalog changes.
    // Subscribing before the first read keeps a change in between from being missed.
    const wanted = models.available(["image"]).pipe(Effect.map((available) => available.length > 0))
    let enabled = false
    const refresh = wanted.pipe(
      Effect.flatMap((next) => {
        if (next === enabled) return Effect.void
        enabled = next
        return ctx.tool.reload()
      }),
    )
    yield* ctx.event.subscribe({ types: ["model.updated"] }).pipe(
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    enabled = yield* wanted

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled || imageGenerate(loaded.entries) === false) return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              const resolved = yield* resolveModel(input.model, context.sessionID, input.images !== undefined)
              const model = resolved.model
              const variant = resolved.variant
              const ref = `${model.providerID}/${model.id}${variant ? `#${variant}` : ""}`
              const target = input.path ? yield* access.resolve({ path: input.path, kind: "file" }) : undefined
              // The extension the image is saved with follows its real format, whatever the requested path ends in.
              const stem = target
                ? target.absolute.slice(0, target.absolute.length - path.extname(target.absolute).length)
                : path.join(global.tmp, "images", context.sessionID, `image_${Identifier.create(false)}`)

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
                ? yield* Effect.forEach(input.images, (image) =>
                    readImage(image, context, (url) =>
                      permission.assert({
                        action: "webfetch",
                        resources: [url],
                        save: ["*"],
                        metadata: { url },
                        sessionID: context.sessionID,
                        agent: context.agent,
                        source,
                      }),
                    ),
                  )
                : undefined

              // Everything that needs the user or can fail fast happened above; the paid call runs as a background job.
              const run = Effect.gen(function* () {
                const result = yield* generate
                  .image({
                    model: Model.Ref.make({
                      providerID: model.providerID,
                      id: model.id,
                      ...(variant ? { variant } : {}),
                    }),
                    prompt: input.prompt,
                    n: 1,
                    ...(images ? { images } : {}),
                  })
                  .pipe(
                    Effect.timeoutOrElse({
                      duration: GENERATE_TIMEOUT,
                      orElse: () => Effect.fail(new Error("Image generation timed out after 30 minutes.")),
                    }),
                  )
                const image = result.images[0]
                if (!image) return yield* Effect.fail(new Error(`${ref} returned no image.`))
                const bytes = Buffer.from(image.data, "base64")
                const file = stem + (EXTENSIONS[Mime.detect(bytes)] ?? ".png")
                // The edit prompt covered the requested path. Replacing a different existing file needs its own
                // approval; a new file only has to pass the deny rules.
                if (target && file !== target.absolute) {
                  const actual = yield* access.resolve({ path: file, kind: "file" })
                  const replaces = yield* environment.files.stat(file).pipe(
                    Effect.as(true),
                    Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
                  )
                  const request = {
                    action: "edit",
                    resources: [actual.resource],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  }
                  yield* replaces ? permission.assert({ ...request, save: ["*"] }) : permission.assertNotDenied(request)
                }
                yield* environment.files.write(file, bytes)
                return `Image request finished. Saved image: ${file} (${ref}).\nUse the read tool on this path to view the image.`
              }).pipe(
                // The job keeps this text, so a restart can still deliver the outcome.
                Effect.mapError((error) => new Error(`Image request failed for ${stem}: ${error.message}`)),
              )
              const id = `image_${Identifier.create(false)}`
              const notificationID = SessionMessage.ID.create()
              yield* jobs.start({
                id,
                notificationID,
                type: name,
                title: input.prompt,
                metadata: { sessionID: context.sessionID, path: stem, model: ref },
                recovery: { kind: "image", sessionID: context.sessionID, path: stem, model: ref },
                run,
              })
              yield* jobs.background(id)
              yield* notifyWhenDone({ sessionID: context.sessionID, id, notificationID, file: stem })
              return {
                output: { id, path: stem, model: ref },
                content: [
                  `Image job ${id} started in the background with ${ref}. It will be saved as ${stem} with the extension of its real format (.png, .jpg, .webp or .gif); the notice gives the exact path.${resolved.note ?? ""}`,
                  "You will be notified automatically when it finishes or fails.",
                  "DO NOT sleep, poll, check whether the file exists, or request the same image again while it runs.",
                  "Work on other tasks, or briefly tell the user what you started and end your response.",
                ].join("\n"),
                metadata: { path: stem, model: ref, jobID: id },
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

/** The newest image model from the session's provider, otherwise the newest available one. */
export function defaultModel(
  available: readonly Model.Info[],
  input: { readonly providerID?: string; readonly images: boolean },
) {
  const candidates = input.images ? available.filter(acceptsImages) : available
  return candidates.find((model) => model.providerID === input.providerID) ?? candidates[0]
}

// Read per field so a later config that sets other experimental options doesn't hide this one.
function imageGenerate(entries: readonly Entry[]) {
  return entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.image_generate !== undefined,
  )?.info.experimental?.image_generate
}

function configuredModel(entries: readonly Entry[]) {
  const value = imageGenerate(entries)
  return typeof value === "object" ? value.model : undefined
}

function acceptsImages(model: Model.Info) {
  return model.capabilities.input.some((item) => item.startsWith("image"))
}
