import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { inflateRaw } from "node:zlib"
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
  // What the compatibility check reads. Lists keep any entry, and the keys below only need to be present, so an
  // unusual value never makes a manifest unreadable.
  permissions: Schema.optional(Schema.Array(Schema.Unknown)),
  host_permissions: Schema.optional(Schema.Array(Schema.Unknown)),
  optional_permissions: Schema.optional(Schema.Array(Schema.Unknown)),
  optional_host_permissions: Schema.optional(Schema.Array(Schema.Unknown)),
  background: Schema.optional(Schema.Unknown),
  page_action: Schema.optional(Schema.Struct({ default_popup: Schema.optional(Schema.String) })),
  commands: Schema.optional(Schema.Unknown),
  devtools_page: Schema.optional(Schema.Unknown),
  side_panel: Schema.optional(Schema.Unknown),
  omnibox: Schema.optional(Schema.Unknown),
  oauth2: Schema.optional(Schema.Unknown),
  chrome_url_overrides: Schema.optional(Schema.Unknown),
  chrome_settings_overrides: Schema.optional(Schema.Unknown),
  declarative_net_request: Schema.optional(Schema.Unknown),
  content_scripts: Schema.optional(Schema.Array(Schema.Unknown)),
})

const ContentScript = Schema.Struct({ js: Schema.optional(Schema.Array(Schema.Unknown)) })

/** What an extension's files show about whether it works here, beyond what its manifest declares. */
export type ExtensionFiles = { readonly pageSync: boolean }

