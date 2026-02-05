import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import { Global } from "../../src/global"
import { Auth } from "../../src/auth"

describe("Auth", () => {
  const authFilePath = path.join(Global.Path.data, "auth.json")

  afterEach(async () => {
    // Clean up auth.json after each test
    await fs.rm(authFilePath, { force: true })
  })

  describe("all()", () => {
    test("returns empty object when no auth file exists", async () => {
      // Ensure no auth file
      await fs.rm(authFilePath, { force: true })

      const result = await Auth.all()
      expect(result).toEqual({})
    })

    test("returns empty object when auth file contains invalid JSON", async () => {
      await fs.mkdir(path.dirname(authFilePath), { recursive: true })
      await fs.writeFile(authFilePath, "not valid json")

      const result = await Auth.all()
      expect(result).toEqual({})
    })

    test("filters out entries that don't match any Auth.Info schema", async () => {
      await fs.mkdir(path.dirname(authFilePath), { recursive: true })
      await fs.writeFile(
        authFilePath,
        JSON.stringify({
          valid: { type: "api", key: "sk-test-123" },
          invalid: { type: "unknown", foo: "bar" },
          alsoInvalid: "just a string",
        }),
      )

      const result = await Auth.all()
      expect(Object.keys(result)).toEqual(["valid"])
      expect(result["valid"]).toEqual({ type: "api", key: "sk-test-123" })
    })
  })

  describe("set()", () => {
    test("stores API key and creates auth file", async () => {
      const info: Auth.Info = { type: "api", key: "sk-test-key-123" }
      await Auth.set("test-provider", info)

      const file = Bun.file(authFilePath)
      const exists = await file.exists()
      expect(exists).toBe(true)

      const data = await file.json()
      expect(data["test-provider"]).toEqual(info)
    })

    test("writes file with restricted permissions", async () => {
      const info: Auth.Info = { type: "api", key: "sk-secret-key" }
      await Auth.set("secure-provider", info)

      const stat = await fs.stat(authFilePath)
      const permissions = stat.mode & 0o777
      // Bun.write applies mode filtered by umask; verify it's not world-writable
      expect(permissions & 0o002).toBe(0) // no world write
      expect(permissions & 0o020).toBe(0) // no group write
    })

    test("preserves existing entries when adding new one", async () => {
      const first: Auth.Info = { type: "api", key: "sk-first" }
      const second: Auth.Info = { type: "api", key: "sk-second" }

      await Auth.set("provider-a", first)
      await Auth.set("provider-b", second)

      const all = await Auth.all()
      expect(all["provider-a"]).toEqual(first)
      expect(all["provider-b"]).toEqual(second)
    })

    test("overwrites existing entry for the same key", async () => {
      const original: Auth.Info = { type: "api", key: "sk-original" }
      const updated: Auth.Info = { type: "api", key: "sk-updated" }

      await Auth.set("my-provider", original)
      await Auth.set("my-provider", updated)

      const all = await Auth.all()
      expect(all["my-provider"]).toEqual(updated)
    })

    test("stores OAuth auth info correctly", async () => {
      const info: Auth.Info = {
        type: "oauth",
        refresh: "refresh-token-abc",
        access: "access-token-xyz",
        expires: Date.now() + 3600000,
      }
      await Auth.set("oauth-provider", info)

      const result = await Auth.get("oauth-provider")
      expect(result).toEqual(info)
    })

    test("stores WellKnown auth info correctly", async () => {
      const info: Auth.Info = {
        type: "wellknown",
        key: "wellknown-key",
        token: "wellknown-token",
      }
      await Auth.set("wellknown-provider", info)

      const result = await Auth.get("wellknown-provider")
      expect(result).toEqual(info)
    })
  })

  describe("get()", () => {
    test("returns undefined for non-existent provider", async () => {
      const result = await Auth.get("nonexistent-provider")
      expect(result).toBeUndefined()
    })

    test("returns the correct entry for a given provider", async () => {
      const info: Auth.Info = { type: "api", key: "sk-gettest" }
      await Auth.set("get-test-provider", info)

      const result = await Auth.get("get-test-provider")
      expect(result).toEqual(info)
    })
  })

  describe("set() and get() roundtrip", () => {
    test("roundtrip works correctly for api type", async () => {
      const info: Auth.Info = { type: "api", key: "sk-roundtrip-key" }
      await Auth.set("roundtrip-api", info)

      const result = await Auth.get("roundtrip-api")
      expect(result).toEqual(info)
    })

    test("roundtrip works correctly for oauth type with optional fields", async () => {
      const info: Auth.Info = {
        type: "oauth",
        refresh: "r-token",
        access: "a-token",
        expires: 1700000000000,
        accountId: "account-123",
        enterpriseUrl: "https://enterprise.example.com",
      }
      await Auth.set("roundtrip-oauth", info)

      const result = await Auth.get("roundtrip-oauth")
      expect(result).toEqual(info)
    })
  })

  describe("remove()", () => {
    test("removes an existing provider entry", async () => {
      const info: Auth.Info = { type: "api", key: "sk-to-remove" }
      await Auth.set("to-remove", info)

      // Verify it was stored
      const before = await Auth.get("to-remove")
      expect(before).toEqual(info)

      await Auth.remove("to-remove")

      const after = await Auth.get("to-remove")
      expect(after).toBeUndefined()
    })

    test("preserves other entries when removing one", async () => {
      const infoA: Auth.Info = { type: "api", key: "sk-a" }
      const infoB: Auth.Info = { type: "api", key: "sk-b" }

      await Auth.set("keep-this", infoA)
      await Auth.set("remove-this", infoB)

      await Auth.remove("remove-this")

      const all = await Auth.all()
      expect(all["keep-this"]).toEqual(infoA)
      expect(all["remove-this"]).toBeUndefined()
    })

    test("maintains restricted permissions after removal", async () => {
      const info: Auth.Info = { type: "api", key: "sk-perm-check" }
      await Auth.set("perm-provider", info)
      await Auth.remove("perm-provider")

      const stat = await fs.stat(authFilePath)
      const permissions = stat.mode & 0o777
      // Verify no world or group write access
      expect(permissions & 0o002).toBe(0)
      expect(permissions & 0o020).toBe(0)
    })
  })
})
