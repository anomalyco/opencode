import { strict as assert } from "node:assert"
import test from "node:test"
import { getBrandingConfig } from "../src/api/branding"

test("known tenant returns tenant-specific config", () => {
  const row = getBrandingConfig("tenant-a")
  assert.equal(row.tenantId, "tenant-a")
  assert.equal(row.logoUrl, "/assets/tenant-a.svg")
})

test("unknown tenant falls back to default config", () => {
  const row = getBrandingConfig("tenant-x")
  assert.equal(row.tenantId, "default")
  assert.equal(row.headerMessage, "Welcome")
})
