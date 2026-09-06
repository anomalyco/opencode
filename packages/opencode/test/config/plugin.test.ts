import { describe, expect, test } from "bun:test"
import { ConfigPlugin } from "@/config/plugin"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { pathToFileURL } from "url"
import { mkdir } from "fs/promises"

describe("ConfigPlugin", () => {
  describe("load", () => {
    test("finds plugin configuration files correctly", async () => {
      await using tmp = await tmpdir()
      const dir = tmp.path

      const pluginDir1 = path.join(dir, "plugin")
      const pluginDir2 = path.join(dir, "plugins")

      await mkdir(pluginDir1, { recursive: true })
      await mkdir(pluginDir2, { recursive: true })

      const file1 = path.join(pluginDir1, "a.ts")
      const file2 = path.join(pluginDir2, "b.js")
      const file3 = path.join(pluginDir1, "c.txt") // Should be ignored
      const file4 = path.join(dir, "d.ts") // Should be ignored as not in plugin/plugins

      await Filesystem.write(file1, "")
      await Filesystem.write(file2, "")
      await Filesystem.write(file3, "")
      await Filesystem.write(file4, "")

      const loaded = await ConfigPlugin.load(dir)

      expect(loaded).toHaveLength(2)

      // Order is not guaranteed, but they should both be present
      const expected = [
        pathToFileURL(file1).href,
        pathToFileURL(file2).href
      ]

      expect(loaded).toContain(expected[0])
      expect(loaded).toContain(expected[1])
    })

    test("returns empty array when no plugins are found", async () => {
      await using tmp = await tmpdir()
      const loaded = await ConfigPlugin.load(tmp.path)
      expect(loaded).toEqual([])
    })
  })

  describe("pluginSpecifier", () => {
    test("extracts specifier from string", () => {
      expect(ConfigPlugin.pluginSpecifier("foo")).toBe("foo")
    })

    test("extracts specifier from tuple", () => {
      expect(ConfigPlugin.pluginSpecifier(["foo", { bar: "baz" }])).toBe("foo")
    })
  })

  describe("pluginOptions", () => {
    test("returns undefined for string specifier", () => {
      expect(ConfigPlugin.pluginOptions("foo")).toBeUndefined()
    })

    test("returns options for tuple specifier", () => {
      expect(ConfigPlugin.pluginOptions(["foo", { bar: "baz" }])).toEqual({ bar: "baz" })
    })
  })

  describe("resolvePluginSpec", () => {
    test("returns non-path spec as is", async () => {
      const spec = "foo"
      const resolved = await ConfigPlugin.resolvePluginSpec(spec, "/fake/path/config.ts")
      expect(resolved).toBe("foo")
    })

    test("returns non-path tuple spec as is", async () => {
      const spec: [string, { readonly [x: string]: unknown }] = ["foo", { bar: "baz" }]
      const resolved = await ConfigPlugin.resolvePluginSpec(spec, "/fake/path/config.ts")
      expect(resolved).toEqual(["foo", { bar: "baz" }])
    })

    test("resolves relative path specifier relative to config file", async () => {
      // Mocking resolvePathPluginTarget could be needed, but since it falls back to the URL, we test the fallback if it doesn't exist
      const spec = "./foo.ts"
      const resolved = await ConfigPlugin.resolvePluginSpec(spec, "/fake/path/config.ts")
      // Depending on the OS, the path representation could vary, but the fallback turns it into a file URL
      expect(resolved).toBe(pathToFileURL(path.resolve("/fake/path", "./foo.ts")).href)
    })

    test("resolves relative path tuple specifier relative to config file", async () => {
      const spec: [string, { readonly [x: string]: unknown }] = ["./foo.ts", { bar: "baz" }]
      const resolved = await ConfigPlugin.resolvePluginSpec(spec, "/fake/path/config.ts")
      expect(resolved).toEqual([pathToFileURL(path.resolve("/fake/path", "./foo.ts")).href, { bar: "baz" }])
    })
  })

  describe("deduplicatePluginOrigins", () => {
    test("deduplicates origins by specifier", () => {
      const origins: ConfigPlugin.Origin[] = [
        { spec: "foo", source: "a", scope: "global" },
        { spec: "bar", source: "b", scope: "global" },
        { spec: "foo", source: "c", scope: "local" },
      ]

      const deduped = ConfigPlugin.deduplicatePluginOrigins(origins)

      expect(deduped).toHaveLength(2)
      // keeps the last valid origin per deduplication logic
      expect(deduped[0]).toEqual({ spec: "bar", source: "b", scope: "global" })
      expect(deduped[1]).toEqual({ spec: "foo", source: "c", scope: "local" })
    })

    test("handles file:// plugins deduplication", () => {
      const origins: ConfigPlugin.Origin[] = [
        { spec: "file:///a/b/c", source: "a", scope: "global" },
        { spec: "file:///a/b/d", source: "b", scope: "global" },
        { spec: "file:///a/b/c", source: "c", scope: "local" },
      ]

      const deduped = ConfigPlugin.deduplicatePluginOrigins(origins)

      expect(deduped).toHaveLength(2)
      expect(deduped[0]).toEqual({ spec: "file:///a/b/d", source: "b", scope: "global" })
      expect(deduped[1]).toEqual({ spec: "file:///a/b/c", source: "c", scope: "local" })
    })
  })
})
