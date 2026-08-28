import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Plugin } from "../src/plugin.js"

test("plugin inspection omits absent revisions", () => {
  expect(
    Schema.encodeSync(Plugin.PackageStatus)({ installed: undefined, available: undefined, mutable: true }),
  ).toEqual({ mutable: true })
  for (const status of ["active", "failed"] as const) {
    const info = {
      id: Plugin.ID.make("example"),
      source: { type: "package" as const, package: "example@latest" },
      status,
      error: "setup failed",
      tui: false,
      revision: undefined,
    }
    expect(Schema.encodeSync(Plugin.Info)(info)).not.toHaveProperty("revision")
    expect(Schema.encodeSync(Plugin.Info)({ ...info, revision: "1.2.3" })).toHaveProperty("revision", "1.2.3")
  }
})

test("plugin inspection contracts have stable identifiers and readable errors", () => {
  expect(Plugin.PackageStatus.ast.annotations?.identifier).toBe("Plugin.PackageStatus")
  expect(Plugin.CheckError.ast.annotations?.identifier).toBe("PluginCheckError")
  const error = new Plugin.CheckError({ message: "Plugin package is not configured: example" })
  expect(error.message).toBe("Plugin package is not configured: example")
  expect(Schema.encodeSync(Plugin.CheckError)(error)).toEqual({
    _tag: "PluginCheckError",
    message: error.message,
  })
})
