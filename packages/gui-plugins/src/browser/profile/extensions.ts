import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { inflateRawSync } from "node:zlib"
import { Option, Schema } from "effect"

const Manifest = Schema.Struct({
  manifest_version: Schema.Number,
  name: Schema.String,
  version: Schema.String,
  default_locale: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.Unknown),
  icons: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  action: Schema.optional(Schema.Struct({ default_popup: Schema.optional(Schema.String) })),
  browser_action: Schema.optional(Schema.Struct({ default_popup: Schema.optional(Schema.String) })),
  options_page: Schema.optional(Schema.String),
  options_ui: Schema.optional(Schema.Struct({ page: Schema.optional(Schema.String) })),
})

export type Manifest = typeof Manifest.Type

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest))

const Messages = Schema.Record(Schema.String, Schema.Struct({ message: Schema.String }))

const decodeMessages = Schema.decodeUnknownOption(Schema.fromJsonString(Messages))

const decodeObject = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

/** An extension's manifest, read from its directory. Undefined when there is none or it is not an extension's. */
export async function readManifest(directory: string) {
  const text = await readFile(path.join(directory, "manifest.json"), "utf8").catch(() => undefined)

  // Chrome writes manifests with a byte order mark at times.
  return text === undefined ? undefined : Option.getOrUndefined(decodeManifest(text.replace(/^\uFEFF/, "")))
}

/** The extension's display name, with a `__MSG_name__` placeholder resolved from its default locale. */
export async function displayName(directory: string, manifest: Manifest) {
  const match = /^__MSG_(.+)__$/.exec(manifest.name)

  if (!match?.[1] || !manifest.default_locale) return manifest.name

  const text = await readFile(path.join(directory, "_locales", manifest.default_locale, "messages.json"), "utf8").catch(
    () => undefined,
  )

  const messages = text === undefined ? undefined : Option.getOrUndefined(decodeMessages(text.replace(/^\uFEFF/, "")))
  const key = match[1].toLowerCase()
  const entry = Object.entries(messages ?? {}).find(([name]) => name.toLowerCase() === key)

  return entry?.[1].message ?? manifest.name
}

/** The page the toolbar button opens, and the extension's options page, relative to its root. */
export function extensionPages(manifest: Manifest) {
  return {
    popup: manifest.action?.default_popup ?? manifest.browser_action?.default_popup,
    options: manifest.options_ui?.page ?? manifest.options_page,
  }
}

