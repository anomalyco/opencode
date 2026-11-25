import { expect, test } from "bun:test"
import path from "node:path"
import { pickerStarts } from "./picker-start"

const home = path.resolve("home", "me")

const project = path.resolve("work", "project")

test.each([
  {
    name: "no request opens at home, never the system's default",
    requested: undefined,
    save: false,
    starts: [{ check: home, use: home }],
  },
  {
    name: "a blank request is no folder",
    requested: "  ",
    save: false,
    starts: [{ check: home, use: home }],
  },
  {
    name: "a relative request is no folder",
    requested: path.join("relative", "folder"),
    save: false,
    starts: [{ check: home, use: home }],
  },
  {
    name: "an explicit folder is tried first, then home",
    requested: project,
    save: false,
    starts: [
      { check: project, use: project },
      { check: home, use: home },
    ],
  },
  {
    name: "a save picker checks the suggested file's folder and keeps its name at home",
    requested: path.join(project, "notes.txt"),
    save: true,
    starts: [
      { check: project, use: path.join(project, "notes.txt") },
      { check: home, use: path.join(home, "notes.txt") },
    ],
  },
])("$name", ({ requested, save, starts }) => {
  expect(pickerStarts(requested, home, save)).toEqual(starts)
})
