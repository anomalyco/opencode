import { describe, expect, test } from "bun:test"
import {
  BROWSING_WEB_ACTIVITY_TYPE,
  buildHandoffActivity,
  HANDOFF_ACTIVITY_TYPE,
  handoffDeepLink,
  universalLinkToDeepLink,
} from "./handoff"

describe("desktop Handoff activity", () => {
  test("builds a credential-free payload and expands loopback sidecar URLs to reachable interfaces", () => {
    const built = buildHandoffActivity(
      {
        sessionID: "ses_abc123",
        directory: "/Users/kit/code/opencode",
        projectID: "prj_1",
        serverKey: "sidecar",
        serverURLs: [
          "http://127.0.0.1:4096",
          "https://kit:secret-token-123@studio.taila8e7c7.ts.net:4096/api?token=xyz#frag",
        ],
      },
      {
        hostname: "kits-Mac-Studio.local",
        interfaces: {
          lo0: [
            {
              address: "127.0.0.1",
              netmask: "255.0.0.0",
              family: "IPv4",
              mac: "00:00:00:00:00:00",
              internal: true,
              cidr: "127.0.0.1/8",
            },
          ],
          utun3: [
            {
              address: "100.84.220.87",
              netmask: "255.255.255.255",
              family: "IPv4",
              mac: "00:00:00:00:00:00",
              internal: false,
              cidr: "100.84.220.87/32",
            },
          ],
        },
      },
    )

    expect(built).toEqual({
      type: HANDOFF_ACTIVITY_TYPE,
      userInfo: {
        v: 1,
        sessionID: "ses_abc123",
        directory: "/Users/kit/code/opencode",
        projectID: "prj_1",
        serverKey: "sidecar",
        serverURLs: ["http://100.84.220.87:4096", "https://studio.taila8e7c7.ts.net:4096"],
        machineHost: "kits-Mac-Studio.local",
      },
      webpageURL: "http://100.84.220.87:4096/server/aHR0cDovLzEwMC44NC4yMjAuODc6NDA5Ng/session/ses_abc123",
    })

    const serialized = JSON.stringify(built)
    expect(serialized).not.toContain("secret-token-123")
    expect(serialized).not.toContain("token=xyz")
    expect(serialized).not.toContain("127.0.0.1")
  })

  test("converts incoming Handoff and browsing activities into opencode://session deep links", () => {
    const link = handoffDeepLink(
      HANDOFF_ACTIVITY_TYPE,
      {
        v: 1,
        sessionID: "ses_abc123",
        directory: "/Users/kit/code/opencode",
        projectID: "prj_1",
        serverKey: "a1b2c3d4e5f6",
        machineHost: "kits-Mac-Studio.local",
        serverURLs: ["https://studio.taila8e7c7.ts.net:4096", "http://127.0.0.1:4096"],
      },
      "https://studio.taila8e7c7.ts.net:4096/server/aHR0cHM6Ly9zdHVkaW8udGFpbGE4ZTdjNy50cy5uZXQ6NDA5Ng/session/ses_abc123",
    )

    expect(link).toBe(
      "opencode://session/ses_abc123?dir=%2FUsers%2Fkit%2Fcode%2Fopencode&project=prj_1&server=a1b2c3d4e5f6&host=kits-Mac-Studio.local&url=https%3A%2F%2Fstudio.taila8e7c7.ts.net%3A4096&web=https%3A%2F%2Fstudio.taila8e7c7.ts.net%3A4096%2Fserver%2FaHR0cHM6Ly9zdHVkaW8udGFpbGE4ZTdjNy50cy5uZXQ6NDA5Ng%2Fsession%2Fses_abc123",
    )

    const webLink = handoffDeepLink(
      BROWSING_WEB_ACTIVITY_TYPE,
      {},
      "https://r8k2p9.t1.opentunnel.xyz/session/ses_older?dir=/work/docs",
    )
    expect(webLink).toBe("opencode://session/ses_older?url=https%3A%2F%2Fr8k2p9.t1.opentunnel.xyz&dir=%2Fwork%2Fdocs")
    expect(
      universalLinkToDeepLink(
        "https://studio.taila8e7c7.ts.net:4096/server/aHR0cHM6Ly9zdHVkaW8udGFpbGE4ZTdjNy50cy5uZXQ6NDA5Ng/session/ses_newer",
      ),
    ).toBe("opencode://session/ses_newer?url=https%3A%2F%2Fstudio.taila8e7c7.ts.net%3A4096")
  })

  test("rejects malformed or unsupported Handoff payloads", () => {
    expect(buildHandoffActivity(null)).toBeUndefined()
    expect(buildHandoffActivity({ sessionID: "not_a_session", serverURLs: [] })).toBeUndefined()
    expect(handoffDeepLink(HANDOFF_ACTIVITY_TYPE, { v: 2, sessionID: "ses_123" })).toBeUndefined()
    expect(handoffDeepLink(HANDOFF_ACTIVITY_TYPE, { v: 1, sessionID: "../ses_123" })).toBeUndefined()
    expect(handoffDeepLink("com.example.other", { v: 1, sessionID: "ses_123" })).toBeUndefined()
  })
})
