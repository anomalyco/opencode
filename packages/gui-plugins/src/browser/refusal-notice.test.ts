import { expect, test } from "bun:test"
import { externalTarget, navigationNotice, popupActivated } from "./refusal-notice"

test("refusals describe the actual destination without displaying private, misleading or unbounded targets", () => {
  expect(navigationNotice("mailto:fixture@example.invalid", {})).toEqual({
    reason: "external",
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
  for (const scheme of ["tel", "vscode-insiders", "cursor", "slack", "zoomus", "whatsapp", "github-mac", "jetbrains"]) {
    const url = `${scheme}:fixture`
    expect(externalTarget(url)).toBe("open")
    expect(navigationNotice(url, {}, "agent")).toEqual({ reason: "external", target: url, action: "copy" })
  }

  expect(externalTarget("unknown:fixture")).toBe("copy")

  for (const scheme of [
    "data",
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
