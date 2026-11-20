import { expect, test } from "bun:test"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"
import { storeRedirect } from "./install"
import {
  closestIcon,
  declaredIcon,
  displayName,
  entryPath,
  extensionFiles,
  extensionID,
  parseCrx,
  pinKey,
  readManifest,
  readZip,
  storeTarget,
  type Manifest,
  unzip,
  within,
} from "./extensions"

const field = (number: number, value: Uint8Array) => {
  const tag = varint(number * 8 + 2)

  return Buffer.concat([tag, varint(value.length), value])
}

function varint(value: number) {
  const bytes: number[] = []
  let rest = value

  while (rest >= 0x80) {
    bytes.push(rest % 0x80 | 0x80)
    rest = Math.floor(rest / 0x80)
  }

  bytes.push(rest)

  return Buffer.from(bytes)
}

test.each([2, 3])("CRX3 proof type %i authenticates the requested listing and the whole archive", (algorithm) => {
  const ec = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const publisher = ec()
  const developer = algorithm === 3 ? ec() : generateKeyPairSync("rsa", { modulusLength: 2048 })
  const key = developer.publicKey.export({ format: "der", type: "spki" })
  const id = extensionID(key)
  const signed = field(1, createHash("sha256").update(key).digest().subarray(0, 16))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(signed.length)
  const zip = archive([{ name: "manifest.json", text: '{"name":"Test","version":"1","manifest_version":3}' }])
  const message = Buffer.concat([Buffer.from("CRX3 SignedData\0"), length, signed, zip])

  const proof = (type: number, pair: typeof developer, signature = sign("sha256", message, pair.privateKey)) =>
    field(type, Buffer.concat([field(1, pair.publicKey.export({ format: "der", type: "spki" })), field(2, signature)]))

  const pack = (...fields: Buffer[]) => {
    const header = Buffer.concat(fields)
    const prefix = Buffer.from("Cr24\x03\0\0\0\0\0\0\0")
    prefix.writeUInt32LE(header.length, 8)

    return Buffer.concat([prefix, header, zip])
  }

  const metadata = field(10000, signed)
  const good = pack(proof(3, publisher), proof(algorithm, developer), metadata)
  expect(Buffer.from(parseCrx(good, id)?.key ?? [])).toEqual(key)
  expect(parseCrx(good, "a".repeat(32))).toBeUndefined()
  const flipped = Buffer.from(good)
  flipped[flipped.length - 4] ^= 1
  const old = Buffer.from(good)
  old.writeUInt32LE(2, 4)

  for (const invalid of [flipped, old, good.subarray(0, 18), Buffer.concat([good, Buffer.from([0])]),
    pack(proof(3, publisher), metadata), pack(proof(algorithm, developer, sign("sha256", message, publisher.privateKey)), metadata),
    pack(proof(algorithm, developer), proof(3, publisher, Buffer.from([0])), metadata),
    pack(proof(algorithm, developer), field(10000, field(1, Buffer.alloc(16)))),
    pack(proof(algorithm, developer), metadata, Buffer.from([0x80])), pack(metadata, metadata),
  ]) expect(parseCrx(invalid, id)).toBeUndefined()
})

test("names a store listing by its id, from a bare id or either store's link", () => {
  const id = "nngceckbapebfimnlniiiahkandclblb"

  expect(
    [
      id,
      `https://chromewebstore.google.com/detail/bitwarden-password-manager/${id}`,
      `https://chrome.google.com/webstore/detail/${id}?hl=en`,
      `https://microsoftedge.microsoft.com/addons/detail/bitwarden/${id}`,
      "https://chromewebstore.google.com/detail/name",
      "zzzz",
    ].map(storeTarget),
  ).toEqual([
    { id, store: "chrome" },
    { id, store: "chrome" },
    { id, store: "chrome" },
    { id, store: "edge" },
    undefined,
    undefined,
  ])
})

