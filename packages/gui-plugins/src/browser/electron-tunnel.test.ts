import { expect, test } from "bun:test"
import path from "node:path"
import { schemes } from "../schemes"
import { runElectronFixture } from "./electron-run"

test(
  "real Electron remote partition streams HTTP assets, 512 KiB body and HMR WebSocket over one prewarmed binary WS without legacy downgrade on 403",
  async () => {
    const result: {
      pageData: {
        assetsCount: number
        firstAsset: string
        lastAsset: string
        bigBytes: number
        wsReply: string
      }
      redirectOutcome: string
      redirectUrl: string
      okCounters: {
        upgrades: number
        rejectedUpgrades: number
        legacyTunnelCalls: number
        ticketCalls: number
        grantCalls: number
        ticketHeaderPresent: boolean
      }
      blockedOutcome: string
      blockedLoadError: string
      blockedCounters: {
        upgrades: number
        rejectedUpgrades: number
        legacyTunnelCalls: number
        ticketCalls: number
        grantCalls: number
        ticketHeaderPresent: boolean
      }
      legacyCounters: {
        upgrades: number
        rejectedUpgrades: number
        legacyTunnelCalls: number
        ticketCalls: number
        grantCalls: number
        ticketHeaderPresent: boolean
      }
      directHitsDuringBlocked: number
    } = JSON.parse(
      await runElectronFixture({
        fixture: path.join(import.meta.dir, "electron-tunnel.fixture.ts"),
        schemes,
      }),
    )

    expect(result.pageData).toEqual({
      assetsCount: 8,
      firstAsset: "ok:/asset-0",
      lastAsset: "ok:/asset-7",
      bigBytes: 512 * 1024,
      wsReply: "hmr:ping",
    })
    // Client-side redirect during load commits cleanly without false ERR_ABORTED (-3).
    expect(result.redirectOutcome).toBe("success")
    expect(result.redirectUrl).toEndWith("/redirect-target")
    // Exactly one prewarmed binary WebSocket upgrade using ticket header; zero legacy chunked RPC calls;
    // user navigation on an advertised stream attachment sends tunnel.grant.
    expect(result.okCounters).toEqual({
      upgrades: 1,
      rejectedUpgrades: 0,
      legacyTunnelCalls: 0,
      ticketCalls: 1,
      grantCalls: 1,
      ticketHeaderPresent: true,
    })
    // Rejected upgrade (403) surfaces proxy 502 without ever downgrading to legacy RPC or direct desktop network.
    expect(result.blockedLoadError).toContain("502")
    expect(result.blockedCounters.upgrades).toBe(0)
    expect(result.blockedCounters.rejectedUpgrades).toBeGreaterThanOrEqual(1)
    expect(result.blockedCounters.legacyTunnelCalls).toBe(0)
    expect(result.directHitsDuringBlocked).toBe(0)
    // Unadvertised/disabled server receives zero tunnel.ticket and zero tunnel.grant RPCs on user navigation.
    expect(result.legacyCounters.upgrades).toBe(0)
    expect(result.legacyCounters.ticketCalls).toBe(0)
    expect(result.legacyCounters.grantCalls).toBe(0)
  },
  60_000,
)