/** The icon closest to 32px, as a data URL; undefined when it has none or the file is large. */
export async function extensionIcon(directory: string, manifest: Manifest) {
  const sizes = Object.entries(manifest.icons ?? {})
    .map(([size, file]) => ({ size: Number(size), file }))
    .filter((icon) => Number.isFinite(icon.size))
    .toSorted((a, b) => Math.abs(a.size - 32) - Math.abs(b.size - 32))

  const icon = sizes[0]

  if (!icon) return undefined
  const file = path.resolve(directory, icon.file.replace(/^\//, ""))

  if (!file.startsWith(path.resolve(directory) + path.sep)) return undefined
  const data = await readFile(file).catch(() => undefined)

  if (!data || data.byteLength > 16_384) return undefined
  const mime = file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".webp") ? "image/webp" : "image/png"

  return `data:${mime};base64,${data.toString("base64")}`
}

/** The extension id Chromium derives from a public key: its SHA-256, first 16 bytes, each nibble as `a`-`p`. */
export function extensionID(publicKey: Uint8Array) {
  return Array.from(createHash("sha256").update(publicKey).digest().subarray(0, 16))
    .flatMap((byte) => [byte >> 4, byte & 15])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join("")
}

/** The id of a store listing: a bare id, or a Chrome Web Store or Edge Add-ons URL that ends with one. */
export function storeTarget(input: string) {
  const value = input.trim()
  const id = /(?:^|\/)([a-p]{32})(?:[/?#]|$)/.exec(value)?.[1]

  if (!id) return undefined

  return { id, store: /microsoftedge\.microsoft\.com/i.test(value) ? ("edge" as const) : ("chrome" as const) }
}

/** The address a store serves an extension's package from, for a browser of this Chromium version. */
export function storeDownloadURL(target: { id: string; store: "chrome" | "edge" }, chromeVersion: string) {
  const query = `id%3D${target.id}%26installsource%3Dondemand%26uc`

  if (target.store === "edge")
    return `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=${query}`

  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=${query}`
}

/**
 * Splits a CRX package into its zip archive and the public key that signed it, so the unpacked extension keeps its
 * store id. CRX3 carries the keys in a protobuf header whose signed data names the id; CRX2 carries one key.
 */
export function parseCrx(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (data.byteLength < 16 || new TextDecoder().decode(data.subarray(0, 4)) !== "Cr24")
    throw new Error("Not a CRX file")
  const version = view.getUint32(4, true)

  if (version === 2) {
    const keyLength = view.getUint32(8, true)
    const signatureLength = view.getUint32(12, true)
    const key = data.subarray(16, 16 + keyLength)

    return { zip: data.subarray(16 + keyLength + signatureLength), key }
  }

  if (version !== 3) throw new Error(`Unsupported CRX version ${version}`)
  const length = view.getUint32(8, true)
  const header = data.subarray(12, 12 + length)
  const fields = protobufFields(header)
  // SignedData { bytes crx_id = 1 } in field 10000 names the id; the matching key proof is the developer's.
  const signed = fields.find((field) => field.number === 10000)?.value
  const crxID = signed ? protobufFields(signed).find((field) => field.number === 1)?.value : undefined

  const keys = fields
    .filter((field) => field.number === 2 || field.number === 3)
    .flatMap((proof) =>
      protobufFields(proof.value)
        .filter((field) => field.number === 1)
        .map((field) => field.value),
    )

  // The crx_id is the first 16 bytes of the developer key's SHA-256; the store adds a key of its own.
  const key =
    keys.find(
      (candidate) =>
        !!crxID && createHash("sha256").update(candidate).digest().subarray(0, 16).equals(Buffer.from(crxID)),
    ) ?? keys[0]

  return { zip: data.subarray(12 + length), key }
}

/** The length-delimited fields of a protobuf message; other wire types are skipped. */
function protobufFields(data: Uint8Array) {
  const fields: { number: number; value: Uint8Array }[] = []
  const cursor = { offset: 0 }

  while (cursor.offset < data.byteLength) {
    const tag = varint(data, cursor)
    const wire = tag % 8
    const number = Math.floor(tag / 8)

    if (wire === 2) {
      const length = varint(data, cursor)
      fields.push({ number, value: data.subarray(cursor.offset, cursor.offset + length) })
      cursor.offset += length
      continue
    }

    if (wire === 0) {
      varint(data, cursor)
      continue
    }

    if (wire === 1) {
      cursor.offset += 8
      continue
    }

    if (wire === 5) {
      cursor.offset += 4
      continue
    }

    throw new Error("Malformed CRX header")
  }

  return fields
}

function varint(data: Uint8Array, cursor: { offset: number }) {
  let value = 0
  let scale = 1

  while (cursor.offset < data.byteLength) {
    const byte = data[cursor.offset++] ?? 0
    value += (byte & 0x7f) * scale

    if (byte < 0x80) return value
    scale *= 128
  }

  throw new Error("Malformed CRX header")
}

/**
 * Unpacks a zip archive into `directory`, refusing entries that would land outside it. Reads the central directory and
 * inflates each entry, stored or deflated, which is all a store package or extension archive uses.
 */
export async function unzip(zip: Uint8Array, directory: string) {
  const data = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))

  if (end < 0) throw new Error("The package is not a zip archive")
  const count = data.readUInt16LE(end + 10)
  const root = path.resolve(directory)

  const entries = Array.from({ length: count }).reduce<{ offset: number; list: ZipEntry[] }>(
    (state) => {
      const at = state.offset

      if (data.readUInt32LE(at) !== 0x02014b50) throw new Error("The package has a damaged directory")
      const nameLength = data.readUInt16LE(at + 28)
      const extra = data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32)

      state.list.push({
        name: data.subarray(at + 46, at + 46 + nameLength).toString("utf8"),
        method: data.readUInt16LE(at + 10),
        size: data.readUInt32LE(at + 20),
        local: data.readUInt32LE(at + 42),
      })

      return { offset: at + 46 + nameLength + extra, list: state.list }
    },
    { offset: data.readUInt32LE(end + 16), list: [] },
  ).list

  await mkdir(root, { recursive: true })

  for (const entry of entries) {
    const target = path.resolve(root, entry.name)

    if (target !== root && !target.startsWith(root + path.sep)) throw new Error("The package has an unsafe path")

    if (entry.name.endsWith("/")) {
      await mkdir(target, { recursive: true })
      continue
    }

    const start = entry.local + 30 + data.readUInt16LE(entry.local + 26) + data.readUInt16LE(entry.local + 28)
    const body = data.subarray(start, start + entry.size)

    if (entry.method !== 0 && entry.method !== 8) throw new Error("The package uses an unsupported compression")
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, entry.method === 8 ? inflateRawSync(body) : body)
  }
}

type ZipEntry = { name: string; method: number; size: number; local: number }

/** Writes the store's public key into the unpacked manifest, so Electron gives the extension its store id. */
export async function pinKey(directory: string, key: Uint8Array) {
  const file = path.join(directory, "manifest.json")
  const text = (await readFile(file, "utf8")).replace(/^\uFEFF/, "")
  const manifest = Option.getOrUndefined(decodeObject(text))

  if (!manifest || "key" in manifest) return
  await writeFile(file, JSON.stringify({ ...manifest, key: Buffer.from(key).toString("base64") }, null, 2))
}