// A text search over what a content script ships, so a bundle that calls the API through a variable is missed.
const SYNC = /storage\s*\.\s*sync\b|storage\s*\[\s*["']sync["']\s*\]/

/** Bounds on what the scan reads, so a large or hostile package costs little: files, bytes per file, bytes in all. */
const SCAN = { files: 64, file: 2 * 1024 * 1024, total: 8 * 1024 * 1024 }

/**
 * What the extension's files show: whether the scripts it runs in web pages use `chrome.storage.sync`. Electron's
 * content scripts have no `sync` area, so those scripts fail where they read their settings. Searches the declared
 * content-script files as text, within `SCAN`; a file outside the extension's directory is never read.
 */
export async function extensionFiles(directory: string, manifest: Manifest): Promise<ExtensionFiles> {
  const files = [
    ...new Set(
      (manifest.content_scripts ?? [])
        .filter(Schema.is(ContentScript))
        .flatMap((script) => (script.js ?? []).filter(Schema.is(Schema.String))),
    ),
  ]
    .flatMap((entry) => within(directory, entry) ?? [])
    .slice(0, SCAN.files)

  const budget = { left: SCAN.total }

  for (const file of files) {
    const size = await stat(file).then(
      (info) => info.size,
      () => Infinity,
    )

    if (size > SCAN.file || size > budget.left) continue
    budget.left -= size

    if (SYNC.test(await readFile(file, "utf8").catch(() => ""))) return { pageSync: true }
  }

  return { pageSync: false }
}

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

  // A locale is a code such as `en` or `pt_BR`, never a path; its file must stay inside the package.
  const locale = manifest.default_locale
  const file = locale && /^[A-Za-z0-9_-]{1,16}$/.test(locale) ? within(directory, `_locales/${locale}/messages.json`) : undefined

  if (!match?.[1] || !file) return manifest.name
  const text = await readFile(file, "utf8").catch(() => undefined)

  const messages = text === undefined ? undefined : Option.getOrUndefined(decodeMessages(text.replace(/^\uFEFF/, "")))
  const key = match[1].toLowerCase()
  const entry = Object.entries(messages ?? {}).find(([name]) => name.toLowerCase() === key)

  return entry?.[1].message ?? manifest.name
}

/**
 * A page of the extension's own package, from a path in its manifest or a `setPopup` call. As in Chrome, the path is
 * always read from the package's root, so an absolute or protocol-relative address names a file of the package and
 * never another site. Undefined for an empty path.
 */
export function extensionPage(id: string, file: string | undefined) {
  const text = `chrome-extension://${id}/${file?.replace(/^[/\\]+/, "") ?? ""}`

  if (!file || !URL.canParse(text)) return undefined
  const url = new URL(text)

  return url.protocol === "chrome-extension:" && url.host === id ? url.href : undefined
}

/** The page the toolbar button opens, and the extension's options page, relative to its root. */
export function extensionPages(manifest: Manifest) {
  return {
    popup: manifest.action?.default_popup ?? manifest.browser_action?.default_popup,
    options: manifest.options_ui?.page ?? manifest.options_page,
  }
}

/**
 * `file` resolved against `root` when it lands strictly inside it, else undefined. A leading slash reads from the
 * root, as extension paths do; `..`, another drive or an absolute path that leaves the root is refused.
 */
export function within(root: string, file: string) {
  const base = path.resolve(root)
  const target = path.resolve(base, file.replace(/^[/\\]+/, ""))
  const relative = path.relative(base, target)

  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? target
    : undefined
}

/** Of an icon given in several sizes, by size, the one closest to 32px. */
export function closestIcon<T>(sizes: Readonly<Record<string, T>>) {
  return Object.entries(sizes)
    .filter(([size]) => Number.isFinite(Number(size)))
    .toSorted((a, b) => Math.abs(Number(a[0]) - 32) - Math.abs(Number(b[0]) - 32))[0]?.[1]
}

/** The most an icon file may hold; a larger one is not shown. */
const ICON_BYTES = 65_536

/** An icon file of the package: its bytes, when it is inside `root` and within `ICON_BYTES`; read only then. */
export async function readIcon(root: string, file: string) {
  const target = within(root, file)
  const size = target ? await stat(target).then((info) => (info.isFile() ? info.size : Infinity), () => Infinity) : Infinity

  return target && size <= ICON_BYTES ? readFile(target).catch(() => undefined) : undefined
}

/** The icon closest to 32px, as a data URL; undefined when it has none or the file is large. */
export async function extensionIcon(directory: string, manifest: Manifest) {
  const file = closestIcon(manifest.icons ?? {})
  const data = file ? await readIcon(directory, file) : undefined
  const extension = file ? path.extname(file).toLowerCase() : ""
  const mime = extension === ".svg" ? "image/svg+xml" : extension === ".webp" ? "image/webp" : "image/png"

  return data ? `data:${mime};base64,${data.toString("base64")}` : undefined
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
 * Splits a CRX package into its zip archive and the developer's public key, so the unpacked extension keeps its store
 * id. CRX3 carries the keys in a protobuf header whose signed data names the id, and the key is the one whose hash is
 * that id (the store adds a key of its own, which never names the package); CRX2 carries one key. Undefined for
 * anything that is not a well-formed CRX2 or CRX3 file.
 */
export function parseCrx(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (data.byteLength < 12 || new TextDecoder().decode(data.subarray(0, 4)) !== "Cr24") return undefined
  const version = view.getUint32(4, true)

  if (version === 2) {
    const keyLength = data.byteLength >= 16 ? view.getUint32(8, true) : Infinity
    const signatureLength = data.byteLength >= 16 ? view.getUint32(12, true) : Infinity

    if (16 + keyLength + signatureLength > data.byteLength) return undefined

    return { zip: data.subarray(16 + keyLength + signatureLength), key: data.subarray(16, 16 + keyLength) }
  }

  const length = view.getUint32(8, true)

  if (version !== 3 || 12 + length > data.byteLength) return undefined
  const fields = protobufFields(data.subarray(12, 12 + length))

  if (!fields) return undefined
  // SignedData { bytes crx_id = 1 } in field 10000 names the id.
  const signed = fields.find((field) => field.number === 10000)?.value
  const crxID = signed ? protobufFields(signed)?.find((field) => field.number === 1)?.value : undefined

  const key = fields
    .filter((field) => field.number === 2 || field.number === 3)
    .flatMap((proof) => (protobufFields(proof.value) ?? []).filter((field) => field.number === 1))
    .map((field) => field.value)
    .find(
      (candidate) =>
        !!crxID && createHash("sha256").update(candidate).digest().subarray(0, 16).equals(Buffer.from(crxID)),
    )

  return { zip: data.subarray(12 + length), key }
}

/** The length-delimited fields of a protobuf message, other wire types skipped; undefined when it is malformed. */
function protobufFields(data: Uint8Array) {
  const fields: { number: number; value: Uint8Array }[] = []
  const cursor = { offset: 0 }

  while (cursor.offset < data.byteLength) {
    const tag = varint(data, cursor)
    const wire = tag === undefined ? -1 : tag % 8
    const skipped = wire === 0 ? (varint(data, cursor) === undefined ? undefined : 0) : undefined
    const length = wire === 2 ? varint(data, cursor) : wire === 0 ? skipped : wire === 1 ? 8 : wire === 5 ? 4 : undefined

    if (tag === undefined || length === undefined || cursor.offset + length > data.byteLength) return undefined

    if (wire === 2) fields.push({ number: Math.floor(tag / 8), value: data.subarray(cursor.offset, cursor.offset + length) })
    cursor.offset += length
  }

  return fields
}

/** A protobuf varint at the cursor, which it moves past; undefined when it runs off the end or past 2^53. */
function varint(data: Uint8Array, cursor: { offset: number }) {
  const state = { value: 0, scale: 1 }

  while (cursor.offset < data.byteLength && state.scale <= 2 ** 49) {
    const byte = data[cursor.offset++] ?? 0
    state.value += (byte & 0x7f) * state.scale

    if (byte < 0x80) return state.value
    state.scale *= 128
  }

  return undefined
}

/**
 * What an archive may unpack to, so a hostile package costs little: entries, bytes in one entry, bytes in all. The
 * largest store extensions unpack to a few tens of megabytes.
 */
const ZIP_LIMITS = { entries: 10_000, entry: 64 * 1024 * 1024, total: 256 * 1024 * 1024 }

const inflate = promisify(inflateRaw)

/** One file or directory of an archive, checked: its safe path, and where its bytes are. */
type ZipEntry = {
  readonly segments: readonly string[]
  readonly directory: boolean
  readonly method: number
  readonly start: number
  readonly compressed: number
  readonly size: number
}

/**
 * A zip entry's name as path segments that are safe on every system: forward slashes only, and no absolute path,
 * drive or stream (`:`), `..`, empty segment, control or reserved character, trailing dot or space, or Windows device
 * name (`CON`, `nul.txt`, `COM1`). `.` segments drop out, so `./` is the root itself. Undefined for an unsafe name.
 */
export function entryPath(name: string) {
  const body = name.endsWith("/") ? name.slice(0, -1) : name
  // oxlint-disable-next-line no-control-regex -- SAFETY: control characters are what this refuses.
  const refused = /[\\:*?"<>|\u0000-\u001f]/.test(body) || body.startsWith("/")
  const segments = body.split("/").filter((segment) => segment !== ".")

  const safe = segments.every(
    (segment) =>
      segment !== "" &&
      segment !== ".." &&
      !/[. ]$/.test(segment) &&
      !/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(segment),
  )

  return refused || !safe ? undefined : segments
}

/**
 * The entries of a zip archive, every one checked before anything is written: a safe path (`entryPath`), stored or
 * deflated, not encrypted, not a symbolic link, inside the archive's bytes, and within `ZIP_LIMITS`. Undefined when
 * any entry fails, or the archive is damaged or uses ZIP64.
 */
export function readZip(zip: Uint8Array) {
  const data = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))

  if (end < 0 || end + 22 > data.length) return undefined
  const count = data.readUInt16LE(end + 10)

  if (count > ZIP_LIMITS.entries) return undefined

  return Array.from({ length: count }).reduce<{ next: number; total: number; list: ZipEntry[] } | undefined>(
    (state) => {
      const entry = state ? zipEntry(data, state.next) : undefined

      if (!state || !entry || state.total + entry.value.size > ZIP_LIMITS.total) return undefined
      state.list.push(entry.value)

      return { next: entry.next, total: state.total + entry.value.size, list: state.list }
    },
    { next: data.readUInt32LE(end + 16), total: 0, list: [] },
  )?.list
}

/** The central directory record at `at`, checked, and where the next one starts. */
function zipEntry(data: Buffer, at: number): { value: ZipEntry; next: number } | undefined {
  if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) return undefined
  const nameLength = data.readUInt16LE(at + 28)
  const next = at + 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32)

  if (next > data.length) return undefined
  const name = data.subarray(at + 46, at + 46 + nameLength).toString("utf8")
  const segments = entryPath(name)
  const directory = name.endsWith("/")
  const method = data.readUInt16LE(at + 10)
  const compressed = data.readUInt32LE(at + 20)
  const size = data.readUInt32LE(at + 24)
  const local = data.readUInt32LE(at + 42)
  // A Unix archive keeps the file's mode in the high half of its external attributes.
  const link = data[at + 5] === 3 && ((data.readUInt32LE(at + 38) >>> 16) & 0o170000) === 0o120000
  const encrypted = (data.readUInt16LE(at + 8) & 1) !== 0

  if (!segments || link || encrypted || (!directory && segments.length === 0)) return undefined

  if (!directory && (size > ZIP_LIMITS.entry || !(method === 8 || (method === 0 && compressed === size))))
    return undefined

  if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) return undefined
  const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)

  if (start + compressed > data.length) return undefined

  return { value: { segments, directory, method, start, compressed, size }, next }
}

