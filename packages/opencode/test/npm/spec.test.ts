import { describe, expect, test } from "bun:test"
import path from "path"
import { classify } from "../../src/npm/spec"

describe("classify", () => {
  describe("registry kind", () => {
    test("unscoped package with exact version", () => {
      expect(classify("prettier@3.2.5")).toEqual({
        kind: "registry",
        name: "prettier",
        version: "3.2.5",
      })
    })

    test("scoped package with exact version", () => {
      expect(classify("@opencode-ai/plugin@1.2.3")).toEqual({
        kind: "registry",
        name: "@opencode-ai/plugin",
        version: "1.2.3",
      })
    })

    test("bare name defaults to latest", () => {
      expect(classify("prettier")).toEqual({
        kind: "registry",
        name: "prettier",
        version: "latest",
      })
    })

    test("scoped package with dist-tag", () => {
      expect(classify("@opencode-ai/plugin@next")).toEqual({
        kind: "registry",
        name: "@opencode-ai/plugin",
        version: "next",
      })
    })

    test("semver range passes through as version", () => {
      expect(classify("react@^18.0.0")).toEqual({
        kind: "registry",
        name: "react",
        version: "^18.0.0",
      })
    })
  })

  describe("github kind", () => {
    test("github: shorthand without ref", () => {
      expect(classify("github:opencode-ai/plugin")).toEqual({
        kind: "github",
        owner: "opencode-ai",
        repo: "plugin",
        ref: undefined,
      })
    })

    test("github: shorthand with ref", () => {
      expect(classify("github:opencode-ai/plugin#v1.2.3")).toEqual({
        kind: "github",
        owner: "opencode-ai",
        repo: "plugin",
        ref: "v1.2.3",
      })
    })

    test("github: shorthand with ref and subdir syntax", () => {
      expect(classify("github:opencode-ai/monorepo#main::path:packages/foo")).toEqual({
        kind: "github",
        owner: "opencode-ai",
        repo: "monorepo",
        ref: "main::path:packages/foo",
      })
    })
  })

  describe("git kind", () => {
    test("git+https URL to github with ref", () => {
      const result = classify("git+https://github.com/opencode-ai/plugin.git#main")
      expect(result.kind).toBe("github")
    })

    test("git+https URL to non-github host", () => {
      expect(classify("git+https://gitlab.com/group/repo.git#main")).toEqual({
        kind: "git",
        url: "git+https://gitlab.com/group/repo.git#main",
      })
    })

    test("git+ssh URL to non-github host", () => {
      const result = classify("git+ssh://git@bitbucket.org/team/repo.git")
      expect(result.kind).toBe("git")
    })
  })

  describe("release kind", () => {
    test("release asset URL with .tgz", () => {
      expect(classify("https://github.com/opencode-ai/plugin/releases/download/v1.0.0/plugin.tgz")).toEqual({
        kind: "release",
        owner: "opencode-ai",
        repo: "plugin",
        tag: "v1.0.0",
        asset: "plugin.tgz",
      })
    })

    test("release asset URL with complex tag", () => {
      expect(classify("https://github.com/ownerX/repoY/releases/download/v1.2.3-beta.1/pack-1.2.3-beta.1.tgz")).toEqual(
        {
          kind: "release",
          owner: "ownerX",
          repo: "repoY",
          tag: "v1.2.3-beta.1",
          asset: "pack-1.2.3-beta.1.tgz",
        },
      )
    })

    test("release URL takes precedence over generic https URL", () => {
      const result = classify("https://github.com/opencode-ai/plugin/releases/download/v1.0.0/asset.tgz")
      expect(result.kind).toBe("release")
    })
  })

  describe("file kind", () => {
    test("absolute path", () => {
      expect(classify("/abs/plugin")).toEqual({
        kind: "file",
        path: "/abs/plugin",
      })
    })

    test("relative path is resolved against cwd", () => {
      const result = classify("./local/plugin")
      expect(result).toEqual({
        kind: "file",
        path: path.resolve(process.cwd(), "./local/plugin"),
      })
    })

    test("file: URL", () => {
      expect(classify("file:/abs/plugin")).toEqual({
        kind: "file",
        path: "/abs/plugin",
      })
    })

    test("tilde path expands home", () => {
      const result = classify("~/plugin")
      const home = process.env.HOME ?? ""
      expect(result).toEqual({
        kind: "file",
        path: path.resolve(process.cwd(), path.join(home, "plugin")),
      })
    })
  })
})
