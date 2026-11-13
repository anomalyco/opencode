import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Media, VideoStatus } from "@opencode/ai/effect"
import { Bus } from "@opencode/core/bus"
import { Flag } from "@opencode/core/flag"
import { Generate } from "@opencode/core/generate"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { Tool } from "@opencode/core/tool"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import { VideoGenerateTool } from "@opencode/core/tool/plugin/video-generate"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Schedule, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, toolDefinitions, toolIdentity } from "./lib/tool"
import { makePluginTestLayer } from "./plugin/fixture"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const MP4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

const fixture = {
  starts: [] as Generate.VideoInput[],
  reads: [] as { model: Model.Ref; id: string }[],
  cancels: [] as string[],
  assertions: [] as Permission.AssertInput[],
  status: { status: "completed" } as VideoStatus,
  failure: undefined as Generate.Error | undefined,
  resultFailure: undefined as Generate.Error | undefined,
  deny: undefined as string | undefined,
}

const it = testEffect(
  makePluginTestLayer(
    permissionLayer({
      assertNotDenied: () => Effect.void,
      assert: (input) =>
        Effect.sync(() => void fixture.assertions.push(input)).pipe(
          Effect.andThen(
            fixture.deny === input.action
              ? Effect.fail(
                  new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources }),
                )
              : Effect.void,
          ),
        ),
    }),
    Layer.succeed(
      Generate.Service,
      Generate.Service.of({
        text: () => Effect.succeed(""),
        image: () => Effect.die("unused"),
        decisions: () => Effect.die("unused"),
        video: {
          start: (input) =>
            Effect.suspend(() => {
              fixture.starts.push(input)
              return fixture.failure ? Effect.fail(fixture.failure) : Effect.succeed({ id: "req_1" })
            }),
          status: (model, id) =>
            Effect.sync(() => {
              fixture.reads.push({ model, id })
              return fixture.status
            }),
          result: () =>
            Effect.suspend(() =>
              fixture.resultFailure
                ? Effect.fail(fixture.resultFailure)
                : Effect.succeed({ data: MP4, mime: "video/mp4" }),
            ),
          cancel: (_, id) => Effect.sync(() => void fixture.cancels.push(id)),
        },
      }),
    ),
  ).pipe(Layer.provide(Layer.succeed(Flag.Overrides, "video_generate"))),
)

const videoModel = (providerID: string, id: string) =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    yield* catalog.transform((editor) =>
      editor.models.update(Provider.ID.make(providerID), Model.ID.make(id), (model) => {
        model.type = "video"
      }),
    )
  })

const setup = (providerID = "test") =>
  Effect.gen(function* () {
    fixture.starts.length = 0
    fixture.reads.length = 0
    fixture.cancels.length = 0
    fixture.assertions.length = 0
    fixture.status = { status: "completed" }
    fixture.failure = undefined
    fixture.resultFailure = undefined
    fixture.deny = undefined
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const host = yield* PluginHost.make(plugins, "test")
    yield* VideoGenerateTool.Plugin.effect(host)
    yield* OpenCodeTools.Plugin.effect(host)
    const session = yield* sessions.create({
      location: Location.Ref.make({ directory: location.directory }),
      model: Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make("chat") }),
    })
    const registry = yield* Tool.Service
    const run = (input: Record<string, unknown>) =>
      executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: { type: "tool-call", id: `call-${JSON.stringify(input)}`, name: VideoGenerateTool.name, input },
      })
    const notices: { text: string; metadata?: Record<string, unknown> }[] = []
    const bus = yield* Bus.Service
    yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.data.sessionID === session.id && event.data.item.type === "synthetic")
            notices.push(event.data.item.payload)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    const notice = (result: { readonly metadata?: Record<string, unknown> }) =>
      Effect.sync(() => notices.find((item) => item.metadata?.jobID === result.metadata?.jobID)).pipe(
        Effect.repeat({ until: (item) => item !== undefined, schedule: Schedule.spaced("5 millis") }),
        Effect.timeout("10 seconds"),
        Effect.map((item) => item?.text),
      )
    return { session, run, notice, directory: location.directory }
  })

const registered = Tool.Service.use((registry) => toolDefinitions(registry)).pipe(
  Effect.map((tools) => tools.some((tool) => tool.name === VideoGenerateTool.name)),
)
const until = (expected: boolean) =>
  registered.pipe(
    Effect.repeat({ until: (value) => value === expected, schedule: Schedule.spaced("5 millis") }),
    Effect.timeout("10 seconds"),
  )

const failure = (result: { readonly error?: { readonly message: string } }) => result.error?.message
const kinds = (assets: ReadonlyArray<Media.Asset> | undefined) => assets?.map((asset) => asset.mediaType)

