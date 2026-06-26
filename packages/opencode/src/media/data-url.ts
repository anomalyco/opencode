export type Parsed = {
  readonly mime: string
  readonly data: Uint8Array
}

export function parse(input: string): Parsed | undefined {
  if (!input.startsWith("data:")) return undefined
  const comma = input.indexOf(",")
  if (comma === -1) return undefined
  const meta = input.slice(5, comma)
  if (!meta.endsWith(";base64")) return undefined
  const mime = meta.slice(0, -7)
  if (!mime) return undefined
  return {
    mime,
    data: Buffer.from(input.slice(comma + 1), "base64"),
  }
}

export function format(input: { readonly mime: string; readonly data: Uint8Array }) {
  return `data:${input.mime};base64,${Buffer.from(input.data).toString("base64")}`
}

export * as DataUrl from "./data-url"
