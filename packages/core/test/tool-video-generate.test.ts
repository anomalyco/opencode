import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Media } from "@opencode/ai/effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Generate } from "@opencode/core/generate"
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
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Effect, Layer, Schedule, Stream } from "effect"
import { advance } from "./lib/clock"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, toolIdentity } from "./lib/tool"
import { makePluginTestLayer } from "./plugin/fixture"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const MP4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

const fixture = {
  starts: [] as Generate.VideoInput[],
  reads: [] as { model: Model.Ref; id: string }[],
  assertions: [] as Permission.AssertInput[],
  /** How many videos a finished job returns. */
  videos: 1,
}

const it = testEffect(
  makePluginTestLayer(
    permissionLayer({
      assertNotDenied: () => Effect.void,
      assert: (input) => Effect.sync(() => void fixture.assertions.push(input)),
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
              return Effect.succeed({ id: "req_1" })
            }),
          status: (model, id) =>
            Effect.sync(() => {
              fixture.reads.push({ model, id })
              return { status: "completed" } as const
            }),
          result: () =>
            Effect.sync(() =>
              Array.from({ length: fixture.videos }, (_, index) => ({
                mime: "video/mp4",
                stream: Stream.make(MP4, Uint8Array.of(index)),
              })),
            ),
          cancel: () => Effect.die("unused"),
        },
      }),
    ),
  ),
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
    fixture.assertions.length = 0
    fixture.videos = 1
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
    // VideoGeneration polls its jobs every 5 seconds on the test clock, so the wait advances it.
    const notice = Effect.fnUntraced(function* (result: { readonly metadata?: Record<string, unknown> }) {
      const find = () => notices.find((item) => item.metadata?.jobID === result.metadata?.jobID)
      yield* advance(() => find() !== undefined)
      return find()?.text
    })
    return { session, run, notice, directory: location.directory }
  })

const configure = (video_generate: ConfigExperimental.Info["video_generate"]) =>
  Effect.gen(function* () {
    const config = yield* Config.Test
    yield* config.setEntries([
      new Document({
        type: "document",
        info: new Info({ experimental: new ConfigExperimental.Info({ video_generate }) }),
      }),
    ])
    const bus = yield* Bus.Service
    yield* bus.publish(Event.Updated, {})
  })

const registered = Tool.Service.use((registry) => registry.list()).pipe(
  Effect.map((tools) => tools.some((tool) => tool.name === VideoGenerateTool.name && tool.options?.codemode === true)),
)
// Catalog and config changes reach the tool through events, so wait for them instead of a fixed delay.
const until = (expected: boolean) =>
  registered.pipe(
    Effect.repeat({ until: (value) => value === expected, schedule: Schedule.spaced("5 millis") }),
    Effect.timeout("10 seconds"),
  )

const kinds = (assets: ReadonlyArray<Media.Asset> | undefined) => assets?.map((asset) => asset.mediaType)

describe("generate_video", () => {
  it.live("is on by default while a video model is available, and off with experimental.video_generate: false", () =>
    Effect.gen(function* () {
      yield* setup()
      expect(yield* registered).toBe(false)
      yield* videoModel("test", "director")
      expect(yield* until(true)).toBe(true)
      yield* configure(false)
      expect(yield* until(false)).toBe(false)
      yield* configure({})
      expect(yield* until(true)).toBe(true)
    }),
  )

  it.effect("starts the job, saves every video it returns and lists them all in the notice", () =>
    Effect.gen(function* () {
      yield* videoModel("test", "director")
      const { run, notice, directory, session } = yield* setup()
      fixture.videos = 2
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
      const second = path.join(directory, "kite-1.mp4")
      const id = String(result.metadata?.jobID)
      expect(id).toStartWith("video_")
      expect(result.metadata).toEqual({ jobID: id, path: file, model: "test/director" })
      expect(result.output).toBe(
        [
          `Video job ${id} started in the background with test/director. It will be saved to ${file}; if the model returns more than one video, the others are saved next to it with -1, -2, … added to the name.`,
          "You will be notified automatically when it finishes or fails. Videos usually take a few minutes.",
          "DO NOT sleep, poll, check whether the file exists, or request the same video again while it runs.",
          "Work on other tasks, or briefly tell the user what you started and end your response.",
        ].join("\n"),
      )
      expect(yield* notice(result)).toBe(
        `<background-result kind="video" id="${id}" state="completed">\nVideo request finished. Saved 2 videos: ${file}, ${second}.\nShow them inline in your reply with <video controls src="${file}"></video> <video controls src="${second}"></video>, and also give each path.\n</background-result>`,
      )
      expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(file)))).toEqual(Uint8Array.of(...MP4, 0))
      expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(second)))).toEqual(Uint8Array.of(...MP4, 1))

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
      // The server polls the provider's job ID that start returned.
      expect(fixture.reads).toEqual([
        {
          model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("director") }),
          id: "req_1",
        },
      ])
      expect(fixture.assertions.map((item) => [item.action, item.resources])).toEqual([
        ["generate_video", ["test/director"]],
        ["edit", ["kite.mp4"]],
        ["read", ["first.png"]],
        ["webfetch", ["https://example.test/last.png"]],
        ["webfetch", ["https://example.test/voice.mp3?sig=1"]],
        ["webfetch", ["https://example.test/motion.mp4"]],
      ])
      expect(fixture.assertions[0]?.sessionID).toBe(session.id)
    }),
  )
})