describe("experimental_video_generate", () => {
  it.live("is registered only while a video model is available", () =>
    Effect.gen(function* () {
      yield* setup()
      expect(yield* registered).toBe(false)
      yield* videoModel("test", "director")
      expect(yield* until(true)).toBe(true)
      const catalog = yield* Provider.Service
      yield* catalog.transform((editor) => editor.models.remove(Provider.ID.make("test"), Model.ID.make("director")))
      expect(yield* until(false)).toBe(false)
    }),
  )

  it.live("starts the job in the foreground, then reads it by job ID and saves the video", () =>
    Effect.gen(function* () {
      yield* videoModel("test", "director")
      const { run, notice, directory, session } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "first.png"), Buffer.from(PNG, "base64")))

      const result = yield* run({
        prompt: "the kite takes off",
        start: "first.png",
        end: "https://example.test/last.png",
        references: ["https://example.test/voice.mp3?sig=1", "https://example.test/motion.mp4"],
        duration: 6,
        aspect: "16:9",
        resolution: "720p",
        sound: true,
        path: "kite.mp4",
      })
      const file = path.join(directory, "kite.mp4")
      const id = result.output.id
      expect(id).toStartWith("video_")
      expect(result.output).toEqual({ id, path: file, model: "test/director" })
      expect(yield* notice(result)).toBe(
        `<video id="${id}" state="completed">\nVideo request finished. Saved video: ${file} (test/director).\n</video>`,
      )
      expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(file)))).toEqual(MP4)

      const start = fixture.starts[0]
      expect(start).toMatchObject({
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("director") }),
        prompt: "the kite takes off",
        duration: 6,
        aspect: "16:9",
        resolution: "720p",
        sound: true,
      })
      expect(start?.start?.source).toMatchObject({ type: "bytes", mediaType: "image/png" })
      expect(start?.end?.source).toEqual({ type: "url", url: "https://example.test/last.png" })
      expect(kinds(start?.references)).toEqual(["audio/mpeg", "video/mp4"])
      // The status read uses the job ID start returned, as a restarted server would.
      expect(fixture.reads).toEqual([
        {
          model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("director") }),
          id: "req_1",
        },
      ])
      expect(fixture.assertions.map((item) => [item.action, item.resources])).toEqual([
        ["experimental_video_generate", ["test/director"]],
        ["edit", ["kite.mp4"]],
        ["read", ["first.png"]],
        ["webfetch", ["https://example.test/last.png"]],
        ["webfetch", ["https://example.test/voice.mp3?sig=1"]],
        ["webfetch", ["https://example.test/motion.mp4"]],
      ])
      expect(fixture.assertions[0]?.sessionID).toBe(session.id)
    }),
  )

  it.live("saves to the session temp folder by default", () =>
    Effect.gen(function* () {
      yield* videoModel("test", "director")
      const { run, notice, session } = yield* setup()
      const global = yield* Global.Service
      const result = yield* run({ prompt: "waves" })
      expect(result.output.path).toBe(path.join(global.tmp, "videos", session.id, `${result.output.id}.mp4`))
      yield* notice(result)
      expect(yield* Effect.promise(() => Bun.file(result.output.path).exists())).toBe(true)
    }),
  )

  it.live("fails the call without starting a job when the provider rejects the request", () =>
    Effect.gen(function* () {
      yield* videoModel("test", "director")
      const { run } = yield* setup()
      fixture.failure = new Generate.InvalidRequestError({ message: "Duration must be 4 to 15 seconds" })
      const result = yield* run({ prompt: "x", duration: 60 })
      expect(result.status).toBe("error")
      expect(failure(result)).toContain("Duration must be 4 to 15 seconds")
      expect(fixture.reads).toEqual([])
    }),
  )

  it.live("reports a failed job in the completion notice", () =>
    Effect.gen(function* () {
      yield* videoModel("test", "director")
      const { run, notice, directory } = yield* setup()
      fixture.status = { status: "failed" }
      // The route fails the result read of a failed job with the provider's reason.
      fixture.resultFailure = new Generate.ProviderRequestError({
        providerID: "test",
        reason: "content_filter",
        message: "Moderated",
      })
      const result = yield* run({ prompt: "x", path: "out.mp4" })
      expect(yield* notice(result)).toBe(
        `<video id="${result.output.id}" state="error">\nVideo request failed for ${path.join(directory, "out.mp4")}: Moderated\n</video>`,
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(directory, "out.mp4")).exists())).toBe(false)
    }),
  )

  it.live("cancels the provider job when its job is cancelled", () =>
    Effect.gen(function* () {
      yield* videoModel("test", "director")
      const { run, notice } = yield* setup()
      fixture.status = { status: "running", progress: 0.2 }
      const result = yield* run({ prompt: "x" })
      const jobs = yield* Job.Service
      const id = String(result.metadata?.jobID)
      expect((yield* jobs.get(id))?.status).toBe("running")
      yield* jobs.cancel(id)
      expect(yield* notice(result)).toContain(`<video id="${id}" state="cancelled">`)
      expect(fixture.cancels).toEqual(["req_1"])
    }),
  )

  it.live("checks inputs before submitting anything", () =>
    Effect.gen(function* () {
      yield* videoModel("test", "director")
      const { run, directory } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "notes.txt"), "hello"))
      expect(failure(yield* run({ prompt: "x", model: "test/missing" }))).toBe(
        'Model "test/missing" is not an available video model. Use the models tool with type: "video" to see what is available.',
      )
      expect(failure(yield* run({ prompt: "x", aspect: "wide" }))).toBe(
        'Invalid aspect "wide". Use "width:height", such as "16:9", or "auto".',
      )
      expect(failure(yield* run({ prompt: "x", start: "notes.txt" }))).toBe(
        "notes.txt is not a supported image, video or audio file.",
      )
      expect(failure(yield* run({ prompt: "x", start: "https://example.test/clip.mp4" }))).toBe(
        "https://example.test/clip.mp4 must be image.",
      )
      expect(failure(yield* run({ prompt: "x", start: "missing.png" }))).toBe("File not found: missing.png")
      fixture.deny = "webfetch"
      expect((yield* run({ prompt: "x", references: ["https://example.test/a.png"] })).status).toBe("error")
      expect(fixture.starts).toEqual([])
    }),
  )
})
