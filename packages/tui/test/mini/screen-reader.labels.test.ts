import { afterEach, beforeEach, expect, test } from "bun:test"
import { entryBody } from "../../src/mini/entry.body"
import { screenReader } from "../../src/mini/screen-reader"
import type { StreamCommit } from "../../src/mini/types"
import { canonicalToolPart } from "./fixture/tool-part"

beforeEach(() => {
  screenReader.enabled = true
})

afterEach(() => {
  screenReader.enabled = false
})

const commit = (input: Pick<StreamCommit, "kind" | "text" | "phase"> & Partial<StreamCommit>): StreamCommit => ({
  source: "system",
  ...input,
})

const text = (next: StreamCommit) => {
  const body = entryBody(next, { mono: true })
  return body.type === "text" ? body.content : body.type
}

test("labels the user, assistant and error speakers", () => {
  expect(text(commit({ kind: "user", text: "hi", phase: "start" }))).toBe("you: hi")
  expect(text(commit({ kind: "assistant", text: "", phase: "start" }))).toBe("assistant:")
  expect(text(commit({ kind: "error", text: "boom", phase: "final" }))).toContain("error: boom")
})

test("labels tool failures", () => {
  const failed = commit({
    kind: "tool",
    text: "",
    phase: "final",
    tool: "glob",
    toolState: "error",
    part: canonicalToolPart("glob", {
      status: "error",
      input: { pattern: "**/*tool*", path: "/tmp/demo/run" },
      error: { type: "unknown", message: "No such file or directory" },
      metadata: {},
    }),
  })
  expect(text(failed)).toBe("tool error: No such file or directory")
})

test("adds no labels outside screen reader mode", () => {
  screenReader.enabled = false
  expect(text(commit({ kind: "user", text: "hi", phase: "start" }))).toBe("> hi")
  expect(text(commit({ kind: "assistant", text: "", phase: "start" }))).toBe("none")
})
