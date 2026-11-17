import { describe, expect, test } from "bun:test"
import { FileVerificationError } from "@opencode/util/file-verification"
import { commandFailure, loadFailure } from "./failure"
import en from "./i18n/en"

// The plugin's English copy, by key.
const message = (key: string) => Object.entries(en).find((entry) => entry[0] === key)?.[1]

// Every command the window sends for the person, and a failure main reports with no command.
const attempts = ["navigate", "tabs.open", "reload", "back", "forward", "stop", "tabs.close", "tabs.focus", undefined] as const

describe("a page that did not load", () => {
  test.each([
    ["ERR_NAME_NOT_RESOLVED", "unreachable"],
    ["ERR_CONNECTION_REFUSED", "unreachable"],
    ["ERR_ADDRESS_UNREACHABLE", "unreachable"],
    ["502 Bad Gateway", "unreachable"],
    ["ERR_INTERNET_DISCONNECTED", "offline"],
    ["ERR_TIMED_OUT", "slow"],
    ["ERR_CONNECTION_TIMED_OUT", "slow"],
    ["ERR_CERT_AUTHORITY_INVALID", "insecure"],
    ["ERR_SSL_PROTOCOL_ERROR", "insecure"],
    ["ERR_TOO_MANY_REDIRECTS", "redirects"],
    ["ERR_BLOCKED_BY_CLIENT", "blocked"],
    ["ERR_EMPTY_RESPONSE", "generic"],
    ["ERR_FAILED", "generic"],
    ["page_crashed", "crashed"],
    ["browser.restore.refused", "unavailable"],
    [FileVerificationError.code, "unavailable"],
    ["something main never said before", "generic"],
  ] as const)("%s reads as %s, in plain words", (error, kind) => {
    const view = loadFailure(error)
    expect(view.kind).toBe(kind)
    // The headline and the sentence are the plugin's own copy; Chromium's code is only the small line under them.
    expect(message(view.title)).toBeTruthy()
    expect(message(view.description)).toBeTruthy()
    expect(message(view.title)).not.toContain("ERR_")
    expect(view.code).toBe(error.startsWith("ERR_") || error.startsWith("502") ? error : undefined)
  })

  test("Chromium's code is read out of a longer message", () => {
    expect(loadFailure("ERR_CONNECTION_REFUSED (-102) loading 'http://localhost:3000/'")).toMatchObject({
      kind: "unreachable",
      code: "ERR_CONNECTION_REFUSED",
    })
  })
})

describe("a command that failed", () => {
  test.each([
    "browser.address.web",
    "browser.address.credentials",
    "browser.address.workspace",
    "browser.preview.restricted",
    "browser.preview.agentRestricted",
    "browser.pane.replaced",
    "browser.pane.unavailable",
    "browser.menu.failed",
    "browser.command.failed",
    "download_failed",
    "The browser page did not finish starting or navigating. Reload the tab and inspect it before retrying.",
    "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID.",
    "a code nobody has seen yet",
    "",
  ])("%p never reaches the person as the app's generic failure text", (code) => {
    attempts.forEach((action) => {
      const view = commandFailure(code, action)

      if (view.surface === "none") return
      // A sentence of the browser's own, which says what was tried or why not: never `common.requestFailed`.
      expect(view.text.startsWith("common.")).toBe(false)
      expect(message(view.text)).toBeTruthy()
      expect(message(view.text)).not.toBe("Request failed")
    })
  })

  test("an unknown code gets its sentence from what the person tried, and is reported as unknown", () => {
    expect(commandFailure("a code nobody has seen yet", "reload")).toEqual({
      surface: "notice",
      text: "failed.command.reload",
      lasting: false,
      retry: true,
      known: false,
    })
    expect(commandFailure("a code nobody has seen yet", "stop")).toMatchObject({ text: "failed.command.stop", retry: false })
    expect(commandFailure("a code nobody has seen yet", undefined)).toMatchObject({ text: "failed.command.other", known: false })
  })

  test("a refusal stays to be read; a load the page area explains raises no notice beside it", () => {
    expect(commandFailure("browser.address.web", "navigate")).toMatchObject({ text: "refused.web", lasting: true, retry: false })
    expect(commandFailure("ERR_NAME_NOT_RESOLVED (-105) loading 'https://nowhere.example/'", "navigate").surface).toBe("none")
    expect(commandFailure("page_crashed", undefined).surface).toBe("none")
  })
})
