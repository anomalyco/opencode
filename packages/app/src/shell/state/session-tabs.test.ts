import { expect, test } from "bun:test"
import { closeSessionTab, openSessionTab, previewSessionTab, type SessionTabState } from "./session-tabs"

const OPEN = "file:open"

const launchers = new Set([OPEN])

const state = (all: string[], active?: string, preview?: string): SessionTabState => ({
  tabs: { all, active },
  preview,
})

test.each([
  {
    name: "preview appends the Open File placeholder",
    run: () => previewSessionTab(state(["file://a.ts"], "file://a.ts"), OPEN),
    expected: state(["file://a.ts", OPEN], OPEN, OPEN),
  },
  {
    name: "preview replaces the current preview in place",
    run: () => previewSessionTab(state(["context", OPEN, "file://b.ts"], OPEN, OPEN), "file://a.ts"),
    expected: state(["context", "file://a.ts", "file://b.ts"], "file://a.ts", "file://a.ts"),
  },
  {
    name: "preview activates a durable tab without duplicating it",
    run: () => previewSessionTab(state(["file://a.ts", OPEN, "file://b.ts"], OPEN, OPEN), "file://b.ts"),
    expected: state(["file://a.ts", "file://b.ts"], "file://b.ts"),
  },
  {
    name: "preview replaces a restored Open File placeholder",
    run: () => previewSessionTab(state(["file://a.ts", OPEN], OPEN), "file://b.ts", launchers),
    expected: state(["file://a.ts", "file://b.ts"], "file://b.ts", "file://b.ts"),
  },
  {
    name: "open pins the current preview",
    run: () => openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://a.ts"),
    expected: state(["file://a.ts"], "file://a.ts"),
  },
  {
    name: "open replaces a preview with a directly opened file",
    run: () => openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://b.ts"),
    expected: state(["file://b.ts"], "file://b.ts"),
  },
  {
    name: "open replaces a restored Open File placeholder",
    run: () => openSessionTab(state(["file://a.ts", OPEN], OPEN), "file://b.ts", launchers),
    expected: state(["file://a.ts", "file://b.ts"], "file://b.ts"),
  },
  {
    name: "close clears preview metadata and selects the left neighbor",
    run: () =>
      closeSessionTab(
        state(["file://a.ts", "file://b.ts", "file://c.ts"], "file://b.ts", "file://b.ts"),
        "file://b.ts",
      ),
    expected: state(["file://a.ts", "file://c.ts"], "file://a.ts"),
  },
])("$name", ({ run, expected }) => {
  expect(run()).toEqual(expected)
})
