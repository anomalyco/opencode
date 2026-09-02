import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Plugin } from "../src/plugin.js"

test("embeds plugin state with a status discriminator", () => {
  const decode = Schema.decodeUnknownSync(Plugin.Info)
  const source = { type: "package" as const, target: "acme", version: "1.2.3" }
  const features = { server: true as const }

  expect(decode({ id: "acme", source, features, state: { status: "active" } })).toEqual({
    id: Plugin.ID.make("acme"),
    source,
    features,
    state: { status: "active" },
  })
  expect(decode({ source, features, state: { status: "failed", error: "broken" } })).toEqual({
    source,
    features,
    state: { status: "failed", error: "broken" },
  })
  expect(decode({ source: { ...source, outdated: true }, features, state: { status: "active" } }).source).toEqual({
    ...source,
    outdated: true,
  })
})

test("plugin failure references round trip and absent references stay omitted", () => {
  const codec = Schema.fromJsonString(Plugin.State)
  const failed = { status: "failed", error: "Plugin failed to load", ref: "err_a1b2c3d4" } as const
  expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(failed))).toEqual(failed)
  expect(Schema.encodeSync(Plugin.State)({ ...failed, ref: undefined })).toEqual({
    status: "failed",
    error: failed.error,
  })
  expect(Schema.decodeUnknownSync(Plugin.State)({ status: "failed", error: failed.error })).toMatchObject({
    status: "failed",
    error: failed.error,
  })
})
