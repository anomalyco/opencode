import { expect, test } from "bun:test"
import { activityOwner, downloadOwner, recordTabFocus, type TabActivity } from "./policy"
import { externalTarget, navigationNotice, popupActivated } from "./refusal-notice"

test("refusals describe the actual destination without displaying private, misleading or unbounded targets", () => {
  expect(navigationNotice("mailto:fixture@example.invalid", {})).toEqual({
    reason: "external",
    source: "page",
    action: "open",
    target: "mailto:fixture@example.invalid",
  })
  expect(navigationNotice("https://name:secret@example.invalid", {})).toEqual({ reason: "browser.address.credentials" })

  for (const url of [
    "file:///etc/passwd",
    "oc-preview://private/secret",
    // A remote server's preview address is the app's own display form, not an app to launch or a link to copy.
    "workspace://ses_other/site/index.html",
    "javascript:noop()",
    "slack://user:password@host",
    "slack://abc\n",
    "tel:12\u202e34",
    `sms:${"x".repeat(2048)}`,
  ]) {
    expect(navigationNotice(url, { fileRoots: ["/workspace"] })).toEqual({ reason: "browser.address.workspace" })
    expect(navigationNotice(url, {})).toEqual({ reason: "browser.address.web" })
  }
})

test("external app launches need a known scheme and a non-agent request; unsafe targets cannot be copied either", () => {
  for (const scheme of ["obsidian", "tel", "vscode-insiders", "cursor", "slack", "zoomus", "whatsapp", "github-mac", "jetbrains"]) {
    const url = `${scheme}:fixture`
    expect(externalTarget(url)).toBe("open")
    expect(navigationNotice(url, {}, "agent")).toEqual({ reason: "external", target: url, source: "page", action: "copy" })
  }

  expect(externalTarget("unknown:fixture")).toBe("copy")

  for (const scheme of [
    "data",
    "about",
    "blob",
    "vbscript",
    "file",
    "oc-preview",
    "workspace",
    "oc",
    "javascript",
    "chrome-extension",
    "opencode",
    "ms-msdt",
    "search-ms",
    "ms-officecmd",
  ])
    expect(externalTarget(`${scheme}:target`)).toBeUndefined()
})

test("a popup needs Chromium's activation report for that same target", () => {
  const url = "https://example.test/"
  expect(popupActivated({ url, userGesture: true }, url)).toBe(true)
  expect(popupActivated({ url, userGesture: false }, url)).toBe(false)
  expect(popupActivated({ url, userGesture: true }, `${url}other`)).toBe(false)
  expect(popupActivated(undefined, url)).toBe(false)
})

test("selecting a revealed agent tab grants neither app-link activation nor a user download", () => {
  const activity: TabActivity = { agentRuns: 0 }
  recordTabFocus(activity, "agent")
  recordTabFocus(activity, "user")
  expect(navigationNotice("mailto:test@example.invalid", {}, activityOwner(activity))).toMatchObject({ action: "copy" })
  expect(downloadOwner({ ...activity, page: ["https://test.invalid"], chain: [] })).toBe("agent")
})

test("conversation links use only the conversation subset of the page policy", () => {
  for (const scheme of ["vscode", "vscode-insiders", "cursor", "zed", "jetbrains"]) {
    expect(externalTarget(`${scheme}:fixture`, "conversation")).toBe("copy")
    expect(externalTarget(`${scheme}:fixture`, "page")).toBe("open")
  }

  for (const url of ["obsidian://open?vault=fixture", "obsidian://search?query=fixture", "mailto:fixture", "zoommtg:fixture", "zoomus:fixture"]) {
    expect(navigationNotice(url, {}, "conversation")).toMatchObject({ source: "conversation", action: "open" })
  }

  for (const url of ["obsidian://new?overwrite=true", "obsidian://plugin-command", "obsidian:fixture", "obsidian://open/other", "mailto:user@example.org?attach=fixture", "mailto:user@example.org?subject=ok&%61TTACHMENT=fixture"]) {
    expect(externalTarget(url, "conversation")).toBe("copy")
    expect(externalTarget(url, "page")).toBe("open")
  }
})

test("only a short, wholly visible ASCII target can launch an app", () => {
  for (const padding of ["\u3000", "\u2028", "\u00a0", " ", "\u200b", "\u{e0041}", "אבג", "W".repeat(200)]) {
    expect(externalTarget(`obsidian://new?name=Notes${padding}&content=fixture`)).toBe("copy")
  }

  expect(externalTarget(`obsidian:${"W".repeat(191)}`)).toBe("open")
  expect(externalTarget(`obsidian:${"W".repeat(192)}`)).toBe("copy")
})

test("editor redirects without a person's input in the current page stay copy-only", () => {
  for (const scheme of ["vscode", "vscode-insiders", "cursor", "zed", "jetbrains"]) {
    const url = `${scheme}:fixture`
    // A conversation link to a web page that redirects here: the person's click was in the chat, not in this page.
    expect(navigationNotice(url, {}, "user")).toMatchObject({ source: "page", action: "copy" })
    expect(navigationNotice(url, {}, "user", true)).toMatchObject({ action: "open" })
    expect(navigationNotice(url, {}, "agent", true)).toMatchObject({ action: "copy" })
    expect(navigationNotice(url, {}, "conversation", true)).toMatchObject({ action: "copy" })
  }

  expect(navigationNotice("zoommtg:fixture", {}, "user")).toMatchObject({ action: "open" })
})
