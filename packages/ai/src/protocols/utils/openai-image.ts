import { Schema } from "effect"

const dimensions = (value: string) => {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) return undefined
  return { width: Number(match[1]), height: Number(match[2]) }
}

export const Size = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value === "auto") return undefined
    const parsed = dimensions(value)
    if (!parsed) return "image size must be `auto` or `{width}x{height}`"
    return parsed.width > 0 && parsed.height > 0 ? undefined : "image dimensions must be positive integers"
  }),
)

export const OpenAIImage = {
  Size,
} as const
