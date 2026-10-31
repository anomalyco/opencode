import { expect, test } from "bun:test"
import { exportMarketplaceLock, verifyMarketplaceLock } from "../src/marketplace-lock"
import type { MarketplaceState } from "../src/marketplace"

const state: MarketplaceState = {
  installed: {
    "source:catalog:item": {
      source: "source",
      catalog: "catalog",
      item: "item",
      name: "Item",
      kind: "skill",
      version: "1.0.0",
      fingerprint: "fingerprint",
      plan_digest: "sha256:plan",
      installed_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      plan: {},
      receipt: {},
      artifact_digests: ["sha256:b", "sha256:a"],
    },
  },
}

test("exports and verifies deterministic Marketplace locks", () => {
  const lock = exportMarketplaceLock(state, "2026-01-01T00:00:00.000Z")
  expect(lock.packages[0]?.artifact_digests).toEqual(["sha256:a", "sha256:b"])
  expect(verifyMarketplaceLock(state, lock)).toEqual({ ok: true, errors: [] })
  expect(verifyMarketplaceLock({ installed: {} }, lock)).toEqual({
    ok: false,
    errors: ["Missing installed package: source:catalog:item"],
  })
})
