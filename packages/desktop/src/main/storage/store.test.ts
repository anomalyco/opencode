import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSettingsStore } from "./store"

const dir = () => mkdtempSync(path.join(tmpdir(), "opencode-settings-"))

describe("settings store", () => {
  test("reads the tab-indented file electron-store wrote and rewrites it in the same shape", () => {
    const file = path.join(dir(), "opencode.settings")
    writeFileSync(file, JSON.stringify({ windowIds: ["a"], backgroundColor: "#121212" }, null, "\t"))
    const store = createSettingsStore(file)
    expect(store.get("windowIds")).toEqual(["a"])
    store.set("backgroundColor", "#ffffff")
    expect(readFileSync(file, "utf8")).toBe(
      JSON.stringify({ windowIds: ["a"], backgroundColor: "#ffffff" }, null, "\t"),
    )
    expect(createSettingsStore(file).get("backgroundColor")).toBe("#ffffff")
  })

  test("starts empty without a file and creates it on the first write", () => {
    const file = path.join(dir(), "nested", "opencode.updater")
    const store = createSettingsStore(file)
    expect(store.get("ready")).toBeUndefined()
    expect(existsSync(file)).toBe(false)
    store.set("ready", { version: "1.0.0" })
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ready: { version: "1.0.0" } })
    store.delete("ready")
    expect(store.get("ready")).toBeUndefined()
    expect(readFileSync(file, "utf8")).toBe("{}")
  })

  test("sets an unreadable file aside instead of failing", () => {
    const file = path.join(dir(), "opencode.settings")
    writeFileSync(file, "{ not json")
    const store = createSettingsStore(file)
    expect(store.get("anything")).toBeUndefined()
    expect(existsSync(`${file}.corrupt`)).toBe(true)
    store.set("firstLaunchOnboardingComplete", true)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ firstLaunchOnboardingComplete: true })
  })

  test("rejects undefined like electron-store did", () => {
    const store = createSettingsStore(path.join(dir(), "opencode.settings"))
    expect(() => store.set("key", undefined)).toThrow(TypeError)
  })
})
