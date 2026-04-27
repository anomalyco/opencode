import { Database } from "bun:sqlite"
import path from "node:path"
import { expect, test } from "bun:test"
import { offsetToPosition, resolveZedSelection } from "../../../src/cli/cmd/tui/context/editor-zed"
import { tmpdir } from "../../fixture/fixture"

type ZedFixtureOptions = {
  workspacePaths?: string | null
  selectionStart?: number | null
  selectionEnd?: number | null
}

async function writeZedFixture(dir: string, options: ZedFixtureOptions = {}) {
  const dbPath = path.join(dir, "zed.sqlite")
  const filePath = path.join(dir, "file.ts")
  await Bun.write(filePath, "one\ntwo\nthree")

  const db = new Database(dbPath)
  db.run("create table workspaces (workspace_id integer, paths text, timestamp text)")
  db.run("create table panes (pane_id integer, workspace_id integer, active integer)")
  db.run("create table items (item_id integer, workspace_id integer, pane_id integer, active integer, kind text)")
  db.run("create table editors (item_id integer, workspace_id integer, buffer_path text, contents text)")
  db.run("create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer)")
  db.run("insert into workspaces values (1, ?, ?)", [options.workspacePaths ?? JSON.stringify([dir]), "2026-04-27"])
  db.run("insert into panes values (1, 1, 1)")
  db.run("insert into items values (1, 1, 1, 1, 'Editor')")
  db.run("insert into editors values (1, 1, ?, ?)", [filePath, "one\ntwo\nthree"])
  db.run(
    "insert into editor_selections values (1, 1, ?, ?)",
    [
      options.selectionStart === undefined ? 4 : options.selectionStart,
      options.selectionEnd === undefined ? 7 : options.selectionEnd,
    ],
  )
  db.close()

  return { dbPath, filePath }
}

test("offsetToPosition converts Zed offsets to 1-based editor positions", () => {
  expect(offsetToPosition("one\ntwo\nthree", 0)).toEqual({ line: 1, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 4)).toEqual({ line: 2, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 6)).toEqual({ line: 2, character: 3 })
  expect(offsetToPosition("one\ntwo\nthree", 100)).toEqual({ line: 3, character: 6 })
})

test("resolveZedSelection returns active editor selection", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      text: "two",
      filePath: fixture.filePath,
      source: "zed",
      selection: {
        start: { line: 2, character: 1 },
        end: { line: 2, character: 4 },
      },
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

test("resolveZedSelection returns unavailable when the database cannot be queried", async () => {
  await using tmp = await tmpdir()

  expect(await resolveZedSelection(path.join(tmp.path, "missing.sqlite"), tmp.path)).toEqual({ type: "unavailable" })
})

test("resolveZedSelection returns unavailable when active selection is missing offsets", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, { selectionStart: null, selectionEnd: null })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "unavailable" })
})
