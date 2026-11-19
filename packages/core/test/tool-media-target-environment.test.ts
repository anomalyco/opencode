import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Bus } from "@opencode/core/bus"
import { Flag } from "@opencode/core/flag"
import { Generate } from "@opencode/core/generate"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { Tool } from "@opencode/core/tool"
import { ImageGenerateTool } from "@opencode/core/tool/plugin/image-generate"
import { VideoGenerateTool } from "@opencode/core/tool/plugin/video-generate"
import type { ImageRequest, ImageResult } from "@opencode/schema/generate"
import { Effect, Layer, Schedule, Stream } from "effect"
import { elsewhere } from "./fixture/target-environment"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"
import { makePluginTestLayer } from "./plugin/fixture"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
// A different image, so a read of the session's copy is visible in what the provider receives.
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
const MP4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

const it = testEffect(Layer.succeed(Flag.Overrides, "video_generate"))

const imageProvider = (requests: ImageRequest[]) =>
  Layer.succeed(
    Generate.Service,
    Generate.Service.of({
      text: () => Effect.succeed(""),
      image: (input) => {
        const result: ImageResult = { images: [{ type: "image", data: PNG, mime: "image/png" }] }
        return Effect.sync(() => void requests.push(input)).pipe(Effect.as(result))
      },
      decisions: () => Effect.die("unused"),
      video: {
        start: () => Effect.die("unused"),
        status: () => Effect.die("unused"),
        result: () => Effect.die("unused"),
        cancel: () => Effect.die("unused"),
      },
    }),
  )

const videoProvider = (starts: Generate.VideoInput[]) =>
  Layer.succeed(
    Generate.Service,
    Generate.Service.of({
      text: () => Effect.succeed(""),
      image: () => Effect.die("unused"),
      decisions: () => Effect.die("unused"),
      video: {
        start: (input) =>
          Effect.suspend(() => {
            starts.push(input)
            return Effect.succeed({ id: "req_1" })
          }),
        status: () => Effect.succeed({ status: "completed" } as const),
        result: () => Effect.succeed([{ mime: "video/mp4", stream: Stream.make(MP4, Uint8Array.of(0)) }]),
        cancel: () => Effect.die("unused"),
      },
    }),
  )

const imageModel = (providerID: string, id: string) =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    yield* catalog.transform((editor) =>
      editor.models.update(Provider.ID.make(providerID), Model.ID.make(id), (model) => {
        model.type = "image"
        model.capabilities.input = ["text", "image"]
      }),
    )
  })

const videoModel = (providerID: string, id: string) =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    yield* catalog.transform((editor) =>
      editor.models.update(Provider.ID.make(providerID), Model.ID.make(id), (model) => {
        model.type = "video"
      }),
    )
  })

const setup = () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const host = yield* PluginHost.make(plugins, "test")
    yield* ImageGenerateTool.Plugin.effect(host)
    yield* VideoGenerateTool.Plugin.effect(host)
    const session = yield* sessions.create({
      location: Location.Ref.make({ directory: location.directory }),
      model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("chat") }),
    })
    const registry = yield* Tool.Service
    const run = (name: string, input: Record<string, unknown>) =>
      executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: { type: "tool-call", id: `call-${name}-${JSON.stringify(input)}`, name, input },
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
    return { run, notice }
  })

describe("experimental_image_generate", () => {
  it.live("reads its input and saves its output in the resolved target's environment, not the session's", () =>
    withTempDir((tmp) => {
      const other = elsewhere(tmp.path)
      const input = path.join(tmp.path, "in.png")
      const output = path.join(tmp.path, "out.png")
      const requests: ImageRequest[] = []

      return Effect.gen(function* () {
        yield* imageModel("test", "painter")
        yield* other.environment.files.write(input, Buffer.from(PNG, "base64"))
        yield* Effect.promise(() => fs.writeFile(input, Buffer.from(GIF, "base64")))
        yield* Effect.promise(() => fs.writeFile(output, "session\n"))
        const { run, notice } = yield* setup()

        const result = yield* run(ImageGenerateTool.name, { prompt: "blue", images: ["in.png"], path: "out.png" })
        expect(yield* notice(result)).toContain(`Saved image: ${output}`)
        expect(requests).toEqual([
          {
            model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("painter") }),
            prompt: "blue",
            n: 1,
            images: [{ data: PNG, mime: "image/png", name: "in.png" }],
          },
        ])
        expect(Buffer.from((yield* other.environment.files.read(output)).bytes).toString("base64")).toBe(PNG)
        expect(yield* Effect.promise(() => fs.readFile(output, "utf8"))).toBe("session\n")
        expect((yield* Effect.promise(() => fs.readFile(input))).toString("base64")).toBe(GIF)
      }).pipe(Effect.provide(makePluginTestLayer(undefined, imageProvider(requests), other.replacements)))
    }),
  )
})

describe("experimental_video_generate", () => {
  it.live("reads its input and saves its output in the resolved target's environment, not the session's", () =>
    withTempDir((tmp) => {
      const other = elsewhere(tmp.path)
      const input = path.join(tmp.path, "first.png")
      const output = path.join(tmp.path, "kite.mp4")
      const starts: Generate.VideoInput[] = []

      return Effect.gen(function* () {
        yield* videoModel("test", "director")
        yield* other.environment.files.write(input, Buffer.from(PNG, "base64"))
        yield* Effect.promise(() => fs.writeFile(input, Buffer.from(GIF, "base64")))
        yield* Effect.promise(() => fs.writeFile(output, "session\n"))
        const { run, notice } = yield* setup()

        const result = yield* run(VideoGenerateTool.name, { prompt: "x", start: "first.png", path: "kite.mp4" })
        expect(yield* notice(result)).toContain(`Saved video: ${output}`)
        expect(starts[0]?.start?.source).toMatchObject({ type: "bytes", mediaType: "image/png" })
        expect(new Uint8Array((yield* other.environment.files.read(output)).bytes)).toEqual(Uint8Array.of(...MP4, 0))
        expect(yield* Effect.promise(() => fs.readFile(output, "utf8"))).toBe("session\n")
        expect((yield* Effect.promise(() => fs.readFile(input))).toString("base64")).toBe(GIF)
      }).pipe(Effect.provide(makePluginTestLayer(undefined, videoProvider(starts), other.replacements)))
    }),
  )
})
