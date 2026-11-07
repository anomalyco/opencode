import { expect, test } from "bun:test"
import { permissionPresentation } from "../../src/util/permission"

test("preserves permission roots and self-contained metadata", () => {
  expect(permissionPresentation({ action: "external_directory", resources: ["/*"] }).title).toBe(
    "Access external directory /",
  )
  expect(permissionPresentation({ action: "external_directory", resources: ["C:/*"] }).title).toBe(
    "Access external directory C:/",
  )
  expect(
    permissionPresentation({ action: "webfetch", resources: [], metadata: { url: "https://example.com" } }),
  ).toMatchObject({
    title: "WebFetch https://example.com",
    lines: ["URL: https://example.com"],
  })
  expect(permissionPresentation({ action: "websearch", resources: [], metadata: { query: "releases" } })).toMatchObject(
    {
      title: 'Web Search "releases"',
      lines: ["Query: releases"],
    },
  )
})

const info = (file: string, patch: string) => ({ file, patch, additions: 1, deletions: 1, status: "modified" })

test("edit permission exposes every file in a multi-file patch", () => {
  const result = permissionPresentation({
    action: "edit",
    resources: ["src/alpha.ts", "src/beta.ts", "src/gamma.ts"],
    metadata: {
      files: [info("src/alpha.ts", "alpha-diff"), info("src/beta.ts", "beta-diff"), info("src/gamma.ts", "gamma-diff")],
    },
  })
  expect(result.files).toEqual([
    { file: "src/alpha.ts", diff: "alpha-diff" },
    { file: "src/beta.ts", diff: "beta-diff" },
    { file: "src/gamma.ts", diff: "gamma-diff" },
  ])
  expect(result.title).toBe("Edit 3 files")
})

test("edit permission labels files by their own path when resources include a move source", () => {
  // A move lists both the source and the destination in resources, so resources outnumber files.
  const result = permissionPresentation({
    action: "edit",
    resources: ["src/old.ts", "src/new.ts", "src/other.ts"],
    metadata: { files: [info("src/new.ts", "moved-diff"), info("src/other.ts", "other-diff")] },
  })
  expect(result.files).toEqual([
    { file: "src/new.ts", diff: "moved-diff" },
    { file: "src/other.ts", diff: "other-diff" },
  ])
})

test("edit permission shows the combined diff when a file entry has no patch", () => {
  const result = permissionPresentation({
    action: "edit",
    resources: ["a.ts", "b.ts"],
    metadata: { diff: "combined-diff", files: [info("a.ts", "a-diff"), info("b.ts", "")] },
  })
  expect(result.title).toBe("Edit 2 files")
  expect(result.files).toBeUndefined()
  expect(result.diff).toBe("combined-diff")
})

test("edit permission still reads the legacy filePath label", () => {
  const result = permissionPresentation({
    action: "edit",
    resources: [],
    metadata: {
      files: [
        { filePath: "a.ts", patch: "a-diff" },
        { filePath: "b.ts", patch: "b-diff" },
      ],
    },
  })
  expect(result.files?.map((item) => item.file)).toEqual(["a.ts", "b.ts"])
})
