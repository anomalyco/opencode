import { Database } from "bun:sqlite"
import { mkdir, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, spyOn, test } from "bun:test"
import { offsetToPosition, resolveZedDbPath, resolveZedSelection } from "../../../src/cli/cmd/tui/context/editor-zed"
import { tmpdir } from "../../fixture/fixture"

type ZedFixtureOptions = {
  workspacePaths?: string | null
  itemKind?: string
  editor?: boolean
  selectionStart?: number | null
  selectionEnd?: number | null
  selections?: Array<{ start: number | null; end: number | null }>
  contents?: string
}

async function writeZedFixture(dir: string, options: ZedFixtureOptions = {}) {
  const dbPath = path.join(dir, "zed.sqlite")
  const filePath = path.join(dir, "file.ts")
  const contents = options.contents ?? "one\ntwo\nthree"
  await Bun.write(filePath, contents)

  const db = new Database(dbPath)
  db.run("create table workspaces (workspace_id integer, paths text, timestamp text)")
  db.run("create table panes (pane_id integer, workspace_id integer, active integer)")
  db.run("create table items (item_id integer, workspace_id integer, pane_id integer, active integer, kind text)")
  db.run("create table editors (item_id integer, workspace_id integer, buffer_path text, contents text)")
  db.run("create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer)")
  db.run("insert into workspaces values (1, ?, ?)", [options.workspacePaths ?? JSON.stringify([dir]), "2026-04-27"])
  db.run("insert into panes values (1, 1, 1)")
  db.run("insert into items values (1, 1, 1, 1, ?)", [options.itemKind ?? "Editor"])
  if (options.editor !== false) {
    db.run("insert into editors values (1, 1, ?, ?)", [filePath, contents])
    ;(
      options.selections ?? [
        {
          start: options.selectionStart === undefined ? 4 : options.selectionStart,
          end: options.selectionEnd === undefined ? 7 : options.selectionEnd,
        },
      ]
    ).forEach((selection) =>
      db.run("insert into editor_selections values (1, 1, ?, ?)", [selection.start, selection.end]),
    )
  }
  db.close()

  return { dbPath, filePath }
}

function utf8ByteOffset(text: string, offset: number) {
  return new TextEncoder().encode(text.slice(0, offset)).length
}

test("offsetToPosition converts Zed offsets to 1-based editor positions", () => {
  expect(offsetToPosition("one\ntwo\nthree", 0)).toEqual({ line: 1, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 4)).toEqual({ line: 2, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 6)).toEqual({ line: 2, character: 3 })
  expect(offsetToPosition("one\ntwo\nthree", 100)).toEqual({ line: 3, character: 6 })
  expect(offsetToPosition("Ж\nabc", utf8ByteOffset("Ж\nabc", "Ж\nabc".indexOf("a")))).toEqual({
    line: 2,
    character: 1,
  })
  expect(offsetToPosition("😀\nabc", utf8ByteOffset("😀\nabc", "😀\nabc".indexOf("a")))).toEqual({
    line: 2,
    character: 1,
  })
})

test("resolveZedDbPath skips candidates that cannot be stated", async () => {
  await using tmp = await tmpdir()
  const loop = path.join(tmp.path, "loop")
  await symlink(loop, loop)
  const home = spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const previous = process.env.OPENCODE_ZED_DB
  process.env.OPENCODE_ZED_DB = loop

  try {
    expect(resolveZedDbPath()).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_ZED_DB
    else process.env.OPENCODE_ZED_DB = previous
    home.mockRestore()
  }
})

