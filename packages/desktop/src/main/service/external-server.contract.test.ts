import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { externalServerConfig } from "./external-server"

// Contract test: pins the interface the background-service wiring depends on, independently of the
// module's own example-based tests. Each assertion encodes why the wiring would break if it changed.

const configDir = path.join(".config", "opencode")
const configName = "external-server.env"
const expectedPath = path.join(configDir, configName)
const validEnv = "OPENCODE_EXTERNAL_SERVER_URL=http://127.0.0.1:7700\nOPENCODE_PASSWORD=secret\n"
const defaultURL = "http://127.0.0.1:7700"

describe("external server attach contract", () => {
  const previousHome = process.env["HOME"]
  let home: string

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "opencode-external-contract-"))
    process.env["HOME"] = home
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env["HOME"]
    else process.env["HOME"] = previousHome
  })

  const write = (relative: string, content: string) => {
    const file = path.join(home, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
    return file
  }

  test("always returns a config, never undefined", () => {
    // The background-service attach branch runs unconditionally, so this accessor must never signal
    // "not configured"; an absent file yields the default target with no password.
    expect(externalServerConfig()).toEqual({ url: defaultURL, password: null })
  })

  test("reads only <HOME>/.config/opencode/external-server.env, not a sibling name or location", () => {
    // Same bytes, wrong location: the path is shared with the server's systemd EnvironmentFile, so
    // reading a lookalike would attach with a credential the server never loaded.
    write(path.join(".config", configName), validEnv)
    expect(externalServerConfig()).toEqual({ url: defaultURL, password: null })

    // Same bytes, wrong filename inside the right directory: must not be read either.
    write(path.join(configDir, "server.env"), validEnv)
    expect(externalServerConfig()).toEqual({ url: defaultURL, password: null })

    // Only the exact path yields the override credential.
    write(expectedPath, validEnv)
    expect(externalServerConfig()).toEqual({ url: "http://127.0.0.1:7700", password: "secret" })
  })

  test("OPENCODE_PASSWORD wins over OPENCODE_SERVER_PASSWORD when both are present", () => {
    // The file is a shared EnvironmentFile, so both keys can coexist; the canonical desktop key must
    // be authoritative or the two processes could disagree on the credential.
    write(
      expectedPath,
      [
        "OPENCODE_EXTERNAL_SERVER_URL=http://127.0.0.1:7700",
        "OPENCODE_SERVER_PASSWORD=fallback",
        "OPENCODE_PASSWORD=primary",
      ].join("\n") + "\n",
    )

    expect(externalServerConfig().password).toBe("primary")
  })

  test("returns exactly { url, password } and url is a slashless origin", () => {
    write(expectedPath, validEnv)

    const config = externalServerConfig()
    expect(config).toEqual({ url: "http://127.0.0.1:7700", password: "secret" })
    // The caller adapts this into SidecarCredentials.Data; an extra field or a non-origin url would
    // change what gets stored and published to the renderer.
    expect(Object.keys(config).sort()).toEqual(["password", "url"])
    expect(config.url).toBe(new URL(config.url).origin)
    expect(config.url.endsWith("/")).toBe(false)
  })

  test("re-reads the file at each call, so edits and removal are observed with no module-level cache", () => {
    const file = write(expectedPath, validEnv)
    expect(externalServerConfig()).toEqual({ url: "http://127.0.0.1:7700", password: "secret" })

    // Editing the file must be observed without a restart.
    writeFileSync(file, validEnv.replace("secret", "rotated"))
    expect(externalServerConfig().password).toBe("rotated")

    // Removing the file falls back to the default target with no password, not to "detached".
    rmSync(file)
    expect(externalServerConfig()).toEqual({ url: defaultURL, password: null })
  })

  test("a non-loopback override cannot disable attach: url falls back to the default", () => {
    write(expectedPath, "OPENCODE_EXTERNAL_SERVER_URL=http://10.0.0.5:7700\nOPENCODE_PASSWORD=secret\n")

    expect(externalServerConfig()).toEqual({ url: defaultURL, password: "secret" })
  })
})
