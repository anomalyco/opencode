import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { Miniflare } from "miniflare"
import vectors from "./fixture/noise-xx-vectors.json"

// noise.ts inside real workerd (the version wrangler 4.110.0 runs), whose node:crypto cannot use a raw X25519 peer key
// and fails AES-GCM with an empty ad or empty text. A regression here passes every Bun test and fails only on Workers.

const all = [...vectors["cacophony.txt"], ...vectors["snow.txt"]]
const state: { miniflare?: Miniflare; url?: URL } = {}

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "fixture/noise-workerd.ts")],
    conditions: ["workerd"],
    target: "node",
    format: "esm",
  })
  if (!build.success) throw new AggregateError(build.logs, "Could not bundle the workerd fixture")
  state.miniflare = new Miniflare({
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    script: await build.outputs[0].text(),
  })
  state.url = await state.miniflare.ready
})

afterAll(() => state.miniflare?.dispose())

describe("Noise in workerd", () => {
  test("reproduces every published vector byte for byte and carries empty payloads across a rekey", async () => {
    const response = await fetch(new URL("/vectors", state.url), { method: "POST", body: JSON.stringify(all) })
    expect(response.status).toBe(200)
    const results = (await response.json()) as Array<{ ciphertexts: string[]; hash: string }>
    results.forEach((result, index) => {
      expect(result.ciphertexts).toEqual(all[index].messages.map((message) => message.ciphertext))
      if ("handshake_hash" in all[index]) expect(result.hash).toBe(all[index].handshake_hash)
    })
  })
})
