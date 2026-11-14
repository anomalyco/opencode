import { expect, test } from "bun:test"
import { createHash, generateKeyPairSync } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"
import {
  displayName,
  entryPath,
  extensionFiles,
  parseCrx,
  readZip,
  storeTarget,
  unzip,
  within,
  type Manifest,
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

const publicKey = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" })

test("unpacks a CRX3 package with the developer's key, which the store's own key does not replace", () => {
  const store = publicKey()
  const developer = publicKey()
  const crxID = createHash("sha256").update(developer).digest().subarray(0, 16)

  // The store's proof is listed first; the signed header data names the developer key's id.
  const header = Buffer.concat([
    field(2, field(1, store)),
    field(3, field(1, developer)),
    field(10000, field(1, crxID)),
  ])

  const zip = Buffer.from("PK\x03\x04zip")
  const prefix = Buffer.alloc(12)
  prefix.write("Cr24", 0, "latin1")
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(header.length, 8)

  const crx = Buffer.concat([prefix, header, zip])
  const parsed = parseCrx(crx)

  expect(Buffer.from(parsed?.key ?? []).equals(developer)).toBe(true)
  expect(Buffer.from(parsed?.zip ?? []).equals(zip)).toBe(true)

  // Without a signed id, no key is guessed: the store's would give every such package the same id.
  const unsigned = Buffer.concat([field(2, field(1, store))])
  const bare = Buffer.from(prefix)
  bare.writeUInt32LE(unsigned.length, 8)
  expect(parseCrx(Buffer.concat([bare, unsigned, zip]))?.key).toBeUndefined()

  // A header that claims more bytes than the file has, a field that runs off its message, another format.
  const long = Buffer.from(crx)
  long.writeUInt32LE(crx.length, 8)
  const runaway = Buffer.from(crx)
  runaway[12 + 1] = 0x7f
  const crx2 = Buffer.alloc(16)
  crx2.write("Cr24", 0, "latin1")
  crx2.writeUInt32LE(2, 4)
  crx2.writeUInt32LE(0xffffffff, 8)
  expect([long, runaway, crx2, Buffer.from("PK\x03\x04 not a crx"), Buffer.from("Cr24")].map(parseCrx)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
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