test("the installer's key replaces any ID requested by the unpacked manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "extension-key-"))

  try {
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Test", version: "1", key: "previous" }))
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" })
    expect(await pinKey(directory, key)).toBe(true)
    expect((await readManifest(directory))?.key).toBe(key.toString("base64"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a store redirect never sends an HTTP request or leaves that store's delivery hosts", () => {
  const http = "http://msedgeextensions.f.tlu.dl.delivery.mp.microsoft.com/file?sig=x"
  const secure = "https://msedgeextensions.sf.tlu.dl.delivery.mp.microsoft.com/file?sig=x"
  expect(storeRedirect("edge", http)).toBe(secure)
  expect(storeRedirect("edge", secure)).toBe(secure)

  for (const refused of [http, secure, "http://clients2.googleusercontent.com/a", "https://clients2.google.com.other.test/a",
    "https://clients2.google.com:8443/a", "https://clients2.google.com@other.test/a"]) {
    expect(storeRedirect("chrome", refused)).toBeUndefined()
  }

  expect(storeRedirect("chrome", "https://clients2.googleusercontent.com/x")).toBe("https://clients2.googleusercontent.com/x")
})

/**
 * A zip archive written by hand (zip.js's writer does not run under Bun): stored entries unless `deflate`, with a
 * declared size and Unix mode that a hostile archive may set to anything.
 */
function archive(entries: { name: string; text: string; deflate?: boolean; size?: number; mode?: number }[]) {
  const files = entries.map((entry) => {
    const data = Buffer.from(entry.text)

    return { ...entry, name: Buffer.from(entry.name), data: entry.deflate ? deflateRawSync(data) : data, raw: data }
  })

  const locals = files.map((file) => {
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(file.deflate ? 8 : 0, 8)
    header.writeUInt32LE(Bun.hash.crc32(file.raw), 14)
    header.writeUInt32LE(file.data.length, 18)
    header.writeUInt32LE(file.size ?? file.raw.length, 22)
    header.writeUInt16LE(file.name.length, 26)

    return Buffer.concat([header, file.name, file.data])
  })

  const offsets = locals.reduce<number[]>((list, item, index) => [...list, (list[index] ?? 0) + item.length], [0])

  const central = files.map((file, index) => {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(file.mode === undefined ? 20 : 0x0314, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(file.deflate ? 8 : 0, 10)
    header.writeUInt32LE(Bun.hash.crc32(file.raw), 16)
    header.writeUInt32LE(file.data.length, 20)
    header.writeUInt32LE(file.size ?? file.raw.length, 24)
    header.writeUInt16LE(file.name.length, 28)
    header.writeUInt32LE(((file.mode ?? 0) << 16) >>> 0, 38)
    header.writeUInt32LE(offsets[index] ?? 0, 42)

    return Buffer.concat([header, file.name])
  })

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offsets.at(-1) ?? 0, 16)

  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

test("unpacks an extension archive, stored and deflated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "extension-unzip-"))

  try {
    await unzip(
      archive([
        { name: "./", text: "" },
        { name: "manifest.json", text: "{}" },
        { name: "popup/", text: "" },
        { name: "popup/index.html", text: "<p>hi</p>".repeat(100), deflate: true },
      ]),
      directory,
    )
    expect(await readFile(path.join(directory, "popup", "index.html"), "utf8")).toBe("<p>hi</p>".repeat(100))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.each([
  ["../escape.txt", undefined],
  ["a/../../escape.txt", undefined],
  ["/etc/passwd", undefined],
  ["C:/Windows/x.dll", undefined],
  ["C:x", undefined],
  ["a\\..\\..\\x", undefined],
  ["file.txt:stream", undefined],
  ["CON", undefined],
  ["nul.txt", undefined],
  ["lib/COM1.js", undefined],
  ["trailing.", undefined],
  ["trailing /x", undefined],
  ["a//b", undefined],
  ["bad\u0000name", undefined],
  ["popup/index.html", ["popup", "index.html"]],
  ["./icons/16.png", ["icons", "16.png"]],
  ["_locales/pt_BR/", ["_locales", "pt_BR"]],
  ["./", []],
  ["console.js", ["console.js"]],
])("entry %p is %p", (name, expected) => {
  expect(entryPath(name)).toEqual(expected)
})

test("refuses an archive with any unsafe or oversized entry, before writing anything", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "extension-unzip-"))
  const ok = { name: "manifest.json", text: "{}" }
  const bomb = { name: "big.js", text: "a".repeat(100_000), deflate: true }

  try {
    expect(readZip(archive([ok, { name: "link", text: "/etc/passwd", mode: 0o120777 }]))).toBeUndefined()
    expect(readZip(archive([ok, { name: "../x", text: "x" }]))).toBeUndefined()
    expect(readZip(archive([ok, { name: ".", text: "x" }]))).toBeUndefined()
    // A declared size past the per-entry limit, and a stored entry whose sizes disagree.
    expect(readZip(archive([ok, { ...bomb, size: 2 ** 31 }]))).toBeUndefined()
    expect(readZip(archive([ok, { name: "a.js", text: "abc", size: 1 }]))).toBeUndefined()
    // A truncated central directory.
    const whole = archive([ok])
    expect(readZip(whole.subarray(0, whole.length - 30))).toBeUndefined()
    expect(readZip(archive([ok, { name: "regular", text: "x", mode: 0o100644 }]))).toHaveLength(2)

    // A deflated entry that inflates past the size it declares stops there.
    await expect(unzip(archive([ok, { ...bomb, size: 10 }]), directory)).rejects.toThrow()
    await expect(unzip(archive([ok, { name: "../escape.txt", text: "x" }]), directory)).rejects.toThrow()
    expect(await readFile(path.join(directory, "..", "escape.txt"), "utf8").catch(() => undefined)).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("paths inside a package stay inside it, and a locale is never a path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "extension-within-"))
  const extension = path.join(root, "extension")

  try {
    expect(within(extension, "icons/16.png")).toBe(path.join(extension, "icons", "16.png"))
    expect(within(extension, "/icons/16.png")).toBe(path.join(extension, "icons", "16.png"))
    expect(["../outside.js", "a/../../outside.js", "", ".", "..", "x/.."].map((file) => within(extension, file))).toEqual(
      [undefined, undefined, undefined, undefined, undefined, undefined],
    )
    expect(within(extension, "..name.js")).toBe(path.join(extension, "..name.js"))

    await mkdir(path.join(root, "evil"), { recursive: true })
    await writeFile(path.join(root, "evil", "messages.json"), JSON.stringify({ name: { message: "Outside" } }))
    await mkdir(path.join(extension, "_locales", "en"), { recursive: true })
    await writeFile(path.join(extension, "_locales", "en", "messages.json"), JSON.stringify({ Name: { message: "Inside" } }))

    const manifest = (locale: string): Manifest => ({
      manifest_version: 3,
      name: "__MSG_name__",
      version: "1",
      default_locale: locale,
    })

    expect(await displayName(extension, manifest("en"))).toBe("Inside")
    expect(await displayName(extension, manifest("../../evil"))).toBe("__MSG_name__")
    expect(await displayName(extension, manifest("..\\..\\evil"))).toBe("__MSG_name__")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("finds page scripts that read synced settings, and reads nothing outside the extension's folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "extension-files-"))
  const vimium = path.join(root, "vimium")
  const plain = path.join(root, "plain")

  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
  }

  const manifest = (js: unknown[]): Manifest => ({
    manifest_version: 3,
    name: "x",
    version: "1",
    content_scripts: [{ js, all_frames: true }, { css: ["page.css"] }],
  })

  try {
    // Vimium's shape: many page scripts, one of which loads the settings from the sync area.
    await write(path.join(vimium, "lib", "utils.js"), "export const x = chrome.storage.local")
    await write(path.join(vimium, "lib", "settings.js"), "let result = await chrome.storage.sync.get(null);")
    // Another extension keeps its settings locally, and points one entry at a file outside its folder.
    await write(path.join(plain, "content.js"), "chrome.storage.local.get('theme')")
    await write(path.join(root, "outside.js"), "chrome.storage.sync.get()")

    expect(await extensionFiles(vimium, manifest(["lib/utils.js", "/lib/settings.js", 7]))).toEqual({ pageSync: true })
    expect(await extensionFiles(plain, manifest(["content.js", "../outside.js", "missing.js"]))).toEqual({
      pageSync: false,
    })
    expect(await extensionFiles(plain, { manifest_version: 3, name: "x", version: "1" })).toEqual({ pageSync: false })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.each([
  ["top-level icons, by size", { icons: { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" } }, "icons/48.png"],
  ["only small icons: the largest", { icons: { "16": "a16.png", "32": "a32.png" } }, "a32.png"],
  ["a leading slash is kept for the reader, which resolves it inside the package", { icons: { "128": "/img/icon.svg" } }, "/img/icon.svg"],
  ["action.default_icon as one file", { action: { default_icon: "images/toolbar.png" } }, "images/toolbar.png"],
  ["action.default_icon by size", { action: { default_icon: { "16": "a16.png", "32": "a32.png", "64": "a64.png" } } }, "a64.png"],
  ["browser_action.default_icon by size (manifest v2)", { browser_action: { default_icon: { "19": "b19.png", "38": "b38.png" } } }, "b38.png"],
  ["page_action.default_icon", { page_action: { default_icon: "page.png" } }, "page.png"],
  ["icons win over the toolbar button's", { icons: { "48": "icon.png" }, action: { default_icon: "toolbar.png" } }, "icon.png"],
  ["icons with no numeric size fall through to the button's", { icons: { large: "big.png" }, action: { default_icon: "toolbar.png" } }, "toolbar.png"],
  ["a value that is neither a file nor files by size", { action: { default_icon: 7 } }, undefined],
  ["no icon declared", { action: { default_popup: "popup.html" } }, undefined],
] as const)("an extension's row icon: %s", (_label, manifest, expected) => {
  expect(declaredIcon(manifest)).toBe(expected)
})

test("an icon given by size is never enlarged at the drawn size on a 2x display", () => {
  // Dark Reader declares 16, 48 and 128: the old rule took the 16 px file for a 20 px row.
  expect(closestIcon({ "16": "dr_16.png", "48": "dr_48.png", "128": "dr_128.png" })).toBe("dr_48.png")
  expect(closestIcon({ "128": "only.png" })).toBe("only.png")
  expect(closestIcon({ "19": "a", "38": "b" }, 32)).toBe("b")
  expect(closestIcon({})).toBeUndefined()
})
