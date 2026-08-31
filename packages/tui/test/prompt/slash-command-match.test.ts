import { describe, expect, test } from "bun:test"
import { slashCommandMatches } from "../../src/prompt/slash-command-match"

const options = ["/redo", "/undo", "/unshare"]
const names = (option: string) => [option]

describe("slashCommandMatches", () => {
  test("preserves existing fuzzy results", () => {
    expect(
      slashCommandMatches({
        query: "/un",
        options,
        matches: ["/unshare", "/undo", "/redo"],
        names,
      }),
    ).toEqual(["/unshare", "/undo", "/redo"])
  })

  test("falls back for one-character command typos", () => {
    expect(slashCommandMatches({ query: "/udno", options, matches: ["/redo"], names })).toEqual(["/undo", "/redo"])
    expect(slashCommandMatches({ query: "/rdo", options, matches: [], names })).toEqual(["/redo"])
    expect(slashCommandMatches({ query: "/undos", options, matches: [], names })).toEqual(["/undo"])
  })

  test("does not surface distant or short matches", () => {
    expect(slashCommandMatches({ query: "/udnno", options, matches: [], names })).toEqual([])
    expect(slashCommandMatches({ query: "/rd", options, matches: ["/redo"], names })).toEqual(["/redo"])
  })
})
