export * as Image from "./image.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { FileSystem } from "./filesystem.js"
import { State } from "./state.js"

export class ResizerUnavailableError extends Schema.TaggedError<ResizerUnavailableError>()(
  "Image.ResizerUnavailableError",
  {},
) {}

export class DecodeError extends Schema.TaggedError<DecodeError>()("Image.DecodeError", {
  resource: Schema.String,
}) {
  override get message() {
    return `Image could not be decoded: ${this.resource}`
  }
}

export class SizeError extends Schema.TaggedError<SizeError>()("Image.SizeError", {
  resource: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  bytes: Schema.Number,
  maxWidth: Schema.Number,
  maxHeight: Schema.Number,
  maxBytes: Schema.Number,
}) {
  override get message() {
    return `Image ${this.resource} is ${this.width}x${this.height} with base64 size ${this.bytes}, exceeding configured limits ${this.maxWidth}x${this.maxHeight}/${this.maxBytes} bytes`
  }
}

export type Limits = {
  autoResize: boolean
  maxWidth: number
  maxHeight: number
  maxBase64Bytes: number
}

export type Editor = {
  configure: (limits: Partial<Limits>) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly normalize: (
    resource: string,
    content: FileSystem.Content & { readonly encoding: "base64" },
  ) => Effect.Effect<
    FileSystem.Content & { readonly encoding: "base64" },
    ResizerUnavailableError | DecodeError | SizeError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Image") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Limits, Editor>({
      name: "image",
      initial: () => ({
        autoResize: true,
        maxWidth: 2_000,
        maxHeight: 2_000,
        maxBase64Bytes: 5 * 1024 * 1024,
      }),
      editor: (editor) => ({
        configure: (limits) => {
          if (limits.autoResize !== undefined) editor.autoResize = limits.autoResize
          if (limits.maxWidth !== undefined) editor.maxWidth = limits.maxWidth
          if (limits.maxHeight !== undefined) editor.maxHeight = limits.maxHeight
          if (limits.maxBase64Bytes !== undefined) editor.maxBase64Bytes = limits.maxBase64Bytes
        },
      }),
    })
    const loadAdapter = yield* Effect.cached(
      Effect.tryPromise({
        try: () => import("./image/photon.js"),
        catch: () => new ResizerUnavailableError(),
      }).pipe(Effect.flatMap((adapter) => adapter.make)),
    )
    const normalize = Effect.fn("Image.normalize")(function* (
      resource: string,
      content: FileSystem.Content & { readonly encoding: "base64" },
    ) {
      const normalize = yield* loadAdapter
      return yield* normalize(resource, content, state.get())
    })
    return Service.of({ transform: state.transform, reload: state.reload, normalize })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
