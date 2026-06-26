import { describe, expect, test } from "bun:test"
import {
  createFileSearchRequest,
  createHomeReference,
  createRootReference,
  fileSearchMentionPath,
  findReferenceAlias,
  findReferencePath,
  referenceMentionPath,
  withHomeReference,
  withRootReference,
} from "../../src/component/prompt/autocomplete-reference"

const references = [
  { name: "home", path: "/home/jescudero" },
  { name: "hidden", path: "/tmp/hidden", hidden: true },
]

describe("prompt reference autocomplete", () => {
  test("keeps non-home bare aliases as alias matches", () => {
    expect(findReferenceAlias("home", references)?.path).toBe("/home/jescudero")
    expect(findReferencePath("home", references)).toBeUndefined()
  })

  test("searches inside visible references after the alias slash", () => {
    expect(findReferencePath("home/projects", references)).toEqual({
      reference: references[0],
      query: "projects",
    })
  })

  test("does not autocomplete hidden references", () => {
    expect(findReferenceAlias("hidden", references)).toBeUndefined()
    expect(findReferencePath("hidden/file", references)).toBeUndefined()
  })

  test("preserves alias paths for inserted file mentions", () => {
    expect(referenceMentionPath("home", "docs/readme.md")).toBe("home/docs/readme.md")
    expect(referenceMentionPath("home", "docs\\readme.md")).toBe("home/docs/readme.md")
  })

  test("creates a visible home directory alias", () => {
    expect(createHomeReference("/home/jescudero")).toEqual({
      name: "~",
      path: "/home/jescudero",
      source: {
        type: "local",
        path: "/home/jescudero",
      },
    })
  })

  test("searches inside the home alias after a slash", () => {
    const referencesWithHome = withHomeReference(references, "/home/jescudero")

    expect(findReferenceAlias("~", referencesWithHome)?.path).toBe("/home/jescudero")
    expect(findReferencePath("~/projects", referencesWithHome)).toEqual({
      reference: referencesWithHome[0],
      query: "projects",
    })
  })

  test("searches from home for the bare home alias", () => {
    const referencesWithHome = withHomeReference(references, "/home/jescudero")

    expect(findReferencePath("~", referencesWithHome)).toEqual({
      reference: referencesWithHome[0],
      query: "",
    })
  })

  test("keeps home alias mentions rooted at tilde", () => {
    expect(referenceMentionPath("~", "docs/readme.md")).toBe("~/docs/readme.md")
    expect(referenceMentionPath("~", "docs\\readme.md")).toBe("~/docs/readme.md")
  })

  test("prefers the synthetic home alias over server references named tilde", () => {
    const referencesWithHome = withHomeReference(
      [
        { name: "~", path: "/tmp/not-home" },
        { name: "docs", path: "/docs" },
      ],
      "/home/jescudero",
    )

    expect(referencesWithHome).toEqual([createHomeReference("/home/jescudero"), { name: "docs", path: "/docs" }])
  })

  test("creates a hidden filesystem root reference", () => {
    expect(createRootReference("/")).toEqual({
      name: "",
      path: "/",
      hidden: true,
      source: {
        type: "local",
        path: "/",
      },
    })
  })

  test("searches from filesystem root for slash-prefixed queries", () => {
    const referencesWithRoot = withRootReference(withHomeReference(references, "/home/jescudero"), "/")

    expect(findReferenceAlias("/", referencesWithRoot)).toBeUndefined()
    expect(findReferencePath("/", referencesWithRoot)).toEqual({
      reference: referencesWithRoot[0],
      query: "",
    })
    expect(findReferencePath("/etc", referencesWithRoot)).toEqual({
      reference: referencesWithRoot[0],
      query: "etc",
    })
  })

  test("keeps filesystem root mentions rooted at slash", () => {
    expect(referenceMentionPath("", "etc/hosts")).toBe("/etc/hosts")
    expect(referenceMentionPath("", "/etc/hosts")).toBe("/etc/hosts")
    expect(referenceMentionPath("", "etc\\hosts")).toBe("/etc/hosts")
  })

  test("splits filesystem root paths into request directory and leaf query", () => {
    const referencesWithRoot = withRootReference(withHomeReference(references, "/home/jescudero"), "/")
    const directoryRequest = createFileSearchRequest("/home/", "/workspace", referencesWithRoot)
    const leafRequest = createFileSearchRequest("/home/je", "/workspace", referencesWithRoot)

    expect(directoryRequest).toEqual({
      reference: referencesWithRoot[0],
      directory: "/home",
      query: "",
      mentionDirectory: "home",
    })
    expect(leafRequest).toEqual({
      reference: referencesWithRoot[0],
      directory: "/home",
      query: "je",
      mentionDirectory: "home",
    })
    expect(fileSearchMentionPath(directoryRequest, "user/")).toBe("/home/user/")
  })

  test("splits home paths into request directory and keeps tilde mentions", () => {
    const referencesWithHome = withHomeReference(references, "/home/jescudero")
    const request = createFileSearchRequest("~/projects/", "/workspace", referencesWithHome)

    expect(request).toEqual({
      reference: referencesWithHome[0],
      directory: "/home/jescudero/projects",
      query: "",
      mentionDirectory: "projects",
    })
    expect(fileSearchMentionPath(request, "opencode/")).toBe("~/projects/opencode/")
  })

  test("splits project-relative paths into request directory and leaf query", () => {
    const directoryRequest = createFileSearchRequest("src/", "/workspace", references)
    const nestedDirectoryRequest = createFileSearchRequest("src/components/", "/workspace", references)
    const leafRequest = createFileSearchRequest("src/components", "/workspace", references)

    expect(directoryRequest).toEqual({
      reference: undefined,
      directory: "/workspace/src",
      query: "",
      mentionDirectory: "src",
    })
    expect(leafRequest).toEqual({
      reference: undefined,
      directory: "/workspace/src",
      query: "components",
      mentionDirectory: "src",
    })
    expect(fileSearchMentionPath(directoryRequest, "components/")).toBe("src/components/")
    expect(nestedDirectoryRequest).toEqual({
      reference: undefined,
      directory: "/workspace/src/components",
      query: "",
      mentionDirectory: "src/components",
    })
    expect(fileSearchMentionPath(nestedDirectoryRequest, "button.tsx")).toBe("src/components/button.tsx")
  })
})
