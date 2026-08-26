import { describe, expect, test } from "bun:test"
import { acceptedLastActiveUrl } from "./route-storage"

describe("desktop last active route", () => {
  test("restores current desktop routes", () => {
    expect(acceptedLastActiveUrl("/")).toBe("/")
    expect(acceptedLastActiveUrl("/settings")).toBe("/settings")
    expect(acceptedLastActiveUrl("/settings?tab=models&server=local&directory=%2Fproject")).toBe(
      "/settings?tab=models&server=local&directory=%2Fproject",
    )
    expect(acceptedLastActiveUrl("/new-session?directory=C%3A%5Cwork#draft")).toBe(
      "/new-session?directory=C%3A%5Cwork#draft",
    )
    expect(acceptedLastActiveUrl("/server/wsl%3ADebian/session/abc?view=review#file")).toBe(
      "/server/wsl%3ADebian/session/abc?view=review#file",
    )
  })

  test("falls back for invalid saved routes", () => {
    expect(acceptedLastActiveUrl(undefined)).toBe("/")
    expect(acceptedLastActiveUrl("/settings/extra")).toBe("/")
    expect(acceptedLastActiveUrl("/new-session/extra")).toBe("/")
    expect(acceptedLastActiveUrl("/server/sidecar/session/abc/extra")).toBe("/")
  })
})
