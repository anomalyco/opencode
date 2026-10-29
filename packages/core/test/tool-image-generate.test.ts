import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
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
import { ImageGenerateTool } from "@opencode/core/tool/plugin/image-generate"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import type { ImageRequest, ImageResult } from "@opencode/schema/generate"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Schedule, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, toolDefinitions, toolIdentity } from "./lib/tool"
import { makePluginTestLayer } from "./plugin/fixture"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const JPEG =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAABaADAAQAAAABAAAAAwAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAwAFAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A7iiiiv8AQA+XP//Z"

const fixture = {
  requests: [] as ImageRequest[],
  assertions: [] as Permission.AssertInput[],
  checked: [] as Permission.AssertInput[],
  result: { images: [{ type: "image", data: PNG, mime: "image/png" }] } as ImageResult,
  // Holds generation until the test releases it, to observe a running job.
  gate: Effect.void as Effect.Effect<void>,
  failure: undefined as Generate.Error | undefined,
  deny: undefined as string | undefined,
}

const it = testEffect(
  makePluginTestLayer(
    permissionLayer({
      assertNotDenied: (input) => Effect.sync(() => void fixture.checked.push(input)),
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
        image: (input) =>
          Effect.sync(() => fixture.requests.push(input)).pipe(
            Effect.andThen(Effect.suspend(() => fixture.gate)),
            Effect.andThen(
              Effect.suspend(() => (fixture.failure ? Effect.fail(fixture.failure) : Effect.succeed(fixture.result))),
            ),
          ),
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
    fixture.checked.length = 0
    fixture.result = { images: [{ type: "image", data: PNG, mime: "image/png" }] }
    fixture.gate = Effect.void
    fixture.failure = undefined
    fixture.deny = undefined
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const config = yield* Config.Test
    const entries = yield* config.entries()
    if (!entries.some((entry) => entry.type === "document" && entry.info.experimental?.image_generate !== undefined))
      yield* configure(true)
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
    // Completion notices arrive as synthetic messages posted by the background job.
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

const configure = (image_generate: ConfigExperimental.Info["image_generate"]) =>
  Effect.gen(function* () {
    const config = yield* Config.Test
    yield* config.setEntries([
      new Document({
        type: "document",
        info: new Info({ experimental: new ConfigExperimental.Info({ image_generate }) }),
      }),
    ])
    const bus = yield* Bus.Service
    yield* bus.publish(Event.Updated, {})
  })

const configuredModel = (providerID: string, model: string) => ({
  providerID: Provider.ID.make(providerID),
  model: Model.ID.make(model),
})

const registered = Tool.Service.use((registry) => toolDefinitions(registry)).pipe(
  Effect.map((tools) => tools.some((tool) => tool.name === ImageGenerateTool.name)),
)
// Catalog and config changes reach the tool through events, so wait for them instead of a fixed delay.
const until = (expected: boolean) =>
  registered.pipe(
    Effect.repeat({ until: (value) => value === expected, schedule: Schedule.spaced("5 millis") }),
    Effect.timeout("10 seconds"),
  )

const text = (result: { readonly content?: ReadonlyArray<Tool.Content> }) =>
  result.content?.[0]?.type === "text" ? result.content[0].text : undefined
const failure = (result: { readonly error?: { readonly message: string } }) => result.error?.message

describe("image_generate", () => {
  it.live("is registered only while an image model is available", () =>
    Effect.gen(function* () {
      yield* setup()
      expect(yield* registered).toBe(false)
      yield* imageModel("test", "painter")
      expect(yield* until(true)).toBe(true)
      const catalog = yield* Provider.Service
      yield* catalog.transform((editor) => editor.models.remove(Provider.ID.make("test"), Model.ID.make("painter")))
      expect(yield* until(false)).toBe(false)
    }),
  )

  it.live("is offered only when experimental.image_generate is enabled", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      yield* configure(false)
      yield* setup()
      expect(yield* registered).toBe(false)
      yield* configure(true)
      expect(yield* until(true)).toBe(true)
      yield* configure(false)
      expect(yield* until(false)).toBe(false)
      yield* configure({})
      expect(yield* until(true)).toBe(true)
      yield* configure(undefined)
      expect(yield* until(false)).toBe(false)
    }),
  )

  it.live("uses the configured model unless the agent picks one, and falls back with a note", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter", (model) => {
        model.capabilities.input = ["text", "image"]
      })
      yield* imageModel("other", "text-only", (model) => {
        model.capabilities.input = ["text"]
      })
      yield* configure({ model: configuredModel("other", "text-only") })
      const { run, directory } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "in.png"), Buffer.from(PNG, "base64")))

      // The configured model beats the session's provider, and an explicit model beats both.
      const configured = yield* run({ prompt: "x" })
      expect(configured.output).toMatchObject({ model: "other/text-only" })
      expect(text(configured)).not.toContain("used")
      expect((yield* run({ prompt: "x", model: "test/painter" })).output).toMatchObject({ model: "test/painter" })

      // A configured model that can't serve the call is skipped, and the result says why.
      const edit = yield* run({ prompt: "x", images: ["in.png"] })
      expect(edit.output).toMatchObject({ model: "test/painter" })
      expect(text(edit)).toContain("other/text-only doesn't accept input images; used test/painter.")

      yield* configure({ model: configuredModel("gone", "model") })
      const missing = yield* run({ prompt: "x" })
      expect(missing.output).toMatchObject({ model: "test/painter" })
      expect(text(missing)).toContain("gone/model isn't available; used test/painter.")
    }),
  )

  it.live("reads input images, asks permission, and saves the result, overwriting an existing file", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter", (model) => {
        model.capabilities.input = ["text", "image"]
      })
      const { run, notice, directory, session } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "in.png"), Buffer.from(PNG, "base64")))

      const result = yield* run({ prompt: "make it blue", images: ["in.png"], path: "out.png" })
      const file = path.join(directory, "out.png")
      const stem = path.join(directory, "out")
      expect(result.output).toEqual({ path: stem, model: "test/painter" })
      expect(result.content).toEqual([
        {
          type: "text",
          text: [
            `Image request started in the background with test/painter. It will be saved as ${stem} with the extension of its real format (.png, .jpg, .webp or .gif); the notice gives the exact path.`,
            "You will be notified automatically when it finishes or fails.",
            "DO NOT sleep, poll, check whether the file exists, or request the same image again while it runs.",
            "Work on other tasks, or briefly tell the user what you started and end your response.",
          ].join("\n"),
        },
      ])
      expect(yield* notice(result)).toBe(
        `Image request finished. Saved image: ${file} (test/painter).\nUse the read tool on this path to view the image.`,
      )
      expect((yield* Effect.promise(() => fs.readFile(file))).toString("base64")).toBe(PNG)
      expect(fixture.requests).toEqual([
        {
          model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("painter") }),
          prompt: "make it blue",
          n: 1,
          images: [{ data: PNG, mime: "image/png", name: "in.png" }],
        },
      ])
      expect(fixture.assertions.map((item) => [item.action, item.resources])).toEqual([
        ["image_generate", ["test/painter"]],
        ["edit", ["out.png"]],
        ["read", ["in.png"]],
      ])
      expect(fixture.assertions[0]?.sessionID).toBe(session.id)

      // Running again with the same path replaces the file, like the write tool.
      const again = yield* run({ prompt: "again", path: "out.png" })
      expect(again.status).toBe("completed")
      yield* notice(again)
      expect(fixture.requests).toHaveLength(2)
    }),
  )

  it.live("saves with the extension of the image's real format", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      const { run, notice, session, directory } = yield* setup()
      const global = yield* Global.Service
      fixture.result = { images: [{ type: "image", data: JPEG, mime: "image/jpeg" }] }

      // The default path lives in the session temp folder and takes the real extension.
      const result = yield* run({ prompt: "a cat" })
      expect(path.dirname(result.output.path)).toBe(path.join(global.tmp, "images", session.id))
      const saved = `${result.output.path}.jpg`
      expect(yield* notice(result)).toBe(
        `Image request finished. Saved image: ${saved} (test/painter).\nUse the read tool on this path to view the image.`,
      )
      expect(yield* Effect.promise(() => Bun.file(saved).exists())).toBe(true)

      // An explicit path's extension is replaced too, and the notice gives the real path.
      const explicit = yield* run({ prompt: "a cat", path: "cat.png" })
      expect(yield* notice(explicit)).toContain(`Saved image: ${path.join(directory, "cat.jpg")} (test/painter).`)
      expect(yield* Effect.promise(() => Bun.file(path.join(directory, "cat.jpg")).exists())).toBe(true)
      // The edit prompt covered cat.png; the file actually written is still checked against deny rules.
      expect(fixture.assertions.filter((item) => item.action === "edit").map((item) => item.resources)).toEqual([
        ["cat.png"],
      ])
      expect(fixture.checked.map((item) => [item.action, item.resources])).toEqual([["edit", ["cat.jpg"]]])

      // Replacing an existing file under the real extension asks for its own edit approval.
      fixture.assertions.length = 0
      fixture.checked.length = 0
      const again = yield* run({ prompt: "a cat", path: "cat.png" })
      yield* notice(again)
      expect(fixture.assertions.filter((item) => item.action === "edit").map((item) => item.resources)).toEqual([
        ["cat.png"],
        ["cat.jpg"],
      ])
      expect(fixture.checked).toEqual([])
    }),
  )

  it.live("reports a failed generation in the completion notice", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      const { run, notice, directory } = yield* setup()
      fixture.failure = new Generate.ProviderRequestError({
        providerID: "test",
        reason: "content_filter",
        message: "The prompt was rejected",
      })
      const result = yield* run({ prompt: "x", path: "out.png" })
      expect(yield* notice(result)).toBe(
        `Image request failed for ${path.join(directory, "out")}: The prompt was rejected`,
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(directory, "out.png")).exists())).toBe(false)
    }),
  )

  it.live("cancels a running generation through its job", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      const { run, notice, directory } = yield* setup()
      fixture.gate = Effect.never
      const result = yield* run({ prompt: "x", path: "out.png" })
      const jobs = yield* Job.Service
      const id = String(result.metadata?.jobID)
      expect((yield* jobs.get(id))?.status).toBe("running")
      yield* jobs.cancel(id)
      expect(yield* notice(result)).toBe(`Image request for ${path.join(directory, "out")} was cancelled.`)
      expect(yield* Effect.promise(() => Bun.file(path.join(directory, "out.png")).exists())).toBe(false)
    }),
  )

  it.live("starts no job when a permission is denied", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter")
      const { run } = yield* setup()
      fixture.deny = "edit"
      const result = yield* run({ prompt: "x", path: "out.png" })
      expect(result.status).toBe("error")
      expect(fixture.assertions.map((item) => item.action)).toEqual(["image_generate", "edit"])
      expect(fixture.requests).toEqual([])
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
      const { run, notice, directory } = yield* setup()
      yield* Effect.promise(() => fs.writeFile(path.join(directory, "in.png"), Buffer.from(PNG, "base64")))

      expect(failure(yield* run({ prompt: "x", model: "test/missing" }))).toBe(
        'Model "test/missing" is not an available image model. Use the models tool with type: "image" to see what is available.',
      )
      expect(failure(yield* run({ prompt: "x", model: "test/text-only", images: ["in.png"] }))).toBe(
        'Model "test/text-only" does not accept input images. Image models that do: other/editor.',
      )
      // Without an explicit model, input images steer the default to a model that accepts them.
      const steered = yield* run({ prompt: "x", images: ["in.png"] })
      expect(steered.output).toMatchObject({ model: "other/editor" })
      const explicit = yield* run({ prompt: "x", model: "test/text-only" })
      expect(explicit.output).toMatchObject({ model: "test/text-only" })
      yield* notice(steered)
      yield* notice(explicit)
      expect(fixture.requests).toHaveLength(2)
    }),
  )

  it.live("passes a model variant through, from the input or from config", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter", (model) => {
        model.variants = [{ id: Model.VariantID.make("hd"), settings: { quality: "high" } }]
      })
      yield* imageModel("test", "plain")
      const { run, notice } = yield* setup()

      const explicit = yield* run({ prompt: "x", model: "test/painter#hd" })
      expect(explicit.output).toMatchObject({ model: "test/painter#hd" })
      yield* notice(explicit)
      expect(fixture.requests.at(-1)?.model).toEqual(
        Model.Ref.make({
          providerID: Provider.ID.make("test"),
          id: Model.ID.make("painter"),
          variant: Model.VariantID.make("hd"),
        }),
      )
      expect(failure(yield* run({ prompt: "x", model: "test/painter#bogus" }))).toBe(
        'Variant "bogus" is not available for "test/painter". Available: hd.',
      )
      expect(failure(yield* run({ prompt: "x", model: "test/plain#hd" }))).toBe(
        'Model "test/plain" has no variants. Omit the variant.',
      )

      yield* configure({
        model: {
          providerID: Provider.ID.make("test"),
          model: Model.ID.make("painter"),
          variant: Model.VariantID.make("hd"),
        },
      })
      const configured = yield* run({ prompt: "x" })
      expect(configured.output).toMatchObject({ model: "test/painter#hd" })
      yield* notice(configured)
      expect(fixture.requests.at(-1)?.model.variant).toBe(Model.VariantID.make("hd"))

      yield* configure({
        model: {
          providerID: Provider.ID.make("test"),
          model: Model.ID.make("painter"),
          variant: Model.VariantID.make("bogus"),
        },
      })
      const fallback = yield* run({ prompt: "x" })
      expect(text(fallback)).toContain('test/painter#bogus has no variant "bogus"; used ')
      yield* notice(fallback)
      expect(fixture.requests.at(-1)?.model.variant).toBeUndefined()
    }),
  )

  it.live("asks webfetch permission before downloading an image URL", () =>
    Effect.gen(function* () {
      yield* imageModel("test", "painter", (model) => {
        model.capabilities.input = ["text", "image"]
      })
      const { run } = yield* setup()
      fixture.deny = "webfetch"
      const result = yield* run({ prompt: "x", images: ["https://example.invalid/cat.png"] })
      expect(result.status).toBe("error")
      expect(fixture.assertions.map((item) => [item.action, item.resources])).toEqual([
        ["image_generate", ["test/painter"]],
        ["webfetch", ["https://example.invalid/cat.png"]],
      ])
      expect(fixture.requests).toEqual([])
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

  it.effect("prefers the session's provider, then the newest", () =>
    Effect.sync(() => {
      const newest = info("fresh", "newest")
      const older = info("openai", "gpt-image-2", "gpt-image")
      const own = info("mine", "own-image")
      const all = [newest, older, own]

      expect(pick(all, "mine")).toBe("mine/own-image")
      expect(pick(all, "elsewhere")).toBe("fresh/newest")
      expect(pick(all)).toBe("fresh/newest")
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
