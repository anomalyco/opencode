import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Generate } from "@opencode/core/generate"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import type { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { ImageGenerateTool } from "@opencode/core/tool/plugin/image-generate"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import type { ImageRequest, ImageResult } from "@opencode/schema/generate"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Schedule } from "effect"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, toolDefinitions, toolIdentity } from "./lib/tool"
import { makePluginTestLayer } from "./plugin/fixture"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
// 5x3, with EXIF and Photoshop segments ahead of the frame header.
const JPEG =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAABaADAAQAAAABAAAAAwAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAwAFAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A7iiiiv8AQA+XP//Z"

const fixture = {
  requests: [] as ImageRequest[],
  assertions: [] as Permission.AssertInput[],
  result: { images: [{ type: "image", data: PNG, mime: "image/png" }] } as ImageResult,
}

const it = testEffect(
  makePluginTestLayer(
    permissionLayer({
      assert: (input) => Effect.sync(() => void fixture.assertions.push(input)),
    }),
    Layer.succeed(
      Generate.Service,
      Generate.Service.of({
        text: () => Effect.succeed(""),
        image: (input) => Effect.sync(() => fixture.requests.push(input)).pipe(Effect.as(fixture.result)),
        decisions: () => Effect.die("unused"),
      }),
    ),
  ),
)

const imageModel = (providerID: string, id: string, update: (model: Model.MutableInfo) => void = () => {}) =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    yield* catalog.transform((editor) =>
      editor.models.update(Provider.ID.make(providerID), Model.ID.make(id), (model) => {
        model.type = "image"
        update(model)
      }),
    )
  })

const setup = (providerID = "test") =>
  Effect.gen(function* () {
    fixture.requests.length = 0
    fixture.assertions.length = 0
    fixture.result = { images: [{ type: "image", data: PNG, mime: "image/png" }] }
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const host = yield* PluginHost.make(plugins)
    yield* ImageGenerateTool.Plugin.effect(host)
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
        call: { type: "tool-call", id: `call-${JSON.stringify(input)}`, name: ImageGenerateTool.name, input },
      })
    return { session, run, directory: location.directory }
  })

const text = (result: { readonly content?: ReadonlyArray<Tool.Content> }) =>
  result.content?.[0]?.type === "text" ? result.content[0].text : undefined
const failure = (result: { readonly error?: { readonly message: string } }) => result.error?.message

