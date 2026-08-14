import { expect, test } from "bun:test"
import { collectNodeAssets } from "../script/node-assets"
import { nodeTarget } from "../src/node/target"

test("collects each SEA asset key once", async () => {
  const assets = await collectNodeAssets(nodeTarget(process.platform, process.arch))
  const keys = assets.map((asset) => asset.key)

  expect(new Set(keys).size).toBe(keys.length)
})
