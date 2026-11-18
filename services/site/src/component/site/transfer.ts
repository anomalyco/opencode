import { z } from "zod"

/** The Settings › Export format. Every setting is included, defaults too, so an import restores it exactly. */
export function transferJson(data: { settings: unknown; designCopy: unknown; theme: string }) {
  return JSON.stringify({ version: 1, ...data }, null, 2)
}

/**
 * Reads pasted or picked text as an export. A bare settings object (the saved localStorage value)
 * is accepted too. The settings and copy are validated by their own stores on import.
 */
export function parseTransfer(text: string) {
  const json = parseJson(text)
  const data = envelope.safeParse(json)
  if (data.success) return data.data
  if (typeof json === "object" && json !== null && !Array.isArray(json) && !("version" in json))
    return { version: 1, settings: json, designCopy: undefined, theme: undefined }
  return undefined
}

const envelope = z.object({
  version: z.literal(1),
  settings: z.record(z.string(), z.unknown()),
  designCopy: z.unknown(),
  theme: z.unknown(),
})

// Pasted text can be anything.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
