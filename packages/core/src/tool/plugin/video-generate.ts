export * as VideoGenerateTool from "./video-generate.js"

import path from "path"
import { Media, ToolFailure, VideoAspectRatio } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import type { VideoID } from "@opencode/schema/generate"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Schema, Scope, Stream } from "effect"
import { toolFailure } from "../runtime.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { BlobStore } from "../../blob-store.js"
import { Job } from "../../job.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { BackgroundResult } from "../../session/background-result.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"
import { VideoGeneration } from "../../video-generation.js"

export const name = "generate_video"
export const MAX_INPUT_BYTES = 100 * 1024 * 1024
const CHUNK = 4 * 1024 * 1024
const URL_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
}

export const description = [
  "Generates a video from a prompt, optionally starting or ending on given images and guided by reference images, videos or audio.",
  "Only call this when the user asks for a video: videos are slow and expensive.",
  "It runs in the background, and you are notified with every saved file when it finishes. Never poll, sleep, or check for the file while you wait.",
].join("\n")

const source = Schema.String.check(Schema.isMinLength(1))

export const Input = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "What happens in the video. Describe the subject, action, camera movement, style and, when sound is on, any dialogue or sound.",
  }),
  start: Schema.optionalKey(source).annotate({
    description:
      "Image the video starts on exactly. A local file path (relative to the session directory or absolute) or an http(s) URL.",
  }),
  end: Schema.optionalKey(source).annotate({
    description: "Image the video ends on exactly. A local file path or an http(s) URL.",
  }),
  references: Schema.optionalKey(Schema.Array(source).check(Schema.isMinLength(1))).annotate({
    description:
      "Images, videos or audio that guide the subject, style, motion or voice without being shown as-is. Local file paths or http(s) URLs.",
  }),
  duration: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Length in seconds.",
  }),
  aspect: Schema.optionalKey(Schema.String).annotate({
    description: 'Aspect ratio as "width:height", such as "16:9" or "9:16", or "auto" to follow the start image.',
  }),
  resolution: Schema.optionalKey(Schema.String).annotate({
    description: 'Output resolution, such as "480p", "720p", "1080p" or "4k".',
  }),
  sound: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Whether the video has generated sound. Unset uses the model's default.",
  }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      'NEVER set this unless the user explicitly asks for a particular video model. The value is written as "providerID/modelID". Do not guess the ID: look it up with the models tool using type: "video", filtering to your own provider first.',
  }),
  path: Schema.optionalKey(Schema.String).annotate({
    description:
      "Where to save the video, relative to the session directory or absolute, usually ending in .mp4. An existing file is overwritten. Further videos from the same job go next to it with -1, -2, … before the extension. Defaults to a new file in the session's temp folder.",
  }),
})

export const Output = Schema.String

/** The completion notice for a background video job, tagged with its job ID like `<background-result kind="image" id=…>` notices. */
export function notice(input: { id: string; state: string; body: string }) {
  return BackgroundResult.render(`kind="video" id="${input.id}" state="${input.state}"`, input.body)
}

/** The inline HTML a reply uses to play a saved video. */
export function embed(file: string) {
  return `<video controls src="${file.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></video>`
}

/** Where the job's `index`th video is saved: the path itself for the first, then `cat-1.mp4`, `cat-2.mp4`, … */
export function videoPath(file: string, index: number) {
  if (index === 0) return file
  const extension = path.extname(file)
  return `${file.slice(0, file.length - extension.length)}-${index}${extension}`
}

/**
 * Wait for a video the server is generating, then copy each of its videos from the blob store into the workspace, as a
 * background Job that a restarted server can take over from the same recovery record.
 */
