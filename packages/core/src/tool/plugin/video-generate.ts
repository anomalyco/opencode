export * as VideoGenerateTool from "./video-generate.js"

import path from "path"
import { Media, ToolFailure, VideoAspectRatio } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Identifier } from "@opencode/schema/identifier"
import { Global } from "@opencode/util/global"
import { Duration, Effect, Schedule, Schema, Scope, Stream } from "effect"
import { toolFailure } from "../runtime.js"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Flag } from "../../flag.js"
import { Generate } from "../../generate.js"
import { Job } from "../../job.js"
import { Model } from "../../model.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSchema } from "../../session/schema.js"

export const name = "experimental_video_generate"
export const MAX_INPUT_BYTES = 50 * 1024 * 1024
const POLL_INTERVAL = Duration.seconds(10)
const GENERATE_TIMEOUT = Duration.hours(1)
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
  "Only call this when the user asks you to create a video. Videos are slow and expensive: if you think one would help but the user didn't ask, ask them first.",
  "Each call makes one video.",
  "It runs in the background: the call starts a job and returns right away, and you are notified automatically when the video is saved, with its path. Videos usually take a few minutes. Never poll, sleep, or check for the file while you wait.",
  "Leave duration, aspect, resolution and sound unset unless the user asks for them; the model's defaults are usually right. If the provider rejects a value, the error says why.",
  "Don't repeat a request unless the user asks.",
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
  references: Schema.optionalKey(Schema.Array(source).check(Schema.isMinLength(1), Schema.isMaxLength(9))).annotate({
    description:
      "Images, videos or audio that guide the subject, style, motion or voice without being shown as-is. Local file paths or http(s) URLs.",
  }),
  duration: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))).annotate({
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
      "Where to save the video, relative to the session directory or absolute, usually ending in .mp4. An existing file is overwritten. Defaults to a new file in the session's temp folder.",
  }),
})

export const Output = Schema.Struct({
  id: Schema.String.annotate({ description: "The video job's ID, repeated in its completion notice" }),
  path: Schema.String.annotate({ description: "Where the video will be saved" }),
  model: Schema.String.annotate({ description: "providerID/modelID" }),
})

/** The completion notice for a background video job, tagged with its job ID like `<image id=…>` notices. */
export function notice(input: { id: string; state: string; body: string }) {
  return `<video id="${input.id}" state="${input.state}">\n${input.body}\n</video>`
}

/**
 * Poll a submitted video job by its token until it settles, then download and save it, as a background Job that a
 * restarted server can take over from the same recovery record.
 */
export const track = Effect.fnUntraced(function* (input: {
  readonly jobs: Job.Interface
  readonly sessions: Pick<Session.Interface, "synthetic">
  readonly generate: Generate.Interface
  readonly environment: Environment.Interface
  readonly scope: Scope.Scope
  readonly id: string
  readonly notificationID: SessionMessage.ID
  readonly sessionID: SessionSchema.ID
  readonly model: string
  readonly token: unknown
  readonly path: string
  readonly title?: string
}) {
  const ref = Model.Ref.parse(input.model)
  const run = Effect.gen(function* () {
    yield* input.generate.video.status(ref, input.token).pipe(
      Effect.repeat({
        schedule: Schedule.spaced(POLL_INTERVAL),
        until: (status) => status.status !== "queued" && status.status !== "running",
      }),
      Effect.timeoutOrElse({
        duration: GENERATE_TIMEOUT,
        orElse: () => Effect.fail(new Error("Video generation timed out after an hour.")),
      }),
    )
    // A failed, cancelled or expired job fails here with the provider's reason.
    const video = yield* input.generate.video.result(ref, input.token)
    yield* input.environment.files.write(input.path, video.data)
    return `Video request finished. Saved video: ${input.path} (${input.model}).`
  }).pipe(
    // The job keeps this text, so a restart can still deliver the outcome.
    Effect.mapError((error) => new Error(`Video request failed for ${input.path}: ${error.message}`)),
  )
  yield* input.jobs.start({
    id: input.id,
    notificationID: input.notificationID,
    type: name,
    title: input.title ?? input.path,
    metadata: { sessionID: input.sessionID, path: input.path, model: input.model },
    recovery: {
      kind: "video",
      sessionID: input.sessionID,
      path: input.path,
      model: input.model,
      token: input.token,
    },
    background: true,
    run,
    // Best effort: some providers have no cancel call, and the paid job then runs to completion on their side.
    cancel: input.generate.video.cancel(ref, input.token).pipe(Effect.ignore),
  })
  yield* Effect.gen(function* () {
    const info = (yield* input.jobs.wait({ id: input.id })).info
    if (!info || info.status === "running") return
    yield* input.sessions.synthetic({
      id: input.notificationID,
      sessionID: input.sessionID,
      description: "Video generation",
      text: notice({
        id: input.id,
        state: info.status,
        body:
          info.status === "completed"
            ? (info.output ?? "")
            : info.status === "error"
              ? (info.error ?? `Video request failed for ${input.path}.`)
              : `Video request for ${input.path} was cancelled.`,
      }),
      metadata: { source: name, jobID: input.id, state: info.status, path: input.path },
    })
    yield* input.jobs.completeBackground(input.notificationID)
  }).pipe(Effect.forkIn(input.scope, { startImmediately: true }))
})

