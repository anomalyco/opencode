/**
 * Integration test for local llama-swap provider discovery.
 *
 * This test is skipped in CI (no local fleet). Run manually to verify
 * that mDNS advertisement and LAN discovery are working in the fleet:
 *
 *   bun test test/local/discovery.integration.test.ts
 *
 * Expected output when fleet is healthy: at least one provider found via
 * mDNS, all active providers listed with their models.
 */
import { describe, expect, test } from "bun:test"
import { scanLlamaSwap, scanMDNSOnly } from "../../src/local/mdns"

const isCI = Boolean(process.env.CI)

describe("local provider discovery", () => {
  test.skipIf(isCI)("mDNS: finds at least one llama-swap provider via Bonjour", async () => {
    console.log("\n── mDNS-only scan (5 s) ─────────────────────────────────")
    const found = await scanMDNSOnly(5000)

    if (found.length === 0) {
      console.log("  ⚠  No providers found via mDNS.")
      console.log("     Possible causes:")
      console.log("     • llama-skein not running on any LAN host")
      console.log("     • llama-skein started without mDNS (check --listen flag)")
      console.log("     • multicast blocked between subnets / VLANs")
      console.log("     • macOS local network permission denied for this process")
    } else {
      for (const svc of found) {
        console.log(`  ✓  ${svc.name}  ${svc.baseURL}`)
      }
    }

    expect(found.length).toBeGreaterThan(0)
  }, 10_000)

  test.skipIf(isCI)("full scan: lists all reachable providers (mDNS + localhost + LAN)", async () => {
    console.log("\n── Full discovery scan (6 s) ─────────────────────────────")
    const providers = await scanLlamaSwap(6000)

    if (providers.length === 0) {
      console.log("  ✗  No providers found at all.")
    }

    for (const p of providers) {
      const status = p.online ? "✓" : "✗"
      const models = p.models.length > 0 ? p.models.join(", ") : "(no models)"
      console.log(`  ${status}  ${p.name}  ${p.baseURL}`)
      console.log(`       models: ${models}`)
    }

    console.log(`\n  Total: ${providers.filter((p) => p.online).length} online / ${providers.length} found`)

    expect(providers.length).toBeGreaterThan(0)
  }, 12_000)
})
