import { expect, test } from "bun:test"
import path from "node:path"
import { schemes } from "../schemes"
import { runElectronFixture } from "./electron-run"

test(
  "Electron remote partition relays HTTP, 128 KiB body and HMR WS over one binary WS, never downgrades on 403, and skips grants when unadvertised",
  async () => {
    const result: {
      streamed: { a: string; b: number; ws: string }
      okStats: { upgrades: number; rejected: number; ticketHeader: boolean; ticketCalls: number; grantCalls: number; legacyCalls: number }
      blockedStatus: number
      blockedHits: number
      after403: { upgrades: number; rejected: number; legacyCalls: number }
      legacyDelta: { ticketCalls: number; grantCalls: number; upgrades: number }
    } = JSON.parse(
      await runElectronFixture({
        fixture: path.join(import.meta.dir, "electron-tunnel.fixture.ts"),
        schemes,
      }),
    )

    expect(result.streamed).toEqual({ a: "ok:/asset", b: 128 * 1024, ws: "hmr:ping" })
    expect(result.okStats).toEqual({
      upgrades: 1,
      rejected: 0,
      ticketHeader: true,
      ticketCalls: 1,
      grantCalls: 1,
      legacyCalls: 0,
    })
    expect(result.blockedStatus).toBe(502)
    expect(result.blockedHits).toBe(0)
    expect(result.after403.upgrades).toBe(1)
    expect(result.after403.rejected).toBeGreaterThanOrEqual(1)
    expect(result.after403.legacyCalls).toBe(0)
    expect(result.legacyDelta).toEqual({ ticketCalls: 0, grantCalls: 0, upgrades: 0 })
  },
  60_000,
)
