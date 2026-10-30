import { expect, test } from "bun:test"
import type { SimpleHighlight } from "@opentui/core"
import { narrowBashHighlights } from "../../src/util/bash-highlight"

function groups(content: string, highlights: SimpleHighlight[]) {
  return narrowBashHighlights(highlights, content).map(([start, end, group]) => `${content.slice(start, end)}:${group}`)
}

test("keeps the number capture only on numbers", () => {
  const content = "sleep 10 ls 0x1F 2#101"
  expect(
    groups(content, [
      [0, 5, "number"],
      [6, 8, "number"],
      [9, 11, "number"],
      [12, 16, "number"],
      [17, 22, "number"],
    ]),
  ).toEqual(["10:number", "0x1F:number", "2#101:number"])
})

test("keeps the constant capture only on upper-case and special variables", () => {
  const content = "$HOME $path $? $@"
  expect(
    groups(content, [
      [1, 5, "constant"],
      [7, 11, "constant"],
      [13, 14, "constant"],
      [16, 17, "constant"],
    ]),
  ).toEqual(["HOME:constant", "?:constant", "@:constant"])
})

test("keeps the directive capture only on a shebang and leaves other groups alone", () => {
  const content = "#!/bin/sh\n# note\necho"
  expect(
    groups(content, [
      [0, 9, "keyword.directive"],
      [10, 16, "keyword.directive"],
      [17, 21, "function.call"],
    ]),
  ).toEqual(["#!/bin/sh:keyword.directive", "echo:function.call"])
})

test("drops the spell captures that would override a comment's color", () => {
  const content = "ls # list"
  expect(
    groups(content, [
      [3, 9, "comment"],
      [3, 9, "spell"],
      [0, 2, "nospell"],
    ]),
  ).toEqual(["# list:comment"])
})
