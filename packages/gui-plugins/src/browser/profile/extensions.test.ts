import { expect, test } from "bun:test"
import { createHash, generateKeyPairSync } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseCrx, storeTarget, unzip } from "./extensions"

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

  const parsed = parseCrx(Buffer.concat([prefix, header, zip]))

  expect(Buffer.from(parsed.key ?? []).equals(developer)).toBe(true)
  expect(Buffer.from(parsed.zip).equals(zip)).toBe(true)
  expect(() => parseCrx(Buffer.from("PK\x03\x04 not a crx"))).toThrow()
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

test("unpacks an extension archive and refuses one whose entries would land outside its folder", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "extension-unzip-"))

  // A stored (uncompressed) zip, as written by hand: zip.js's writer does not run under Bun.
  const archive = (entries: Record<string, string>) => {
    const files = Object.entries(entries).map(([name, text]) => ({
      name: Buffer.from(name),
      data: Buffer.from(text),
    }))

    const locals = files.map((file) => {
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt32LE(Bun.hash.crc32(file.data), 14)
      header.writeUInt32LE(file.data.length, 18)
      header.writeUInt32LE(file.data.length, 22)
      header.writeUInt16LE(file.name.length, 26)

      return Buffer.concat([header, file.name, file.data])
    })

    const offsets = locals.reduce<number[]>((list, item, index) => [...list, (list[index] ?? 0) + item.length], [0])

    const central = files.map((file, index) => {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt32LE(Bun.hash.crc32(file.data), 16)
      header.writeUInt32LE(file.data.length, 20)
      header.writeUInt32LE(file.data.length, 24)
      header.writeUInt16LE(file.name.length, 28)
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

  try {
    await unzip(archive({ "manifest.json": "{}", "popup/index.html": "<p>hi</p>" }), path.join(directory, "ok"))
    expect(await readFile(path.join(directory, "ok", "popup", "index.html"), "utf8")).toBe("<p>hi</p>")

    await expect(unzip(archive({ "../escape.txt": "x" }), path.join(directory, "bad"))).rejects.toThrow("unsafe path")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
