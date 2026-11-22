import { expect, test } from "bun:test"
import { destroyedWindowURL, safeWebContentsOrigin } from "./state"

const contents = (url: string, destroyed = false) => ({ isDestroyed: () => destroyed, getURL: () => url })

// The app-level `render-process-gone` line covers pages that are not the app's own, and logs go into bug reports.
test.each([
  ["https://alex:pa55word@mail.example.com:8443/inbox/42?token=s3cret#message-7", "https://mail.example.com:8443"],
  ["http://localhost:3000/callback?code=s3cret", "http://localhost:3000"],
  ["file:///C:/Users/alex/Documents/payroll.html", "file:"],
  ["oc-preview://grant-7f3a9c/C:/Users/alex/repo/report.html", "oc-preview:"],
  ["blob:https://mail.example.com/5f0c7f3a-s3cret", "blob:"],
  ["data:text/html,<p>alex s3cret</p>", "data:"],
  ["about:blank", "about:"],
  ["", destroyedWindowURL],
  ["alex s3cret is not an address", destroyedWindowURL],
])("a crashed page at %p is logged as %p", (url, origin) => {
  expect(safeWebContentsOrigin(contents(url))).toBe(origin)
})

test("a destroyed page has no address to log", () => {
  expect(safeWebContentsOrigin(contents("https://mail.example.com/inbox", true))).toBe(destroyedWindowURL)
})
