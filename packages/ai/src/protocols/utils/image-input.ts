import { Effect, Encoding } from "effect"
import type { ImageInput } from "../../image.js"
import { InvalidRequestError, AIError } from "../../schema/index.js"

const invalid = (message: string, cause?: unknown) =>
  new AIError({
    reason: new InvalidRequestError({ message, cause }),
  })

export const dataUrl = (input: Extract<ImageInput, { readonly type: "bytes" }>) =>
  `data:${input.mediaType};base64,${Encoding.encodeBase64(input.data)}`

export const decodeDataUrl = (
  url: string,
): Effect.Effect<{ readonly mediaType: string; readonly data: Uint8Array } | undefined, AIError> => {
  if (!url.startsWith("data:")) return Effect.undefined
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (!match) return Effect.fail(invalid("Image data URLs must contain a MIME type and base64 data"))
  return Effect.fromResult(Encoding.decodeBase64(match[2])).pipe(
    Effect.mapError((cause) => invalid("Image data URL contains invalid base64 data", cause)),
    Effect.map((data) => ({ mediaType: match[1], data })),
  )
}

export const invalidImageInput = invalid

export const ImageInputs = {
  dataUrl,
  decodeDataUrl,
  invalid: invalidImageInput,
} as const
