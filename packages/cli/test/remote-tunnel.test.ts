import { validateRoutes } from "@opentunnel/client/effect"
import { expect, test } from "bun:test"
import { RemoteTunnel } from "../src/services/remote-tunnel"

test("each channel serves remote access on its own valid subdomain of the shared tunnel", () => {
  const channels = ["latest", "dev", "beta", "Preview/Feature_X.1", "a".repeat(80), "trailing-"]
  const routes = channels.map((channel) => RemoteTunnel.route(channel))

  expect(routes.slice(0, 3)).toEqual(["opencode", "opencode-dev", "opencode-beta"])
  expect(new Set(routes).size).toBe(routes.length)
  // The SDK rejects invalid route names, which would keep the service from ever attaching.
  expect(() => validateRoutes(Object.fromEntries(routes.map((name) => [name, "127.0.0.1:4096"])))).not.toThrow()
})
