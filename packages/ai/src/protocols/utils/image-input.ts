import { Effect, Encoding } from "effect"
import type { ImageInput } from "../../image"
import { InvalidRequestReason, LLMError } from "../../schema"

const invalid = (module: string, message: string) =>
  new LLMError({
    module,
    method: "generate",
    reason: new InvalidRequestReason({ message }),
  })

export const dataUrl = (input: Extract<ImageInput, { readonly type: "bytes" }>) =>
  `data:${input.mediaType};base64,${Encoding.encodeBase64(input.data)}`

export const decodeDataUrl = (
  url: string,
  module: string,
): Effect.Effect<{ readonly mediaType: string; readonly data: Uint8Array } | undefined, LLMError> => {
  if (!url.startsWith("data:")) return Effect.succeed(undefined)
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (!match) return Effect.fail(invalid(module, "Image data URLs must contain a MIME type and base64 data"))
  return Effect.fromResult(Encoding.decodeBase64(match[2])).pipe(
    Effect.mapError(() => invalid(module, "Image data URL contains invalid base64 data")),
    Effect.map((data) => ({ mediaType: match[1], data })),
  )
}

export const invalidImageInput = invalid

export const ImageInputs = {
  dataUrl,
  decodeDataUrl,
  invalid: invalidImageInput,
} as const
