import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Plugin } from "../src/plugin.js"

test("embeds plugin status in one info schema", () => {
  const decode = Schema.decodeUnknownSync(Plugin.Info)
  const source = { type: "package" as const, package: "acme" }
  const features = { server: true as const }

  expect(decode({ id: "acme", source, features, status: { type: "active" } })).toEqual({
    id: Plugin.ID.make("acme"),
    source,
    features,
    status: { type: "active" },
  })
  expect(decode({ source, features, status: { type: "failed", error: "broken" } })).toEqual({
    source,
    features,
    status: { type: "failed", error: "broken" },
  })
})
