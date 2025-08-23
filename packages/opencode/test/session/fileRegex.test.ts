import { describe, expect, test, beforeAll, mock } from "bun:test"

describe("processFileReferences", () => {
  let result: any

  beforeAll(async () => {
    mock.module("os", () => ({ default: { homedir: () => "/home/fake-user" } }))
    const { processFileReferences } = await import("../../src/session/file-reference")
    const template = `This is a @valid/path/to/a/file and it should also match at
the beginning of a line:

@another-valid/path/to/a/file

but this is not:

   - Adds a "Co-authored-by:" footer which clarifies which AI agent
     helped create this commit, using an appropriate \`noreply@...\`
     or \`noreply@anthropic.com\` email address.

We also need to deal with files followed by @commas, ones
with @file-extensions.md, even @multiple.extensions.bak,
hidden directorys like @.config/ or files like @.bashrc
and ones at the end of a sentence like @foo.md.

Also shouldn't forget @/absolute/paths.txt with and @/without/extensions,
as well as @~/home-files and @~/paths/under/home.txt.

If the reference is \`@quoted/in/backticks\` then it shouldn't match at all.`
    result = processFileReferences(template, "/base")
  })

  test("should extract exactly 12 file references", () => {
    expect(result.length).toBe(12)
  })

  test("all files should have correct type and mime", () => {
    result.forEach((file: any) => {
      expect(file.type).toBe("file")
      expect(file.mime).toBe("text/plain")
    })
  })

  test("should extract valid/path/to/a/file", () => {
    expect(result[0].filename).toBe("valid/path/to/a/file")
    expect(result[0].url).toBe("file:///base/valid/path/to/a/file")
  })

  test("should extract another-valid/path/to/a/file", () => {
    expect(result[1].filename).toBe("another-valid/path/to/a/file")
    expect(result[1].url).toBe("file:///base/another-valid/path/to/a/file")
  })

  test("should extract paths ignoring comma after", () => {
    expect(result[2].filename).toBe("commas")
    expect(result[2].url).toBe("file:///base/commas")
  })

  test("should extract a path with a file extension and comma after", () => {
    expect(result[3].filename).toBe("file-extensions.md")
    expect(result[3].url).toBe("file:///base/file-extensions.md")
  })

  test("should extract a path with multiple dots and comma after", () => {
    expect(result[4].filename).toBe("multiple.extensions.bak")
    expect(result[4].url).toBe("file:///base/multiple.extensions.bak")
  })

  test("should extract hidden directory", () => {
    expect(result[5].filename).toBe(".config/")
    expect(result[5].url).toBe("file:///base/.config")
  })

  test("should extract hidden file", () => {
    expect(result[6].filename).toBe(".bashrc")
    expect(result[6].url).toBe("file:///base/.bashrc")
  })

  test("should extract a file ignoring period at end of sentence", () => {
    expect(result[7].filename).toBe("foo.md")
    expect(result[7].url).toBe("file:///base/foo.md")
  })

  test("should extract an absolute path with an extension", () => {
    expect(result[8].filename).toBe("/absolute/paths.txt")
    expect(result[8].url).toBe("file:///absolute/paths.txt")
  })

  test("should extract an absolute path without an extension", () => {
    expect(result[9].filename).toBe("/without/extensions")
    expect(result[9].url).toBe("file:///without/extensions")
  })

  test("should extract an absolute path in home directory", () => {
    expect(result[10].filename).toBe("~/home-files")
    expect(result[10].url).toBe("file:///home/fake-user/home-files")
  })

  test("should extract an absolute path under home directory", () => {
    expect(result[11].filename).toBe("~/paths/under/home.txt")
    expect(result[11].url).toBe("file:///home/fake-user/paths/under/home.txt")
  })
})
