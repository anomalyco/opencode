import { expect, test } from "bun:test"
import { browserCommand } from "./default-browser"

test("a verified document is a single URL argument to the HTTPS application, never the executable", () => {
  const url = "file:///work/report%20%231.html"
  const exe = "C:\\Program Files\\Browser\\browser.exe"
  expect(browserCommand("win32", exe, url)).toEqual({ file: exe, args: [url] })
  expect(browserCommand("darwin", "/Applications/Browser.app", url)).toEqual({ file: "/usr/bin/open", args: ["-a", "/Applications/Browser.app", url] })
  expect(browserCommand("linux", "/usr/share/applications/browser.desktop", url)).toEqual({ file: "/usr/bin/gio", args: ["launch", "/usr/share/applications/browser.desktop", url] })
  expect(browserCommand("win32", "browser.exe", url)).toBeUndefined()
  expect(browserCommand("win32", "C:\\work\\entry.cmd", url)).toBeUndefined()
  expect(browserCommand("darwin", "", url)).toBeUndefined()
  expect(browserCommand("linux", "browser.desktop", url)).toBeUndefined()
})
