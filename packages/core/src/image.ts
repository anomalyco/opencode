export * as Image from "./image.js"

import { base64ToBytes, bytesToBase64 } from "@opencode/util/base64"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import type { FileSystem } from "./filesystem.js"
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
    if (this.width <= 0 || this.height <= 0)
      return `Image ${this.resource} has base64 size ${this.bytes}, exceeding configured limit ${this.maxBytes} bytes`
    return `Image ${this.resource} is ${this.width}x${this.height} with base64 size ${this.bytes}, exceeding configured limits ${this.maxWidth}x${this.maxHeight}/${this.maxBytes} bytes`
  }
}

export type Limits = {
  autoResize: boolean
  maxWidth: number
  maxHeight: number
  maxBase64Bytes: number
}

export type ResizerInput = {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly limits: Readonly<Limits>
}

export type ResizerOutput = {
  readonly bytes: Uint8Array
  readonly mime: string
}

/**
 * Host-supplied image resizer for runtimes without the built-in Photon WASM
 * module (such as workerd). Called when `media.image.auto_resize` is enabled;
 * when disabled, `Image` enforces `maxBase64Bytes` directly and skips calling
 * the resizer. Return `undefined` to keep the original image untouched (subject
 * to `limits.maxBase64Bytes`), or return resized bytes with an output MIME type
 * of `image/png`, `image/jpeg`, `image/gif`, or `image/webp` within
 * `limits.maxWidth` / `limits.maxHeight`. Throwing, rejecting, or returning an
 * empty or unsupported output logs a warning and fails with
 * `ResizerUnavailableError` so callers fall back gracefully instead of
 * rejecting the prompt on transient service failures.
 */
export type Resizer = (input: ResizerInput) => ResizerOutput | undefined | Promise<ResizerOutput | undefined>

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

const makeState = () =>
  State.create<Limits, Editor>({
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

const sizeError = (resource: string, bytes: number, limits: Readonly<Limits>) =>
  new SizeError({
    resource,
    width: 0,
    height: 0,
    bytes,
    maxWidth: limits.maxWidth,
    maxHeight: limits.maxHeight,
    maxBytes: limits.maxBase64Bytes,
  })

const ALLOWED_OUTPUT_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

const normalizeWithResizer = (resizer: Resizer) =>
  Effect.fn("Image.normalize")(function* (
    resource: string,
    content: FileSystem.Content & { readonly encoding: "base64" },
    limits: Readonly<Limits>,
  ) {
    if (!limits.autoResize) {
      if (content.content.length > limits.maxBase64Bytes)
        return yield* sizeError(resource, content.content.length, limits)
      return content
    }
    const bytes = yield* Effect.try({
      try: () => base64ToBytes(content.content),
      catch: () => new DecodeError({ resource }),
    })
    const result = yield* Effect.tryPromise({
      try: async () => resizer({ bytes, mime: content.mime, limits: { ...limits } }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("image.resizer_failed").pipe(
          Effect.annotateLogs({ resource, error: String(cause) }),
          Effect.andThen(Effect.fail(new ResizerUnavailableError())),
        ),
      ),
    )
    if (result === undefined) {
      if (content.content.length > limits.maxBase64Bytes)
        return yield* sizeError(resource, content.content.length, limits)
      return content
    }
    const mime = result.mime.toLowerCase()
    if (result.bytes.length === 0 || !ALLOWED_OUTPUT_MIMES.has(mime)) {
      yield* Effect.logWarning("image.resizer_invalid_output").pipe(
        Effect.annotateLogs({ resource, mime: result.mime, bytes: result.bytes.length }),
      )
      return yield* new ResizerUnavailableError()
    }
    const encodedBytes = Math.ceil(result.bytes.length / 3) * 4
    if (encodedBytes > limits.maxBase64Bytes) return yield* sizeError(resource, encodedBytes, limits)
    return { ...content, content: bytesToBase64(result.bytes), encoding: "base64" as const, mime }
  })

const layer = (resizer?: Resizer) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = makeState()
      if (resizer !== undefined) {
        const run = normalizeWithResizer(resizer)
        const normalize: Interface["normalize"] = (resource, content) => run(resource, content, state.get())
        return Service.of({ transform: state.transform, reload: state.reload, normalize })
      }
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

export const configured = (resizer?: Resizer) => makeLocationNode({ service: Service, layer: layer(resizer), deps: [] })

export const node = configured()
