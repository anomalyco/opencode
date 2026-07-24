import { describe, expect, test } from "bun:test"
import type { BrowserPaneCommand, BrowserPanePlatform } from "@/context/platform"
import { runBrowserPaneCommand } from "./browser-pane"

describe("runBrowserPaneCommand", () => {
  test("routes every toolbar command rejection to the error handler", async () => {
    const errors: string[] = []
    const browser: BrowserPanePlatform = {
      setLayout: () => undefined,
      subscribe: async () => () => undefined,
      command: (command) => Promise.reject(new Error(`failed:${command.type}`)),
    }
    const commands: BrowserPaneCommand[] = [
      { type: "navigate", url: "https://example.com" },
      { type: "back" },
      { type: "forward" },
      { type: "reload" },
      { type: "stop" },
    ]

    for (const command of commands) {
      await runBrowserPaneCommand(browser, command, (error) => errors.push(error))
    }

    expect(errors).toEqual(commands.map((command) => `failed:${command.type}`))
  })
})
