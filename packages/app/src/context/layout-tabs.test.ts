import { describe, expect, test } from "bun:test"
import {
  SESSION_OPEN_FILE_TAB,
  closeSessionTab,
  openSessionTab,
  previewSessionTab,
  type SessionTabState,
} from "./layout-tabs"

const state = (all: string[], active?: string, preview?: string): SessionTabState => ({
  tabs: { all, active },
  preview,
})

describe("previewSessionTab", () => {
  test("appends the Open File placeholder", () => {
    expect(previewSessionTab(state(["file://a.ts"], "file://a.ts"), SESSION_OPEN_FILE_TAB)).toEqual(
      state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
    )
  })

  test("replaces the current preview in place", () => {
    expect(
      previewSessionTab(
        state(["context", SESSION_OPEN_FILE_TAB, "file://b.ts"], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
        "file://a.ts",
      ),
    ).toEqual(state(["context", "file://a.ts", "file://b.ts"], "file://a.ts", "file://a.ts"))
  })

  test("activates a durable tab without duplicating it", () => {
    expect(
      previewSessionTab(
        state(["file://a.ts", SESSION_OPEN_FILE_TAB, "file://b.ts"], SESSION_OPEN_FILE_TAB, SESSION_OPEN_FILE_TAB),
        "file://b.ts",
      ),
    ).toEqual(state(["file://a.ts", "file://b.ts"], "file://b.ts"))
  })

  test("replaces a restored Open File placeholder", () => {
    expect(
      previewSessionTab(state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB), "file://b.ts"),
    ).toEqual(state(["file://a.ts", "file://b.ts"], "file://b.ts", "file://b.ts"))
  })
})

describe("openSessionTab", () => {
  test("pins the current preview", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://a.ts")).toEqual(
      state(["file://a.ts"], "file://a.ts"),
    )
  })

  test("replaces a preview with a directly opened file", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://b.ts")).toEqual(
      state(["file://b.ts"], "file://b.ts"),
    )
  })

  test("keeps the preview when switching to Review", () => {
    expect(openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "review")).toEqual(
      state(["file://a.ts"], "review", "file://a.ts"),
    )
  })

  test("replaces a restored Open File placeholder with a direct open", () => {
    expect(openSessionTab(state(["file://a.ts", SESSION_OPEN_FILE_TAB], SESSION_OPEN_FILE_TAB), "file://b.ts")).toEqual(
      state(["file://a.ts", "file://b.ts"], "file://b.ts"),
    )
  })
})

describe("closeSessionTab", () => {
  test("clears preview metadata and selects the left neighbor", () => {
    expect(
      closeSessionTab(
        state(["file://a.ts", "file://b.ts", "file://c.ts"], "file://b.ts", "file://b.ts"),
        "file://b.ts",
      ),
    ).toEqual(state(["file://a.ts", "file://c.ts"], "file://a.ts"))
  })
})