describe("image_generate", () => {
  it.live("is registered only while an image model is available", () =>
    Effect.gen(function* () {
      yield* setup()
      const registry = yield* Tool.Service
      const registered = toolDefinitions(registry).pipe(
        Effect.map((tools) => tools.some((tool) => tool.name === ImageGenerateTool.name)),
      )
      // The catalog change reaches the tool through model.updated, so wait for it instead of a fixed delay.
      const until = (expected: boolean) =>
        registered.pipe(
          Effect.repeat({ until: (value) => value === expected, schedule: Schedule.spaced("5 millis") }),
          Effect.timeout("10 seconds"),
        )

      expect(yield* registered).toBe(false)
      yield* imageModel("test", "painter")
      expect(yield* until(true)).toBe(true)
      const catalog = yield* Provider.Service
      yield* catalog.transform((editor) => editor.models.remove(Provider.ID.make("test"), Model.ID.make("painter")))
      expect(yield* until(false)).toBe(false)
    }),
  )

  it.live("reads input images, asks permission, and saves the result without overwriting", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter", (model) => {
        model.capabilities.input = ["text", "image"]
      })
      const { run, directory, session } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "in.png"), Buffer.from(PNG, "base64")))

      const result = yield* run({ prompt: "make it blue", images: ["in.png"], aspect: "16:9", path: "out.png" })
      const file = path.join(directory, "out.png")
      expect(result.output).toEqual({ path: file, model: "test/painter", width: 1, height: 1 })
      expect(result.content?.[0]).toEqual({
        type: "text",
        text: `Saved 1x1 image to ${file} (test/painter).`,
      })
      expect(result.content?.[1]).toMatchObject({ type: "file", mime: "image/png", name: file })
      expect((yield* Effect.promise(() => fs.readFile(file))).toString("base64")).toBe(PNG)
      expect(fixture.requests).toEqual([
        {
          model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("painter") }),
          prompt: "make it blue",
          n: 1,
          images: [{ data: PNG, mime: "image/png", name: "in.png" }],
          aspect: "16:9",
        },
      ])
      expect(fixture.assertions.map((item) => [item.action, item.resources])).toEqual([
        ["image_generate", ["test/painter"]],
        ["edit", ["out.png"]],
        ["read", ["in.png"]],
      ])
      expect(fixture.assertions[0]?.sessionID).toBe(session.id)

      // An existing file is never replaced, and nothing is generated or charged for.
      fixture.requests.length = 0
      expect(failure(yield* run({ prompt: "again", path: "out.png" }))).toBe(
        `${file} already exists. Choose a new path.`,
      )
      expect(fixture.requests).toEqual([])
    }),
  )

  it.live("saves to the session temp folder by default and handles a non-PNG result", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      const { run, session, directory } = yield* setup()
      const global = yield* Global.Service
      fixture.result = { images: [{ type: "image", data: JPEG, mime: "image/jpeg" }] }

      const result = yield* run({ prompt: "a cat" })
      expect(path.dirname(result.output.path)).toBe(path.join(global.tmp, "images", session.id))
      expect(path.extname(result.output.path)).toBe(".jpg")
      expect(result.output).toMatchObject({ width: 5, height: 3 })
      expect(text(result)).toContain("The model returned image/jpeg, so the file is in that format.")
      expect(yield* Effect.promise(() => Bun.file(result.output.path).exists())).toBe(true)

      // An explicit path is kept exactly, since only that path was approved and checked before paying.
      const explicit = yield* run({ prompt: "a cat", path: "cat.png" })
      expect(explicit.output.path).toBe(path.join(directory, "cat.png"))
      expect(text(explicit)).toContain("The model returned image/jpeg, so the file is in that format.")
    }),
  )

  it.live("validates an explicit model and its support for input images", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "text-only", (model) => {
        model.capabilities.input = ["text"]
      })
      yield* imageModel("other", "editor", (model) => {
        model.capabilities.input = ["text", "image"]
      })
      const { run, directory } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "in.png"), Buffer.from(PNG, "base64")))

      expect(failure(yield* run({ prompt: "x", model: "test/missing" }))).toBe(
        'Model "test/missing" is not an available image model. Use the models tool with type: "image" to see what is available.',
      )
      expect(failure(yield* run({ prompt: "x", model: "test/text-only", images: ["in.png"] }))).toBe(
        'Model "test/text-only" does not accept input images. Image models that do: other/editor.',
      )
      // Without an explicit model, input images steer the default to a model that accepts them.
      expect((yield* run({ prompt: "x", images: ["in.png"] })).output).toMatchObject({ model: "other/editor" })
      expect((yield* run({ prompt: "x", model: "test/text-only" })).output).toMatchObject({ model: "test/text-only" })
      expect(fixture.requests).toHaveLength(2)
    }),
  )

  it.live("rejects input files that are not images", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      const { run, directory } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "notes.txt"), "hello"))
      expect(failure(yield* run({ prompt: "x", images: ["notes.txt"] }))).toBe(
        "notes.txt is not a PNG, JPEG, WebP or GIF image.",
      )
      expect(failure(yield* run({ prompt: "x", images: ["missing.png"] }))).toBe("File not found: missing.png")
      expect(fixture.requests).toEqual([])
    }),
  )

  it.effect("lists image models through the models tool type filter", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      const catalog = yield* Provider.Service
      yield* catalog.transform((editor) =>
        editor.models.update(Provider.ID.make("test"), Model.ID.make("chat"), () => {}),
      )
      const { session } = yield* setup()
      const registry = yield* Tool.Service
      const models = (input: Record<string, unknown>) =>
        executeTool(registry, {
          sessionID: session.id,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: `models-${JSON.stringify(input)}`,
            name: "execute",
            input: { code: `return await tools.opencode.models(${JSON.stringify(input)})` },
          },
        }).pipe(
          Effect.map((result) =>
            (JSON.parse(text(result) ?? "") as { providers: { models: { id: string }[] }[] }).providers.flatMap(
              (provider) => provider.models.map((model) => model.id),
            ),
          ),
        )
      expect(yield* models({ type: "image" })).toEqual(["test/painter"])
      expect(yield* models({})).not.toContain("test/painter")
      expect(yield* models({})).toContain("test/chat")
    }),
  )
})

describe("defaultModel", () => {
  const info = (providerID: string, id: string, family?: string, input = ["text", "image"]) => ({
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)),
    type: "image",
    ...(family ? { family: Model.Family.make(family) } : {}),
    capabilities: { tools: false, input, output: ["image"] },
  })
  const pick = (models: ReturnType<typeof info>[], providerID?: string, images = false) => {
    const model = ImageGenerateTool.defaultModel(models, { providerID, images })
    return model && `${model.providerID}/${model.id}`
  }

  it.effect("prefers the session's provider, then known families, then the newest", () =>
    Effect.sync(() => {
      const newest = info("fresh", "newest")
      const flux = info("bfl", "flux-2", "flux")
      const gemini = info("google", "nano-banana", "gemini-flash")
      const gpt = info("openai", "gpt-image-2", "gpt-image")
      const own = info("mine", "own-image")
      const all = [newest, flux, gemini, gpt, own]

      expect(pick(all, "mine")).toBe("mine/own-image")
      expect(pick(all, "elsewhere")).toBe("openai/gpt-image-2")
      expect(pick([newest, flux, gemini])).toBe("google/nano-banana")
      expect(pick([newest, info("x", "unknown", "mystery")])).toBe("fresh/newest")
      expect(pick([])).toBeUndefined()
    }),
  )

  it.effect("only considers models that accept input images when images are passed", () =>
    Effect.sync(() => {
      const textOnly = info("mine", "text-only", "gpt-image", ["text"])
      const editor = info("other", "editor")
      expect(pick([textOnly, editor], "mine", true)).toBe("other/editor")
      expect(pick([textOnly], "mine", true)).toBeUndefined()
      expect(pick([textOnly, editor], "mine", false)).toBe("mine/text-only")
    }),
  )
})
