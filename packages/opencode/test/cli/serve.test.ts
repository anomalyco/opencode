import { describe, expect, test } from "bun:test"
import { autoTailscaleAdvertiseHost } from "../../src/cli/cmd/serve"

describe("autoTailscaleAdvertiseHost", () => {
  const status = {
    Self: {
      DNSName: "exos.husky-tilapia.ts.net.",
      TailscaleIPs: ["100.76.251.88", "fd7a:115c:a1e0::435:fb58"],
    },
  }

  test("advertises the MagicDNS hostname for all-interface listeners", () => {
    expect(autoTailscaleAdvertiseHost("0.0.0.0", status)).toBe("exos.husky-tilapia.ts.net")
  })

  test("advertises the MagicDNS hostname for Tailscale-bound listeners", () => {
    expect(autoTailscaleAdvertiseHost("100.76.251.88", status)).toBe("exos.husky-tilapia.ts.net")
  })

  test("skips the MagicDNS hostname for unrelated listeners", () => {
    expect(autoTailscaleAdvertiseHost("192.168.1.20", status)).toBeUndefined()
  })
})
