import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Auth } from "../src/auth/index"
import { Keychain } from "../src/auth/keychain"
import path from "path"
import fs from "fs/promises"
import { Global } from "../src/global"

describe("Auth", () => {
  const testProvider = "test-provider"
  const testApiInfo: Auth.Info = { type: "api", key: "test-key-123" }
  const testOauthInfo: Auth.Info = {
    type: "oauth",
    refresh: "refresh-token",
    access: "access-token",
    expires: Date.now() + 3600000,
  }

  beforeEach(async () => {
    // Clean up any existing test entries
    await Keychain.remove(testProvider)
    await Keychain.remove("test-provider-2")
  })

  afterEach(async () => {
    // Clean up after tests
    await Keychain.remove(testProvider)
    await Keychain.remove("test-provider-2")
  })

  test("set and get API key", async () => {
    await Auth.set(testProvider, testApiInfo)
    const retrieved = await Auth.get(testProvider)
    expect(retrieved).toEqual(testApiInfo)
  })

  test("set and get OAuth token", async () => {
    await Auth.set(testProvider, testOauthInfo)
    const retrieved = await Auth.get(testProvider)
    expect(retrieved).toEqual(testOauthInfo)
  })

  test("remove provider", async () => {
    await Auth.set(testProvider, testApiInfo)
    const before = await Auth.get(testProvider)
    expect(before).toEqual(testApiInfo)

    await Auth.remove(testProvider)
    const after = await Auth.get(testProvider)
    expect(after).toBeUndefined()
  })

  test("all() returns all providers", async () => {
    await Auth.set(testProvider, testApiInfo)
    await Auth.set("test-provider-2", testOauthInfo)

    const all = await Auth.all()
    expect(all[testProvider]).toEqual(testApiInfo)
    expect(all["test-provider-2"]).toEqual(testOauthInfo)
  })

  test("get returns undefined for non-existent provider", async () => {
    const result = await Auth.get("non-existent")
    expect(result).toBeUndefined()
  })

  test("validates Info schema on set", async () => {
    const invalidInfo = { type: "invalid", data: "test" } as any
    expect(Auth.set(testProvider, invalidInfo)).rejects.toThrow()
  })
})

describe("Auth Migration", () => {
  const filepath = path.join(Global.Path.data, "auth.json")
  const testProvider = "migration-test"
  const testInfo: Auth.Info = { type: "api", key: "migration-key" }

  beforeEach(async () => {
    // Clean up keychain
    await Keychain.remove(testProvider)
  })

  afterEach(async () => {
    // Clean up
    await Keychain.remove(testProvider)
    try {
      await fs.unlink(filepath)
    } catch {}
  })

  test("migrates from file to keychain on get", async () => {
    // Write directly to file
    await Bun.write(filepath, JSON.stringify({ [testProvider]: testInfo }))
    await fs.chmod(filepath, 0o600)

    // First get should migrate
    const retrieved = await Auth.get(testProvider)
    expect(retrieved).toEqual(testInfo)

    // Check it's in keychain
    const fromKeychain = await Keychain.get(testProvider)
    expect(fromKeychain).toBeTruthy()
    const parsed = JSON.parse(fromKeychain!)
    expect(parsed).toEqual(testInfo)

    // Check it's removed from file
    const fileContent = await Bun.file(filepath).json().catch(() => ({}))
    expect(fileContent[testProvider]).toBeUndefined()
  })

  test("migrates all entries from file on all()", async () => {
    const provider2 = "migration-test-2"
    const info2: Auth.Info = { type: "api", key: "key2" }

    // Write multiple entries to file
    await Bun.write(
      filepath,
      JSON.stringify({
        [testProvider]: testInfo,
        [provider2]: info2,
      }),
    )
    await fs.chmod(filepath, 0o600)

    // Call all() should migrate everything
    const all = await Auth.all()
    expect(all[testProvider]).toEqual(testInfo)
    expect(all[provider2]).toEqual(info2)

    // Check both are in keychain
    const kc1 = await Keychain.get(testProvider)
    const kc2 = await Keychain.get(provider2)
    expect(kc1).toBeTruthy()
    expect(kc2).toBeTruthy()

    // Check file is empty
    const fileContent = await Bun.file(filepath).json().catch(() => ({}))
    expect(Object.keys(fileContent).length).toBe(0)

    // Clean up
    await Keychain.remove(provider2)
  })

  test("prefers keychain over file if both exist", async () => {
    const fileInfo: Auth.Info = { type: "api", key: "old-key" }
    const keychainInfo: Auth.Info = { type: "api", key: "new-key" }

    // Write to file
    await Bun.write(filepath, JSON.stringify({ [testProvider]: fileInfo }))
    await fs.chmod(filepath, 0o600)

    // Write different value to keychain
    await Keychain.set(testProvider, JSON.stringify(keychainInfo))

    // Should get keychain value
    const retrieved = await Auth.get(testProvider)
    expect(retrieved).toEqual(keychainInfo)
  })

  test("handles invalid JSON in keychain gracefully", async () => {
    await Keychain.set(testProvider, "not-json{")
    const result = await Auth.get(testProvider)
    expect(result).toBeUndefined()
  })

  test("handles invalid schema in file gracefully during migration", async () => {
    const invalidData = { type: "unknown", data: "test" }
    await Bun.write(filepath, JSON.stringify({ [testProvider]: invalidData }))
    await fs.chmod(filepath, 0o600)

    const result = await Auth.get(testProvider)
    expect(result).toBeUndefined()

    // Invalid entry should not be migrated
    const fromKeychain = await Keychain.get(testProvider)
    expect(fromKeychain).toBeNull()
  })
})
