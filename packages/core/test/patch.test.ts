import { describe, expect, test } from "bun:test"
import { Patch } from "@opencode-ai/core/patch"

describe("Patch", () => {
  test("parses add, update, and delete hunks", () => {
    expect(
      Patch.parse(
        "*** Begin Patch\n*** Add File: add.txt\n+added\n*** Update File: update.txt\n@@ section\n-old\n+new\n*** Delete File: delete.txt\n*** End Patch",
      ),
    ).toEqual([
      { type: "add", path: "add.txt", contents: "added" },
      {
        type: "update",
        path: "update.txt",
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: "section", endOfFile: undefined }],
        movePath: undefined,
      },
      { type: "delete", path: "delete.txt" },
    ])
  })

  test("parses a file move", () => {
    expect(
      Patch.parse(
        "*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n@@\n-old\n+new\n*** End Patch",
      ),
    ).toEqual([
      {
        type: "update",
        path: "old.txt",
        movePath: "new.txt",
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: undefined, endOfFile: undefined }],
      },
    ])
  })

  test("rejects invalid patch format", () => {
    expect(() => Patch.parse("This is not a valid patch")).toThrow("Invalid patch format")
  })

  test("strips a heredoc wrapper", () => {
    expect(Patch.parse("cat <<'EOF'\n*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch\nEOF")).toEqual([
      { type: "add", path: "add.txt", contents: "added" },
    ])
  })

  test("strips a heredoc wrapper without cat", () => {
    expect(Patch.parse("<<EOF\n*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch\nEOF")).toEqual([
      { type: "add", path: "add.txt", contents: "added" },
    ])
  })

  test("derives fuzzy line updates while preserving BOM", () => {
    const update = Patch.derive("update.txt", [{ oldLines: ["  old   "], newLines: ["new"] }], "\uFEFFold\n")
    expect(update).toEqual({ content: "new\n", bom: true })
    expect(Patch.joinBom(update.content, update.bom)).toBe("\uFEFFnew\n")
  })

  test("derives multiple update chunks", () => {
    expect(
      Patch.derive(
        "update.txt",
        [
          { oldLines: ["line 2"], newLines: ["LINE 2"] },
          { oldLines: ["line 4"], newLines: ["LINE 4"] },
        ],
        "line 1\nline 2\nline 3\nline 4\n",
      ).content,
    ).toBe("line 1\nLINE 2\nline 3\nLINE 4\n")
  })

  test("updates empty files and adds a trailing newline", () => {
    expect(Patch.derive("empty.txt", [{ oldLines: [], newLines: ["First line"] }], "").content).toBe(
      "First line\n",
    )
    expect(Patch.derive("no-newline.txt", [{ oldLines: ["old"], newLines: ["new"] }], "old").content).toBe(
      "new\n",
    )
  })

  test("disambiguates updates with change context", () => {
    expect(
      Patch.derive(
        "update.txt",
        [{ oldLines: ["x=10"], newLines: ["x=11"], changeContext: "fn b" }],
        "fn a\nx=10\nfn b\nx=10\n",
      ).content,
    ).toBe("fn a\nx=10\nfn b\nx=11\n")
  })

  test("matches leading, trailing, and Unicode punctuation differences", () => {
    expect(Patch.derive("leading.txt", [{ oldLines: ["line"], newLines: ["next"] }], "  line\n").content).toBe(
      "next\n",
    )
    expect(Patch.derive("trailing.txt", [{ oldLines: ["line"], newLines: ["next"] }], "line  \n").content).toBe(
      "next\n",
    )
    expect(
      Patch.derive('unicode.txt', [{ oldLines: ['He said "hello"'], newLines: ['He said "hi"'] }], 'He said “hello”\n')
        .content,
    ).toBe('He said "hi"\n')
  })

  test("matches EOF-anchored chunks from the end", () => {
    expect(
      Patch.derive(
        "update.txt",
        [{ oldLines: ["marker", "end"], newLines: ["marker changed", "end"], endOfFile: true }],
        "marker\nmiddle\nmarker\nend\n",
      ).content,
    ).toBe("marker\nmiddle\nmarker changed\nend\n")
  })

  test("matches V1 lenient parsing of malformed hunk bodies", () => {
    expect(Patch.parse("*** Begin Patch\n*** Add File: add.txt\nmissing plus\n*** End Patch")).toEqual([
      { type: "add", path: "add.txt", contents: "" },
    ])
    expect(Patch.parse("*** Begin Patch\n*** Update File: update.txt\n*** End Patch")).toEqual([
      { type: "update", path: "update.txt", movePath: undefined, chunks: [] },
    ])
    expect(Patch.parse("*** Begin Patch\n*** Delete File: delete.txt\nunexpected body\n*** End Patch")).toEqual([
      { type: "delete", path: "delete.txt" },
    ])
  })
})
