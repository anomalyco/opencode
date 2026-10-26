import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { commentNote } from "./comment"

const comment = {
  origin: "browser",
  tabID: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000000"),
  url: "http://localhost:5173/",
  element: { ref: Browser.Ref.make("e42"), selector: "#save", label: "button#save" },
  comment: "Rename this",
}

describe("element comment notes", () => {
  test("explain a selector that crosses into a shadow root", () => {
    expect(
      commentNote({ ...comment, element: { ...comment.element, selector: "#card >>> div > button" } }).subject,
    ).toContain('selector "#card >>> div > button" (">>>" enters a shadow root)')
    expect(commentNote(comment).subject).not.toContain("shadow root")
  })

  test("leave out a selector that was too long to keep", () => {
    expect(commentNote({ ...comment, element: { ...comment.element, selector: "" } }).live?.subject).toBe(
      'the "button#save" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/ (browser ref @e42, usable as ref in any browser tool including browser.evaluate until the page navigates)',
    )
  })
})