export const track = Effect.fnUntraced(function* (input: {
  readonly jobs: Job.Interface
  readonly sessions: Pick<Session.Interface, "synthetic">
  readonly videos: VideoGeneration.Interface
  readonly blobs: BlobStore.Interface
  readonly fs: FSUtil.Interface
  readonly files: Environment.Files
  readonly scope: Scope.Scope
  readonly notificationID: SessionMessage.ID
  readonly sessionID: SessionSchema.ID
  readonly videoID: VideoID
  readonly path: string
  readonly title?: string
}) {
  const run = Effect.gen(function* () {
    const job = yield* input.videos.wait(input.videoID)
    if (job.status === "error") return yield* Effect.fail(new Error(job.error))
    // The blob is on the server's disk; the copy is a workspace write, streamed so a video is never held in memory.
    const files = yield* Effect.forEach(job.blobs, (blob, index) =>
      Effect.gen(function* () {
        const file = videoPath(input.path, index)
        const content = yield* input.blobs.read(blob.id)
        yield* input.files.write(file, new Uint8Array())
        yield* input.fs
          .stream(content.path, { chunkSize: CHUNK })
          .pipe(Stream.runForEach((chunk) => input.files.append(file, chunk)))
        return file
      }),
    )
    const inline = files.map(embed).join(" ")
    const saved =
      files.length === 1
        ? `Video request finished. Saved video: ${files[0]}.`
        : `Video request finished. Saved ${files.length} videos: ${files.join(", ")}.`
    return `${saved}\nShow ${files.length === 1 ? "it" : "them"} inline in your reply with ${inline}, and also give ${files.length === 1 ? "the path" : "each path"}.`
  }).pipe(
    // The job keeps this text, so a restart can still deliver the outcome.
    Effect.mapError((error) => new Error(`Video request failed for ${input.path}: ${error.message}`)),
  )
  yield* input.jobs.start({
    id: input.videoID,
    notificationID: input.notificationID,
    type: name,
    title: input.title ?? input.path,
    metadata: { sessionID: input.sessionID, path: input.path },
    recovery: { kind: "video", sessionID: input.sessionID, path: input.path, videoID: input.videoID },
    background: true,
    run,
    cancel: input.videos.cancel(input.videoID).pipe(Effect.ignore),
  })
  yield* Effect.gen(function* () {
    const info = (yield* input.jobs.wait({ id: input.videoID })).info
    if (!info || info.status === "running") return
    yield* input.sessions.synthetic({
      id: input.notificationID,
      sessionID: input.sessionID,
      description: "Video generation",
      text: notice({
        id: input.videoID,
        state: info.status,
        body:
          info.status === "completed"
            ? (info.output ?? "")
            : info.status === "error"
              ? (info.error ?? `Video request failed for ${input.path}.`)
              : `Video request for ${input.path} was cancelled.`,
      }),
      metadata: { source: name, jobID: input.videoID, state: info.status, path: input.path },
    })
    yield* input.jobs.completeBackground(input.notificationID)
  }).pipe(Effect.forkIn(input.scope, { startImmediately: true }))
})

