import { expect, test } from "bun:test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { decryptChromium, deriveCbcKey, readChromiumCookies, readChromiumHosts, type ChromiumKey } from "./chromium"

// Copies go under the test's own directory, as the profile puts them under the app's data.
function scratch(directory: string) {
  return { directory: path.join(directory, "copies"), live: new Set<string>(), log: () => undefined }
}

// Encrypts as Chromium does, with the SHA-256 of the host in front of the value since database version 24.
function gcm(key: Uint8Array, host: string, value: string, digest = true) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)

  const plain = Buffer.concat([
    digest ? createHash("sha256").update(host).digest() : Buffer.alloc(0),
    Buffer.from(value),
  ])

  const body = Buffer.concat([cipher.update(plain), cipher.final()])

  return Buffer.concat([Buffer.from("v10"), nonce, body, cipher.getAuthTag()])
}

function cbc(key: Uint8Array, version: "v10" | "v11", host: string, value: string) {
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20))
  const plain = Buffer.concat([createHash("sha256").update(host).digest(), Buffer.from(value)])

  return Buffer.concat([Buffer.from(version), cipher.update(plain), cipher.final()])
}

test("decrypts each platform's cookie values and says which ones only their browser can read", () => {
  const windows: ChromiumKey = { type: "gcm", key: randomBytes(32) }
  const mac: ChromiumKey = { type: "cbc", v10: deriveCbcKey("keychain-password", 1003), v11: undefined }
  const linux: ChromiumKey = { type: "cbc", v10: deriveCbcKey("peanuts", 1), v11: deriveCbcKey("keyring", 1) }

  expect(decryptChromium(gcm(windows.key, ".github.com", "token"), windows, ".github.com")).toEqual({ value: "token" })
  // Before version 24 there is no host digest to strip.
  expect(decryptChromium(gcm(windows.key, ".github.com", "token", false), windows, ".github.com")).toEqual({
    value: "token",
  })
  expect(decryptChromium(cbc(mac.v10, "v10", "github.com", "token"), mac, "github.com")).toEqual({ value: "token" })
  expect(decryptChromium(cbc(deriveCbcKey("keyring", 1), "v11", "a.test", "x"), linux, "a.test")).toEqual({
    value: "x",
  })
  // Chrome and Edge app-bound encryption, a wrong key, and a v11 value without a keyring password.
  expect(decryptChromium(Buffer.from("v20aaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), windows, "a.test")).toEqual({
    error: "protected",
  })
  expect(decryptChromium(gcm(randomBytes(32), "a.test", "x"), windows, "a.test")).toEqual({ error: "failed" })
  expect(decryptChromium(cbc(deriveCbcKey("keyring", 1), "v11", "a.test", "x"), mac, "a.test")).toEqual({
    error: "failed",
  })
})

test("lists from a cookie table without any value column, and leaves no copy behind", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chromium-hosts-"))
  const file = path.join(directory, "Cookies")
  const db = new DatabaseSync(file)
  const copies = scratch(directory)

  try {
    // The columns the list may read, and no other: a query that read a value would fail on this table.
    db.exec("CREATE TABLE cookies (host_key, expires_utc INTEGER, has_expires INTEGER, last_access_utc INTEGER, top_frame_site_key TEXT)")
    const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?)")
    insert.run(".github.com", 0, 0, 13_300_000_000_000_000, "")
    // A damaged row whose host is not text names no site, and leaves the rest of the list alone.
    insert.run(Buffer.from("github.com"), 0, 0, 0, "")
    insert.run(42, 0, 0, 0, null)

    expect(await readChromiumHosts(file, copies)).toEqual([{ host: ".github.com", expires: undefined, used: 1_655_526_400 }])
    expect((await readdir(copies.directory)).filter((entry) => entry.startsWith("opencode-browser-import-"))).toEqual([])
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("lists hosts without reading a value, and imports only the chosen sites' cookies", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chromium-sites-"))
  const file = path.join(directory, "Cookies")
  const key: ChromiumKey = { type: "gcm", key: randomBytes(32) }
  const db = new DatabaseSync(file)

  try {
    db.exec(
      "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, has_expires INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, top_frame_site_key TEXT, last_access_utc INTEGER)",
    )
    const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    insert.run(".github.com", "user_session", "", gcm(key.key, ".github.com", "secret"), "/", 13_300_000_000_000_000, 1, 1, 1, 1, "", 13_300_000_000_000_000)
    insert.run("github.com", "host_only", "", gcm(key.key, "github.com", "host"), "/", 0, 0, 1, 1, 1, "", 0)
    // Values no key decrypts: listing must not try, and an import of other sites must not either.
    insert.run("bank.test", "session", "", Buffer.from("v20aaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "/", 0, 0, 1, 1, 1, "", 0)
    insert.run("mail.test", "session", "", gcm(randomBytes(32), "mail.test", "x"), "/", 0, 0, 1, 1, 1, "", 0)
    // A partitioned cookie of a chosen site stays behind and is counted.
    insert.run("github.com", "chips", "", gcm(key.key, "github.com", "x"), "/", 0, 0, 1, 0, 0, "https://top.test", 0)
    // Damaged rows, one with a host that is not text and one with no value at all, are each one cookie left behind.
    insert.run(Buffer.from("github.com"), "blob_host", "", gcm(key.key, "github.com", "x"), "/", 0, 0, 1, 1, 1, "", 0)
    insert.run("github.com", "no_value", null, null, "/", 0, 0, 1, 1, 1, "", 0)

    expect(await readChromiumHosts(file, scratch(directory))).toEqual([
      { host: ".github.com", expires: 1_655_526_400, used: 1_655_526_400 },
      { host: "github.com", expires: undefined, used: 0 },
      { host: "bank.test", expires: undefined, used: 0 },
      { host: "mail.test", expires: undefined, used: 0 },
      { host: "github.com", expires: undefined, used: 0 },
    ])

    const read = await readChromiumCookies(file, key, scratch(directory), (host) => host.replace(/^\./, "") === "github.com")

    expect(read.cookies.map((cookie) => [cookie.host, cookie.name, cookie.value])).toEqual([
      [".github.com", "user_session", "secret"],
      ["github.com", "host_only", "host"],
    ])
    expect({ protected: read.protected, failed: read.failed, skipped: read.skipped }).toEqual({
      protected: 0,
      failed: 1,
      skipped: 1,
    })

    // An import of every site counts the row whose host names no site too, and still imports the rest.
    const all = await readChromiumCookies(file, key, scratch(directory))

    expect(all.cookies.map((cookie) => cookie.name)).toEqual(["user_session", "host_only"])
    expect({ protected: all.protected, failed: all.failed, skipped: all.skipped }).toEqual({ protected: 1, failed: 3, skipped: 1 })
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("reads a profile's cookie database from a copy and leaves partitioned cookies behind", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chromium-cookies-"))
  const file = path.join(directory, "Cookies")
  const key: ChromiumKey = { type: "gcm", key: randomBytes(32) }
  const db = new DatabaseSync(file)

  try {
    db.exec(
      "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, has_expires INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, top_frame_site_key TEXT)",
    )
    const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    insert.run(
      ".github.com",
      "user_session",
      "",
      gcm(key.key, ".github.com", "secret"),
      "/",
      13_300_000_000_000_000,
      1,
      1,
      1,
      1,
      "",
    )
    insert.run("example.com", "plain", "visible", Buffer.alloc(0), "/", 0, 0, 0, 0, -1, "")
    insert.run("embed.test", "chips", "", gcm(key.key, "embed.test", "x"), "/", 0, 0, 1, 0, 0, "https://top.test")
    insert.run("edge.test", "locked", "", Buffer.from("v20aaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "/", 0, 0, 1, 0, 0, "")
    // The browser keeps its database open; the copy must still see its write-ahead log.
    db.exec("PRAGMA journal_mode = WAL")
    insert.run("late.test", "wal", "in-wal", Buffer.alloc(0), "/", 0, 0, 0, 0, 2, "")

    expect(await readChromiumCookies(file, key, scratch(directory))).toEqual({
      cookies: [
        {
          host: ".github.com",
          name: "user_session",
          value: "secret",
          path: "/",
          secure: true,
          httpOnly: true,
          expires: 1_655_526_400,
          sameSite: "lax",
        },
        {
          host: "example.com",
          name: "plain",
          value: "visible",
          path: "/",
          secure: false,
          httpOnly: false,
          expires: undefined,
          sameSite: "unspecified",
        },
        {
          host: "late.test",
          name: "wal",
          value: "in-wal",
          path: "/",
          secure: false,
          httpOnly: false,
          expires: undefined,
          sameSite: "strict",
        },
      ],
      protected: 1,
      failed: 0,
      // The partitioned (CHIPS) row stays behind and is counted.
      skipped: 1,
    })
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
})
