export * as Bom from "./bom.js"

import { Effect } from "effect"
import { FSUtil } from "./fs-util.js"

const code = 0xfeff
const value = String.fromCharCode(code)

export function split(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  return bom ? value + stripped : stripped
}

export function has(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

export function fromBytes(content: Uint8Array) {
  return split(decode(content))
}

export const readFile = Effect.fn("Bom.readFile")(function* (fs: FSUtil.Interface, filepath: string) {
  return split(decode(yield* fs.readFile(filepath)))
})

export const syncFile = Effect.fn("Bom.syncFile")(function* (fs: FSUtil.Interface, filepath: string, bom: boolean) {
  const decoded = decode(yield* fs.readFile(filepath))
  const current = split(decoded)
  const canonical = join(current.text, bom)
  if (decoded === canonical) return current.text
  yield* fs.writeWithDirs(filepath, canonical)
  return current.text
})

function decode(content: Uint8Array) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(content)
}