export const Plugin = {
  id: "opencode.tool.video-generate",
  effect: Effect.fn("VideoGenerateTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const generate = yield* Generate.Service
    const global = yield* Global.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const sessions = yield* Session.Service
    const models = yield* Model.Service
    const permission = yield* Permission.Service
    if (!(yield* Flag.enabled("video_generate"))) return

    const resolveModel = Effect.fn("VideoGenerateTool.resolveModel")(function* (
      input: string | undefined,
      sessionID: SessionSchema.ID,
    ) {
      const available = yield* models.available(["video"])
      if (!input) {
        const providerID = (yield* ctx.session.get({ sessionID })).model?.providerID
        const model = available.find((model) => model.providerID === providerID) ?? available[0]
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
              save: ["*"],
              metadata: { url: value },
              ...Permission.invocation(context),
            })
            return Media.url(value, { mediaType: urlType(value) })
          })
        : yield* Effect.gen(function* () {
            const target = yield* access.authorizeRead(value, context)
            const info = yield* environment.files
              .stat(target.absolute)
              .pipe(
                Effect.catchTag("Environment.NotFound", () => new ToolFailure({ message: `File not found: ${value}` })),
              )
            if (info.size > MAX_INPUT_BYTES)
              return yield* new ToolFailure({ message: `${value} is larger than 50 MiB.` })
            const bytes = (yield* environment.files.read(target.absolute)).bytes
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
        if (!enabled) return
        editor.add({
          name,
          options: { codemode: false },
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
              const id = `video_${Identifier.create(false)}`
              const file = target?.absolute ?? path.join(global.tmp, "videos", context.sessionID, `${id}.mp4`)

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
                  save: ["*"],
                  ...Permission.invocation(context),
                })
              }
              const start = input.start ? yield* readMedia(input.start, context, ["image"]) : undefined
              const end = input.end ? yield* readMedia(input.end, context, ["image"]) : undefined
              const references = input.references
                ? yield* Effect.forEach(input.references, (reference) =>
                    readMedia(reference, context, ["image", "video", "audio"]),
                  )
                : undefined

              // Submitting runs in the foreground so a rejected request fails the call; the wait runs as a job.
              const job = yield* generate.video.start({
                model: Model.Ref.make({ providerID: model.providerID, id: model.id }),
                prompt: input.prompt,
                start,
                end,
                references,
                duration: input.duration,
                aspect,
                resolution: input.resolution,
                sound: input.sound,
              })
              yield* track({
                jobs,
                sessions,
                generate,
                environment,
                scope,
                id,
                notificationID: SessionMessage.ID.create(),
                sessionID: context.sessionID,
                model: ref,
                token: job.token,
                path: file,
                title: input.prompt,
              })
              return {
                output: { id, path: file, model: ref },
                content: [
                  `Video job ${id} started in the background with ${ref}. It will be saved to ${file}.`,
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

function urlType(url: string) {
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase()
  return extension === undefined ? undefined : URL_TYPES[extension]
}
