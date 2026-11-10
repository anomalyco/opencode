import { expect, test } from "bun:test"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { decryptChromium, deriveCbcKey, readChromiumCookies, type ChromiumKey } from "./chromium"

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

    expect(await readChromiumCookies(file, key)).toEqual({
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
    })
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
})
