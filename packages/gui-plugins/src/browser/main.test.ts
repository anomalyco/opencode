import { expect, test } from "bun:test"
import { Schema } from "effect"
import { BrowserPane } from "./ipc"
import { browserPaneState } from "./main"

// The host encodes this state for every change, and drops the whole event when it fails.
const encode = Schema.encodeUnknownSync(BrowserPane.spec.state)

test("browser pane state encodes before its pill embed exists", () => {
  expect(encode(browserPaneState(false, undefined))).toEqual({ locked: false })
  expect(encode(browserPaneState(true, "embed-1"))).toEqual({ locked: true, pill: "embed-1" })
})
