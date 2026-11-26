import { inflateRawSync } from "node:zlib"

/** The files of a flat zip (stored or deflated), by name, read from its central directory; `fail` gets what is wrong. */
export function unzip(bytes: Uint8Array, zip: string, fail: (message: string) => never) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = Array.from({ length: Math.min(bytes.length - 21, 65_558) }, (_, back) => bytes.length - 22 - back).find(
    (at) => at >= 0 && view.getUint32(at, true) === 0x06054b50,
  )
  if (end === undefined) fail(`${zip} is not a zip`)
  const count = view.getUint16(end + 10, true)
  const files = new Map<string, Uint8Array>()
  let entry = view.getUint32(end + 16, true)
  for (let index = 0; index < count; index++) {
    if (view.getUint32(entry, true) !== 0x02014b50) fail(`${zip}: a broken central directory`)
    const method = view.getUint16(entry + 10, true)
    const size = view.getUint32(entry + 20, true)
    const length = view.getUint32(entry + 24, true)
    const name = new TextDecoder().decode(bytes.subarray(entry + 46, entry + 46 + view.getUint16(entry + 28, true)))
    const local = view.getUint32(entry + 42, true)
    entry += 46 + view.getUint16(entry + 28, true) + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true)
    if (name.endsWith("/")) continue
    if (/[\\/]|^\.\.?$/.test(name)) fail(`${zip}: an entry outside the directory: ${name}`)
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + size)
    const content = method === 0 ? data : method === 8 ? new Uint8Array(inflateRawSync(data)) : undefined
    if (!content || content.length !== length) fail(`${zip}: cannot read ${name} (method ${method})`)
    files.set(name, content)
  }
  return files
}
