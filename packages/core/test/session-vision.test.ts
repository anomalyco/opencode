import { describe, expect } from "bun:test"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/schema/agent"
import { Money } from "@opencode/schema/money"
import { FileAttachment } from "@opencode/schema/prompt"
import { Session } from "@opencode/schema/session"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionVision } from "@opencode/core/session/vision"
import { DateTime, Effect } from "effect"
import { it } from "./lib/effect"

const created = DateTime.makeUnsafe(0)
const agent = Agent.ID.make("build")
const session = Session.Info.make({
  id: Session.ID.make("ses_vision"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created, updated: created },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})

const resolved = (id: string, input: string[]) =>
  SessionRunnerModel.resolved(OpenAIChat.route.model({ id, provider: "test" }), {
    capabilities: { tools: true, input, output: ["text"] },
    cost: [],
    limit: { context: 200_000, output: 32_000 },
  })

const image = FileAttachment.make({
  data: "aGVsbG8=",
  mime: "image/png",
  source: { type: "inline" },
  name: "shot.png",
})
const notes = FileAttachment.make({
  data: "aGVsbG8=",
  mime: "text/plain",
  source: { type: "inline" },
  name: "notes.txt",
})

const user = (files?: ReadonlyArray<FileAttachment>) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.make("msg_user"),
    text: "Inspect this",
    files,
    time: { created },
  })

describe("SessionVision.bridge", () => {
  it.effect("transcribes images with the configured model and leaves other attachments alone", () => {
    const calls: string[] = []
    const layer = SessionVision.layerWith({
      visionModel: () => Effect.succeed(resolved("vision", ["text", "image"])),
      transcribe: ({ file }) =>
        Effect.sync(() => {
          calls.push(file.name ?? "unnamed")
          return "Button labeled Submit"
        }),
    })
    return Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const bridged = yield* vision.bridge({
        session,
        agent,
        model: resolved("selected", ["text"]),
        messages: [user([image, notes])],
      })

      expect(bridged).toHaveLength(2)
      expect(bridged[0]?.type).toBe("user")
      expect(bridged[0]?.type === "user" ? bridged[0]?.files : undefined).toEqual([notes])
      expect(bridged[1]?.type).toBe("synthetic")
      expect(bridged[1]?.type === "synthetic" ? bridged[1]?.text : undefined).toBe(
        "[Image: shot.png]\nButton labeled Submit",
      )
      expect(calls).toEqual(["shot.png"])
    }).pipe(Effect.provide(layer))
  })

  it.effect("does nothing when no vision model is configured", () => {
    const layer = SessionVision.layerWith({
      visionModel: () => Effect.succeed(undefined),
      transcribe: () => Effect.die("transcription must not run without a configured model"),
    })
    return Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const messages = [user([image])]
      const bridged = yield* vision.bridge({ session, agent, model: resolved("selected", ["text"]), messages })
      expect(bridged).toEqual(messages)
    }).pipe(Effect.provide(layer))
  })

  it.effect("does nothing when the selected model already reads images", () => {
    const layer = SessionVision.layerWith({
      visionModel: () => Effect.succeed(resolved("vision", ["text", "image"])),
      transcribe: () => Effect.die("the selected model reads images, so nothing should be transcribed"),
    })
    return Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const messages = [user([image])]
      const bridged = yield* vision.bridge({
        session,
        agent,
        model: resolved("selected", ["text", "image"]),
        messages,
      })
      expect(bridged).toEqual(messages)
    }).pipe(Effect.provide(layer))
  })

  it.effect("does nothing when the messages have no image attachments", () => {
    const layer = SessionVision.layerWith({
      visionModel: () => Effect.succeed(resolved("vision", ["text", "image"])),
      transcribe: () => Effect.die("there are no images to transcribe"),
    })
    return Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const messages = [user([notes])]
      const bridged = yield* vision.bridge({ session, agent, model: resolved("selected", ["text"]), messages })
      expect(bridged).toEqual(messages)
    }).pipe(Effect.provide(layer))
  })

  it.effect("caches transcripts per message and attachment", () => {
    let calls = 0
    const layer = SessionVision.layerWith({
      visionModel: () => Effect.succeed(resolved("vision", ["text", "image"])),
      transcribe: () =>
        Effect.sync(() => {
          calls++
          return "Transcribed"
        }),
    })
    return Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const messages = [user([image])]
      const first = yield* vision.bridge({ session, agent, model: resolved("selected", ["text"]), messages })
      const second = yield* vision.bridge({ session, agent, model: resolved("selected", ["text"]), messages })

      expect(first[1]?.type === "synthetic" ? first[1]?.text : undefined).toBe("[Image: shot.png]\nTranscribed")
      expect(second[1]?.type === "synthetic" ? second[1]?.text : undefined).toBe("[Image: shot.png]\nTranscribed")
      expect(calls).toBe(1)
    }).pipe(Effect.provide(layer))
  })

  it.effect("remembers failed transcriptions so they are not retried on later steps", () => {
    let calls = 0
    const layer = SessionVision.layerWith({
      visionModel: () => Effect.succeed(resolved("vision", ["text", "image"])),
      transcribe: () =>
        Effect.sync(() => {
          calls++
          return undefined
        }),
    })
    return Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const messages = [user([image])]
      const first = yield* vision.bridge({ session, agent, model: resolved("selected", ["text"]), messages })
      const second = yield* vision.bridge({ session, agent, model: resolved("selected", ["text"]), messages })

      expect(first).toEqual(messages)
      expect(second).toEqual(messages)
      expect(calls).toBe(1)
    }).pipe(Effect.provide(layer))
  })

  it.effect("treats an empty transcript as a failure and keeps the original image", () => {
    let calls = 0
    const layer = SessionVision.layerWith({
      visionModel: () => Effect.succeed(resolved("vision", ["text", "image"])),
      transcribe: () =>
        Effect.sync(() => {
          calls++
          return "   "
        }),
    })
    return Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const messages = [user([image])]
      const bridged = yield* vision.bridge({ session, agent, model: resolved("selected", ["text"]), messages })
      expect(bridged).toEqual(messages)
      expect(calls).toBe(1)
    }).pipe(Effect.provide(layer))
  })
})