/**
 * Unpacks a zip archive into `directory`, after `readZip` checked every entry. Inflates off the main thread and stops
 * when an entry inflates past the size it declares. Rejects for an unsafe or damaged archive; what it wrote by then
 * is the caller's to remove.
 */
export async function unzip(zip: Uint8Array, directory: string) {
  const entries = readZip(zip)

  if (!entries) throw new Error("The package is damaged or unsafe")
  const data = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength)
  const root = path.resolve(directory)
  await mkdir(root, { recursive: true })

  for (const entry of entries) {
    const target = path.join(root, ...entry.segments)

    if (entry.directory) {
      await mkdir(target, { recursive: true })
      continue
    }

    const body = data.subarray(entry.start, entry.start + entry.compressed)
    const bytes = entry.method === 8 ? await inflate(body, { maxOutputLength: Math.max(entry.size, 1) }) : body

    if (bytes.length !== entry.size) throw new Error("The package is damaged")
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
}

/**
 * Writes the store's public key into the unpacked manifest, so Electron gives the extension its store id. False when
 * the package has no manifest object to write it into.
 */
export async function pinKey(directory: string, key: Uint8Array) {
  const file = path.join(directory, "manifest.json")
  const text = await readFile(file, "utf8").catch(() => undefined)
  const manifest = text === undefined ? undefined : Option.getOrUndefined(decodeObject(text.replace(/^\uFEFF/, "")))

  if (!manifest) return false

  if (!("key" in manifest))
    await writeFile(file, JSON.stringify({ ...manifest, key: Buffer.from(key).toString("base64") }, null, 2))

  return true
}