export const Plugin = {
  id: "opencode.tool.video-generate",
  effect: Effect.fn("VideoGenerateTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const videos = yield* VideoGeneration.Service
    const blobs = yield* BlobStore.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const sessions = yield* Session.Service
    const models = yield* Model.Service
    const permission = yield* Permission.Service
    const config = yield* Config.Service

    const resolveModel = Effect.fn("VideoGenerateTool.resolveModel")(function* (
      input: string | undefined,
      sessionID: SessionSchema.ID,
    ) {
      const available = yield* models.available(["video"])
      if (!input) {
        // A configured default that isn't available falls back to the automatic pick.
        const configured = configuredModel(yield* config.entries())
        const providerID = (yield* ctx.session.get({ sessionID })).model?.providerID
        const model =
          (configured &&
            available.find((model) => model.providerID === configured.providerID && model.id === configured.model)) ??
          available.find((model) => model.providerID === providerID) ??
          available[0]
        if (!model) return yield* new ToolFailure({ message: "No video model is available." })
        return model
      }
      const ref = yield* Effect.try({
        try: () => Model.Ref.parse(input),
        catch: () => new ToolFailure({ message: `Invalid model "${input}". Use "providerID/modelID".` }),
      })
      const model = available.find((model) => model.providerID === ref.providerID && model.id === ref.id)
      if (model === undefined)
        return yield* new ToolFailure({
          message: `Model "${ref.providerID}/${ref.id}" is not an available video model. Use the models tool with type: "video" to see what is available.`,
        })
      return model
    })

    // URLs go to the provider as they are, which most video APIs prefer; local files are read and sent inline.
    const readMedia = Effect.fn("VideoGenerateTool.readMedia")(function* (
      value: string,
      context: FileAccess.Invocation,
      kinds: readonly Media.Kind[],
    ) {
      const asset = /^https?:\/\//i.test(value)
        ? yield* Effect.gen(function* () {
            // The provider fetches the URL, but the agent chose it, so the webfetch rule still applies.
            yield* permission.assert({
              action: "webfetch",
              resources: [value],
              save: Permission.site(value),
              metadata: { url: value },
              ...Permission.invocation(context),
            })
            return Media.url(value, { mediaType: urlType(value) })
          })
        : yield* Effect.gen(function* () {
            const target = yield* access.authorizeRead(value, context)
            const info = yield* target.environment.files
              .stat(target.absolute)
              .pipe(
                Effect.catchTag("Environment.NotFound", () => new ToolFailure({ message: `File not found: ${value}` })),
              )
            if (info.size > MAX_INPUT_BYTES)
              return yield* new ToolFailure({ message: `${value} is larger than 100 MiB.` })
            const bytes = (yield* target.environment.files.read(target.absolute)).bytes
            const mime = Media.detectMediaType(bytes)
            if (mime === undefined)
              return yield* new ToolFailure({ message: `${value} is not a supported image, video or audio file.` })
            return Media.bytes(bytes, mime)
          })
      // A URL without a known extension has no type yet; the provider checks it.
      if (asset.kind !== "other" && !kinds.includes(asset.kind))
        return yield* new ToolFailure({
          message: `${value} must be ${kinds.join(", ").replace(/, (\w+)$/, " or $1")}.`,
        })
      return asset
    })

    // Frames are images; `Media.image` keeps a URL whose type it can't tell for the provider to check.
    const readFrame = (value: string, context: FileAccess.Invocation) =>
      readMedia(value, context, ["image"]).pipe(
        Effect.flatMap((asset) =>
          Effect.try({
            try: () => Media.image(asset),
            catch: () => new ToolFailure({ message: `${value} must be image.` }),
          }),
        ),
      )

    // On by default, like image generation: `experimental.video_generate: false` is honored, but permissions are the
    // supported way to turn it off. Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())

    // Registered only while a video model is available, re-evaluated whenever the catalog changes.
    const wanted = models.available(["video"]).pipe(Effect.map((available) => available.length > 0))
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
        if (!enabled || videoGenerate(loaded.entries) === false) return
        editor.add({
          name,
          options: { codemode: true },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const model = yield* resolveModel(input.model, context.sessionID)
              const ref = `${model.providerID}/${model.id}`
              if (input.aspect !== undefined && !Schema.is(VideoAspectRatio)(input.aspect))
                return yield* new ToolFailure({
                  message: `Invalid aspect "${input.aspect}". Use "width:height", such as "16:9", or "auto".`,
                })
              const aspect = input.aspect
              const target = input.path ? yield* access.resolve({ path: input.path, kind: "file" }) : undefined

              yield* permission.assert({
                action: name,
                resources: [ref],
                save: ["*"],
                metadata: { ...input, model: ref },
                ...Permission.invocation(context),
              })
              if (target) {
                yield* access.authorizeExternal([target], context)
                yield* permission.assert({
                  action: "edit",
                  resources: [target.resource],
                  save: [FileAccess.always(target)],
                  ...Permission.invocation(context),
                })
              }
              const start = input.start ? yield* readFrame(input.start, context) : undefined
              const end = input.end ? yield* readFrame(input.end, context) : undefined
              const references = input.references
                ? yield* Effect.forEach(input.references, (reference) =>
                    readMedia(reference, context, ["image", "video", "audio"]),
                  )
                : undefined

              // Submitting runs in the foreground so a rejected request fails the call; the wait runs as a job.
              const started = yield* videos.start(
                {
                  model: Model.Ref.make({ providerID: model.providerID, id: model.id }),
                  prompt: input.prompt,
                  start,
                  end,
                  references,
                  duration: input.duration,
                  aspect,
                  resolution: input.resolution,
                  sound: input.sound,
                },
                { location: (yield* sessions.get(context.sessionID)).location },
              )
              const id = started.id
              const file = target?.absolute ?? path.join(global.tmp, "videos", context.sessionID, `${id}.mp4`)
              yield* track({
                jobs,
                sessions,
                videos,
                blobs,
                fs,
                files: target?.environment.files ?? environment.files,
                scope,
                notificationID: SessionMessage.ID.create(),
                sessionID: context.sessionID,
                videoID: id,
                path: file,
                title: input.prompt,
              })
              return {
                output: [
                  // The model is named only when the tool picked it.
                  `Video job ${id} started in the background${input.model ? "" : ` with ${ref}`}. It will be saved to ${file}; if the model returns more than one video, the others are saved next to it with -1, -2, … added to the name.`,
                  "You will be notified automatically when it finishes or fails. Videos usually take a few minutes.",
                  "DO NOT sleep, poll, check whether the file exists, or request the same video again while it runs.",
                  "Work on other tasks, or briefly tell the user what you started and end your response.",
                ].join("\n"),
                metadata: { path: file, model: ref, jobID: id },
              }
            }).pipe(Effect.mapError(toolFailure("Unable to generate video"))),
        })
      })
      .pipe(Effect.orDie)
  }),
}

// Read per field so a later config that sets other experimental options doesn't hide this one.
function videoGenerate(entries: readonly Entry[]) {
  return entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.video_generate !== undefined,
  )?.info.experimental?.video_generate
}

function configuredModel(entries: readonly Entry[]) {
  const value = videoGenerate(entries)
  return typeof value === "object" ? value.model : undefined
}

function urlType(url: string) {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase()
  return extension === undefined ? undefined : URL_TYPES[extension]
}
