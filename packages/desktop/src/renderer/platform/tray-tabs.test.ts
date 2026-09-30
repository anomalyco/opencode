import { expect, test } from "bun:test"
import { traySessionIDs } from "./tray-tabs"

test("publishes local session tabs, not drafts or sessions on another server", () => {
  expect(
    traySessionIDs([
      { type: "session", server: "sidecar", sessionId: "open" },
      { type: "session", server: "sidecar", sessionId: "open" },
      { type: "draft", server: "sidecar" },
      { type: "session", server: "https://remote.example", sessionId: "remote" },
      { type: "session", server: "wsl:Ubuntu", sessionId: "wsl" },
      { type: "session", server: "sidecar", sessionId: "another" },
    ]),
  ).toEqual(["open", "another"])
})
