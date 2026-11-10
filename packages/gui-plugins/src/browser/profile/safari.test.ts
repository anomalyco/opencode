import { expect, test } from "bun:test"
import { parseBinaryCookies } from "./safari"

// One cookie record as Safari writes it: little-endian offsets into the record, then null-terminated strings.
function record(input: { host: string; name: string; path: string; value: string; flags: number; expiry: number }) {
  const strings = [input.host, input.name, input.path, input.value].map((text) => Buffer.from(`${text}\0`))
  const head = 56
  const size = head + strings.reduce((total, item) => total + item.length, 0)
  const data = Buffer.alloc(size)
  data.writeUInt32LE(size, 0)
  data.writeUInt32LE(input.flags, 8)
  strings.reduce((offset, item, index) => {
    data.writeUInt32LE(offset, 16 + index * 4)
    item.copy(data, offset)

    return offset + item.length
  }, head)
  data.writeDoubleLE(input.expiry, 40)

  return data
}

function page(records: Buffer[]) {
  const header = 8 + records.length * 4 + 4
  const offsets = records.reduce<number[]>((list, item, index) => [...list, (list[index] ?? 0) + item.length], [header])
  const data = Buffer.alloc(header)
  data.writeUInt32BE(0x100, 0)
  data.writeUInt32LE(records.length, 4)
  records.forEach((_, index) => data.writeUInt32LE(offsets[index] ?? 0, 8 + index * 4))

  return Buffer.concat([data, ...records])
}

test("reads Safari's binary cookie file, with its flags and 2001-based expiry", () => {
  const pages = [
    page([
      record({ host: ".github.com", name: "user_session", path: "/", value: "secret", flags: 5, expiry: 700_000_000 }),
      record({ host: "example.com", name: "theme", path: "/docs", value: "dark", flags: 0, expiry: 0 }),
    ]),
  ]

  const header = Buffer.alloc(8 + pages.length * 4)
  header.write("cook", 0, "latin1")
  header.writeUInt32BE(pages.length, 4)
  pages.forEach((item, index) => header.writeUInt32BE(item.length, 8 + index * 4))

  expect(parseBinaryCookies(Buffer.concat([header, ...pages]))).toEqual({
    cookies: [
      {
        host: ".github.com",
        name: "user_session",
        value: "secret",
        path: "/",
        secure: true,
        httpOnly: true,
        expires: 1_678_307_200,
        sameSite: "unspecified",
      },
      {
        host: "example.com",
        name: "theme",
        value: "dark",
        path: "/docs",
        secure: false,
        httpOnly: false,
        expires: undefined,
        sameSite: "unspecified",
      },
    ],
    protected: 0,
    failed: 0,
  })
  expect(() => parseBinaryCookies(Buffer.from("not a cookie file"))).toThrow()
})