test("resolveZedSelection returns active editor selection", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "two",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 4 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection returns all active editor selections sorted by offset", async () => {
  await using tmp = await tmpdir()
  const contents = "one\ntwo\nthree\nfour"
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selections: [
      {
        start: utf8ByteOffset(contents, contents.indexOf("four")),
        end: utf8ByteOffset(contents, contents.indexOf("four") + 4),
      },
      {
        start: utf8ByteOffset(contents, contents.indexOf("two")),
        end: utf8ByteOffset(contents, contents.indexOf("two") + 3),
      },
    ],
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "two",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 4 },
          },
        },
        {
          text: "four",
          selection: {
            start: { line: 4, character: 1 },
            end: { line: 4, character: 5 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection converts Zed UTF-8 byte offsets to string offsets", async () => {
  await using tmp = await tmpdir()
  const contents = "a\nЖЖЖЖЖЖЖЖЖЖ\nb\nTARGET\nz"
  const start = contents.indexOf("TARGET")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start),
    selectionEnd: utf8ByteOffset(contents, start + "TARGET".length),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "TARGET",
          selection: {
            start: { line: 4, character: 1 },
            end: { line: 4, character: 7 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection handles non-ASCII text inside the selected range", async () => {
  await using tmp = await tmpdir()
  const contents = "a\npre\nвыбор\nz"
  const start = contents.indexOf("выбор")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start),
    selectionEnd: utf8ByteOffset(contents, start + "выбор".length),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "выбор",
          selection: {
            start: { line: 3, character: 1 },
            end: { line: 3, character: 6 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection handles emoji before the selected range", async () => {
  await using tmp = await tmpdir()
  const contents = "😀\nTARGET\nz"
  const start = contents.indexOf("TARGET")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start),
    selectionEnd: utf8ByteOffset(contents, start + "TARGET".length),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "TARGET",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 7 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection handles reversed Zed byte offsets", async () => {
  await using tmp = await tmpdir()
  const contents = "a\nЖЖЖ\nTARGET\nz"
  const start = contents.indexOf("TARGET")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start + "TARGET".length),
    selectionEnd: utf8ByteOffset(contents, start),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "TARGET",
          selection: {
            start: { line: 3, character: 1 },
            end: { line: 3, character: 7 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection returns empty when no workspace matches", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, {
    workspacePaths: JSON.stringify([path.join(path.dirname(tmp.path), "other-workspace")]),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "empty" })
})

test("resolveZedSelection matches a Zed workspace that contains the session directory", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)

  expect(await resolveZedSelection(fixture.dbPath, path.join(tmp.path, "packages", "app"))).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "two",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 4 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection prefers the most specific containing Zed workspace", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)
  const child = path.join(tmp.path, "packages")
  const childFile = path.join(child, "child.ts")
  await mkdir(child, { recursive: true })
  await Bun.write(childFile, "child")

  const db = new Database(fixture.dbPath)
  db.run("insert into workspaces values (2, ?, ?)", [JSON.stringify([child]), "2026-01-01"])
  db.run("insert into panes values (2, 2, 1)")
  db.run("insert into items values (2, 2, 2, 1, ?)", ["Editor"])
  db.run("insert into editors values (2, 2, ?, ?)", [childFile, "child"])
  db.run("insert into editor_selections values (2, 2, 0, 5)")
  db.close()

  expect(await resolveZedSelection(fixture.dbPath, path.join(child, "app"))).toEqual({
    type: "selection",
    selection: {
      filePath: childFile,
      source: "zed",
      ranges: [
        {
          text: "child",
          selection: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 6 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection ignores a Zed workspace nested inside the session directory", async () => {
  await using tmp = await tmpdir()
  const child = path.join(tmp.path, "effect-lab")
  await mkdir(child, { recursive: true })
  const fixture = await writeZedFixture(child)

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "empty" })
})

test("resolveZedSelection returns unavailable when a Zed terminal is active", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, { itemKind: "Terminal", editor: false })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "unavailable" })
})

test("resolveZedSelection returns unavailable when the database cannot be queried", async () => {
  await using tmp = await tmpdir()

  expect(await resolveZedSelection(path.join(tmp.path, "missing.sqlite"), tmp.path)).toEqual({ type: "unavailable" })
})

test("resolveZedSelection returns unavailable when active selection is missing offsets", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, { selectionStart: null, selectionEnd: null })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "unavailable" })
})
