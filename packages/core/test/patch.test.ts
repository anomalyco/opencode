import { describe, expect, test } from "bun:test"
import { Patch } from "@opencode-ai/util/patch"
import { Result } from "effect"

const parse = (input: string) => Result.getOrThrow(Patch.parse(input))

describe("Patch", () => {
  test("parses add, update, and delete hunks", () => {
    expect(
      parse(
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

  test("parses an empty patch", () => {
    expect(parse("*** Begin Patch\n*** End Patch")).toEqual([])
  })

  test("ignores a Codex environment preamble", () => {
    expect(
      parse("*** Begin Patch\n*** Environment ID: remote\n*** Add File: file.txt\n+content\n*** End Patch"),
    ).toEqual([{ type: "add", path: "file.txt", contents: "content" }])
  })

  test("parses an update followed by an add", () => {
    expect(
      parse("*** Begin Patch\n*** Update File: update.txt\n@@\n+line\n*** Add File: add.txt\n+content\n*** End Patch"),
    ).toEqual([
      {
        type: "update",
        path: "update.txt",
        movePath: undefined,
        chunks: [{ oldLines: [], newLines: ["line"], changeContext: undefined }],
      },
      { type: "add", path: "add.txt", contents: "content" },
    ])
  })

  test("parses a file move", () => {
    expect(
      parse("*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n@@\n-old\n+new\n*** End Patch"),
    ).toEqual([
      {
        type: "update",
        path: "old.txt",
        movePath: "new.txt",
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: undefined, endOfFile: undefined }],
      },
    ])
  })

  test("identifies the missing patch boundary", () => {
    expect(() => parse("This is not a valid patch")).toThrow("The first line of the patch must be '*** Begin Patch'")
    expect(() => parse("*** Begin Patch\n*** Add File: add.txt\n+added")).toThrow(
      "The last line of the patch must be '*** End Patch'",
    )
    expect(() => parse("extra\n*** Begin Patch\n*** End Patch")).toThrow(
      "The first line of the patch must be '*** Begin Patch'",
    )
    expect(() => parse("*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch\nextra")).toThrow(
      "The last line of the patch must be '*** End Patch'",
    )
  })

  test("allows whitespace after the end marker", () => {
    expect(parse("*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch\n \t\n")).toEqual([
      { type: "add", path: "add.txt", contents: "added" },
    ])
  })

  test("strips a heredoc wrapper", () => {
    expect(parse("cat <<'EOF'\n*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch\nEOF")).toEqual([
      { type: "add", path: "add.txt", contents: "added" },
    ])
  })

  test("strips a heredoc wrapper without cat", () => {
    expect(parse("<<EOF\n*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch\nEOF")).toEqual([
      { type: "add", path: "add.txt", contents: "added" },
    ])
  })

  test("strips quoted heredoc wrappers", () => {
    const patch = "*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch"
    expect(parse(`<<'EOF'\n${patch}\nEOF`)).toEqual([{ type: "add", path: "add.txt", contents: "added" }])
    expect(parse(`<<\"EOF\"\n${patch}\nEOF`)).toEqual([{ type: "add", path: "add.txt", contents: "added" }])
  })

  test("rejects malformed heredoc wrappers", () => {
    const patch = "*** Begin Patch\n*** Add File: add.txt\n+added\n*** End Patch"
    expect(() => parse(`<<\"EOF'\n${patch}\nEOF`)).toThrow("The first line of the patch must be '*** Begin Patch'")
    expect(() => parse("<<EOF\n*** Begin Patch\n*** Add File: add.txt\n+added\nEOF")).toThrow(
      "The last line of the patch must be '*** End Patch'",
    )
  })

  test("parses a whitespace-padded hunk header", () => {
    expect(parse("*** Begin Patch\n  *** Update File: foo.txt\n@@\n-old\n+new\n*** End Patch")).toEqual([
      {
        type: "update",
        path: "foo.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: undefined, endOfFile: undefined }],
      },
    ])
  })

  test("parses leading and trailing whitespace around patch markers", () => {
    expect(parse(" *** Begin Patch\n*** Update File: file.txt\n@@\n-one\n+two\n*** End Patch ")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["one"], newLines: ["two"], changeContext: undefined, endOfFile: undefined }],
      },
    ])
  })

  test("parses whitespace on the inner sides of patch marker lines", () => {
    expect(parse("*** Begin Patch \n*** Update File: file.txt\n@@\n-one\n+two\n *** End Patch")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["one"], newLines: ["two"], changeContext: undefined, endOfFile: undefined }],
      },
    ])
  })

  test("parses relative and absolute hunk paths", () => {
    expect(
      parse(
        "*** Begin Patch\n*** Add File: relative.txt\n+content\n*** Delete File: /tmp/delete.txt\n*** Update File: /tmp/update.txt\n@@\n-old\n+new\n*** End Patch",
      ),
    ).toEqual([
      { type: "add", path: "relative.txt", contents: "content" },
      { type: "delete", path: "/tmp/delete.txt" },
      {
        type: "update",
        path: "/tmp/update.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: undefined }],
      },
    ])
  })

  test("strips one carriage return from CRLF patch lines", () => {
    expect(parse("*** Begin Patch\r\n*** Update File: file.txt\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\n")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: undefined, endOfFile: undefined }],
      },
    ])
  })

  test("preserves an extra carriage return in CRLF patch lines", () => {
    expect(parse("*** Begin Patch\r\n*** Update File: file.txt\r\n@@\r\n-old\r\r\n+new\r\n*** End Patch\r\n")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["old\r"], newLines: ["new"], changeContext: undefined, endOfFile: undefined }],
      },
    ])
  })

  test("preserves the end-of-file marker", () => {
    expect(parse("*** Begin Patch\n*** Update File: file.txt\n@@\n+quux\n*** End of File\n\n*** End Patch")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: [], newLines: ["quux"], changeContext: undefined, endOfFile: true }],
      },
    ])
  })

  test("allows an end-of-file marker before an explicit chunk", () => {
    expect(parse("*** Begin Patch\n*** Update File: file.txt\n*** End of File\n@@\n-old\n+new\n*** End Patch")).toEqual(
      [
        {
          type: "update",
          path: "file.txt",
          movePath: undefined,
          chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: undefined }],
        },
      ],
    )
  })

  test("allows an end-of-file marker before an implicit chunk and move", () => {
    expect(parse("*** Begin Patch\n*** Update File: file.txt\n*** End of File\n-old\n+new\n*** End Patch")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["old"], newLines: ["new"] }],
      },
    ])
    expect(
      parse(
        "*** Begin Patch\n*** Update File: old.txt\n*** End of File\n*** Move to: new.txt\n@@\n-old\n+new\n*** End Patch",
      ),
    ).toEqual([
      {
        type: "update",
        path: "old.txt",
        movePath: "new.txt",
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: undefined }],
      },
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

  test("appends a pure-addition chunk to a nonempty file", () => {
    expect(
      Patch.derive("update.txt", [{ oldLines: [], newLines: ["added 1", "added 2"] }], "line 1\nline 2\n").content,
    ).toBe("line 1\nline 2\nadded 1\nadded 2\n")
  })

  test("applies a pure-addition chunk after an earlier replacement", () => {
    expect(
      Patch.derive(
        "update.txt",
        [
          { oldLines: [], newLines: ["after-context", "second-line"] },
          { oldLines: ["line1", "line2", "line3"], newLines: ["line1", "line2-replacement"] },
        ],
        "line1\nline2\nline3\n",
      ).content,
    ).toBe("line1\nline2-replacement\nafter-context\nsecond-line\n")
  })

  test("applies a deletion-only update chunk", () => {
    expect(
      Patch.derive(
        "update.txt",
        [{ oldLines: ["line1", "line2", "line3"], newLines: ["line1", "line3"] }],
        "line1\nline2\nline3\n",
      ).content,
    ).toBe("line1\nline3\n")
  })

  test("updates empty files and adds a trailing newline", () => {
    expect(Patch.derive("empty.txt", [{ oldLines: [], newLines: ["First line"] }], "").content).toBe("First line\n")
    expect(Patch.derive("no-newline.txt", [{ oldLines: ["old"], newLines: ["new"] }], "old").content).toBe("new\n")
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
    expect(Patch.derive("leading.txt", [{ oldLines: ["line"], newLines: ["next"] }], "  line\n").content).toBe("next\n")
    expect(Patch.derive("trailing.txt", [{ oldLines: ["line"], newLines: ["next"] }], "line  \n").content).toBe(
      "next\n",
    )
    expect(
      Patch.derive("unicode.txt", [{ oldLines: ['He said "hello"'], newLines: ['He said "hi"'] }], "He said “hello”\n")
        .content,
    ).toBe('He said "hi"\n')
  })

  test("matches Unicode minus signs and spaces", () => {
    expect(
      Patch.derive("minus.txt", [{ oldLines: ["value - 1"], newLines: ["value - 2"] }], "value − 1\n").content,
    ).toBe("value - 2\n")
    const spaces = [
      "\u00A0",
      "\u2002",
      "\u2003",
      "\u2004",
      "\u2005",
      "\u2006",
      "\u2007",
      "\u2008",
      "\u2009",
      "\u200A",
      "\u202F",
      "\u205F",
      "\u3000",
    ]
    spaces.forEach((space) => {
      expect(
        Patch.derive("spaces.txt", [{ oldLines: ["hello world"], newLines: ["hello there"] }], `hello${space}world\n`)
          .content,
      ).toBe("hello there\n")
    })
  })

  test("does not normalize ellipses", () => {
    expect(() => Patch.derive("ellipsis.txt", [{ oldLines: ["wait..."], newLines: ["done"] }], "wait…\n")).toThrow(
      "Failed to find expected lines",
    )
  })

  test("prefers a later exact match over an earlier normalized match", () => {
    expect(
      Patch.derive(
        "quotes.txt",
        [{ oldLines: ['He said "hello"'], newLines: ['He said "goodbye"'] }],
        'He said “hello”\nmiddle\nHe said "hello"\n',
      ).content,
    ).toBe('He said “hello”\nmiddle\nHe said "goodbye"\n')
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

  test("does not fall back to a non-EOF match", () => {
    expect(() =>
      Patch.derive(
        "update.txt",
        [{ oldLines: ["marker", "end"], newLines: ["changed", "end"], endOfFile: true }],
        "marker\nend\nmiddle\n",
      ),
    ).toThrow("Failed to find expected lines")
  })

  test("identifies a missing blank line", () => {
    expect(() => Patch.derive("update.txt", [{ oldLines: [""], newLines: ["added"] }], "content\n")).toThrow(
      "Failed to find an expected blank line in update.txt",
    )
  })

  test("parses an update without an explicit first chunk header", () => {
    expect(parse("*** Begin Patch\n*** Update File: file.txt\n import foo\n+bar\n*** End Patch")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["import foo"], newLines: ["import foo", "bar"] }],
      },
    ])
  })

  test("keeps indented update markers as context lines", () => {
    expect(
      parse(
        "*** Begin Patch\n*** Update File: a.txt\n@@\n-old a\n+new a\n *** Update File: b.txt\n@@\n-old b\n+new b\n*** End Patch",
      ),
    ).toEqual([
      {
        type: "update",
        path: "a.txt",
        movePath: undefined,
        chunks: [
          {
            oldLines: ["old a", "*** Update File: b.txt"],
            newLines: ["new a", "*** Update File: b.txt"],
            changeContext: undefined,
          },
          { oldLines: ["old b"], newLines: ["new b"], changeContext: undefined },
        ],
      },
    ])
  })

  test("keeps indented move and EOF markers as context lines", () => {
    expect(
      parse(
        "*** Begin Patch\n*** Update File: file.txt\n@@\n before\n *** Move to: moved.txt\n *** End of File\n*** End Patch",
      ),
    ).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [
          {
            oldLines: ["before", "*** Move to: moved.txt", "*** End of File"],
            newLines: ["before", "*** Move to: moved.txt", "*** End of File"],
            changeContext: undefined,
          },
        ],
      },
    ])
  })

  test("preserves update context indentation", () => {
    expect(parse("*** Begin Patch\n*** Update File: file.txt\n@@   section\n-old\n+new\n*** End Patch")).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [{ oldLines: ["old"], newLines: ["new"], changeContext: "  section" }],
      },
    ])
  })

  test("preserves bare empty update lines as context", () => {
    expect(
      parse("*** Begin Patch\n*** Update File: file.txt\n@@\n context before\n\n context after\n*** End Patch"),
    ).toEqual([
      {
        type: "update",
        path: "file.txt",
        movePath: undefined,
        chunks: [
          {
            oldLines: ["context before", "", "context after"],
            newLines: ["context before", "", "context after"],
            changeContext: undefined,
          },
        ],
      },
    ])
  })

  test("rejects invalid add and delete lines", () => {
    expect(() => parse("*** Begin Patch\n*** Add File: file.txt\nbad\n*** End Patch")).toThrow(
      "Invalid hunk at line 3: Invalid Add File line for 'file.txt': expected a line starting with '+', got 'bad'",
    )
    expect(() => parse("*** Begin Patch\n*** Delete File: file.txt\nbad\n*** End Patch")).toThrow(
      "Invalid hunk at line 3: Unexpected line after Delete File 'file.txt': 'bad'. Delete hunks do not contain body lines",
    )
    expect(() =>
      parse("*** Begin Patch\n*** Delete File: file.txt\n*** Frobnicate File: next.txt\n*** End Patch"),
    ).toThrow("Invalid hunk at line 3: '*** Frobnicate File: next.txt' is not a valid hunk header")
  })

  test("rejects an empty update hunk", () => {
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n*** End Patch")).toThrow(
      "Invalid hunk at line 2: Update file hunk for path 'file.txt' is empty",
    )
    expect(() =>
      parse(
        "*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** Delete File: other.txt\n*** End Patch",
      ),
    ).toThrow("Invalid hunk at line 2: Update file hunk for path 'old.txt' is empty")
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n*** End of File\n*** End Patch")).toThrow(
      "Invalid hunk at line 2: Update file hunk for path 'file.txt' is empty",
    )
  })

  test("rejects an empty update chunk", () => {
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n@@\n*** End Patch")).toThrow(
      "Invalid hunk at line 4: Update hunk does not contain any lines",
    )
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n@@\n*** End of File\n*** End Patch")).toThrow(
      "Invalid hunk at line 4: Update hunk does not contain any lines",
    )
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n@@\n@@\n-old\n+new\n*** End Patch")).toThrow(
      "Invalid hunk at line 4: Unexpected line found in update hunk: '@@'",
    )
    expect(() =>
      parse(
        "*** Begin Patch\n*** Update File: file.txt\n@@\n*** Update File: other.txt\n@@\n-old\n+new\n*** End Patch",
      ),
    ).toThrow("Invalid hunk at line 4: Unexpected line found in update hunk: '*** Update File: other.txt'")
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n@@\nbad\n*** End Patch")).toThrow(
      "Invalid hunk at line 4: Unexpected line found in update hunk: 'bad'",
    )
  })

  test("rejects an invalid update line", () => {
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n@@\n-old\nbad\n*** End Patch")).toThrow(
      "Invalid hunk at line 5: Expected update hunk to start with a @@ context marker, got: 'bad'",
    )
    expect(() => parse("*** Begin Patch\n*** Update File: file.txt\n@@foo\n*** End Patch")).toThrow(
      "Invalid hunk at line 3: Unexpected line found in update hunk: '@@foo'",
    )
    expect(() =>
      parse("*** Begin Patch\n*** Update File: file.txt\n@@\n-old\n*** Frobnicate File: foo\n*** End Patch"),
    ).toThrow(
      "Invalid hunk at line 5: Expected update hunk to start with a @@ context marker, got: '*** Frobnicate File: foo'",
    )
  })

  test("rejects invalid and pathless hunk headers", () => {
    expect(() => parse("*** Begin Patch\n*** Frobnicate File: foo\n*** End Patch")).toThrow(
      "Invalid hunk at line 2: '*** Frobnicate File: foo' is not a valid hunk header",
    )
    expect(() => parse("*** Begin Patch\n*** Add File:\n*** End Patch")).toThrow(
      "Invalid hunk at line 2: '*** Add File:' is not a valid hunk header",
    )
    for (const header of ["*** Add File: ", "*** Delete File: ", "*** Update File: "]) {
      expect(() => parse(`*** Begin Patch\n${header}\n*** End Patch`)).toThrow(
        `Invalid hunk at line 2: '${header.trim()}' is not a valid hunk header`,
      )
    }
    expect(() =>
      parse("*** Begin Patch\n*** Update File: old.txt\n*** Move to: \n@@\n-old\n+new\n*** End Patch"),
    ).toThrow("Invalid hunk at line 3: Move destination for 'old.txt' must not be empty")
  })
})
