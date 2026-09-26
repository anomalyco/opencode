import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { externalServerConfig } from "./external-server"

const defaultURL = "http://127.0.0.1:7700"

describe("external server config", () => {
  const previousHome = process.env["HOME"]
  let home: string

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "opencode-external-"))
    process.env["HOME"] = home
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env["HOME"]
    else process.env["HOME"] = previousHome
  })

  const write = (content: string) => {
    const file = path.join(home, ".config", "opencode", "external-server.env")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  test("attaches to the default loopback server when the file is missing", () => {
    // Attach is the default; a missing credential file must not detach the desktop.
    expect(externalServerConfig()).toEqual({ url: defaultURL, password: null })
  })

  test("attaches to a loopback URL override and uses its password", () => {
    write("OPENCODE_EXTERNAL_SERVER_URL=http://127.0.0.1:7700\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: "http://127.0.0.1:7700", password: "secret" })
  })

  test("accepts a localhost override", () => {
    write("OPENCODE_EXTERNAL_SERVER_URL=http://localhost:8080\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: "http://localhost:8080", password: "secret" })
  })

  test("falls back to the default URL for a non-loopback host", () => {
    // A remote origin never receives the Authorization header the injector adds, so the override is
    // ignored rather than disabling attach.
    write("OPENCODE_EXTERNAL_SERVER_URL=http://10.0.0.5:7700\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("falls back to the default URL for https, which the credential injector never matches", () => {
    write("OPENCODE_EXTERNAL_SERVER_URL=https://127.0.0.1:7700\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("falls back to the default URL for IPv6 loopback, which the credential injector never matches", () => {
    // The main-process credential injector only matches http://127.0.0.1/* and http://localhost/*
    // (packages/desktop/src/main/windows/security.ts:43), so an IPv6 origin would attach but 401.
    write("OPENCODE_EXTERNAL_SERVER_URL=http://[::1]:7700\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("falls back to the default URL for a malformed override", () => {
    write("OPENCODE_EXTERNAL_SERVER_URL=not a url\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("uses the default URL when only a password is configured", () => {
    write("OPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("accepts OPENCODE_SERVER_PASSWORD as the fallback password key", () => {
    write("OPENCODE_SERVER_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("ignores comments, blank lines, and surrounding whitespace", () => {
    write(
      [
        "# the desktop attaches to this server",
        "",
        "  OPENCODE_EXTERNAL_SERVER_URL = http://127.0.0.1:7700  ",
        "OPENCODE_PASSWORD= secret ",
        "",
      ].join("\n"),
    )

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("normalizes a URL with a path to its origin", () => {
    write("OPENCODE_EXTERNAL_SERVER_URL=http://127.0.0.1:7700/foo\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })

  test("re-reads the file on every call with no module-level cache", () => {
    write("OPENCODE_PASSWORD=secret\n")
    expect(externalServerConfig().password).toBe("secret")

    write("OPENCODE_PASSWORD=rotated\n")
    expect(externalServerConfig().password).toBe("rotated")
  })
})
