import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import {
  decodeGitHubResponse,
  githubCaption,
  githubPreviewOf,
  githubRequestURL,
  linkTarget,
  readableTitle,
  replyLinks,
  type GitHubResponse,
  type GitHubState,
  type GitHubTarget,
} from "./links"

const github = (url: string) => {
  const target = linkTarget(url)

  if (target?.type !== "github") throw new Error(`not a GitHub link: ${url}`)

  return target
}

describe("replyLinks", () => {
  test("lists Markdown links and bare URLs in reading order, once each", () => {
    const text = [
      "See [the PR](https://github.com/acme/widget/pull/12) and https://docs.acme.dev/guides/retries.",
      "",
      "- <https://github.com/acme/widget>",
      "- [again](https://github.com/acme/widget/pull/12#discussion_r1)",
    ].join("\n")

    expect(replyLinks(text).map((link) => link.url)).toEqual([
      "https://github.com/acme/widget/pull/12",
      "https://docs.acme.dev/guides/retries",
      "https://github.com/acme/widget",
    ])
  })

  test("skips code spans, code blocks and images", () => {
    const text = [
      "`https://github.com/acme/widget/pull/1`",
      "",
      "```",
      "https://github.com/acme/widget/pull/2",
      "```",
      "",
      "![shot](https://cdn.acme.dev/shot.png)",
    ].join("\n")

    expect(replyLinks(text)).toEqual([])
  })

  test("keeps the first six", () => {
    const text = Array.from({ length: 8 }, (_, index) => `https://github.com/acme/widget/issues/${index + 1}`).join(
      "\n\n",
    )

    expect(replyLinks(text).map((link) => link.url.split("/").at(-1))).toEqual(["1", "2", "3", "4", "5", "6"])
  })
})

describe("linkTarget", () => {
  test.each([
    "http://localhost:3000/app",
    "https://192.168.1.4/admin",
    "https://[::1]/",
    "https://nas/files",
    "https://build.internal/run/4",
    "https://box.tail1234.ts.net/",
    "https://acme.dev:8443/admin",
    "https://user:pw@acme.dev/",
    "https://acme.dev/download?token=abc",
    "https://acme.dev/callback?code=abc",
    "https://bucket.s3.amazonaws.com/a?X-Amz-Signature=abc",
    "ftp://acme.dev/file",
    "mailto:team@acme.dev",
  ])("never previews %s", (url) => {
    expect(linkTarget(url)).toBeUndefined()
  })

  test("normalises away fragments, trailing slashes and tracking parameters", () => {
    expect(linkTarget("https://Docs.Acme.dev/guides/retries/?utm_source=x&fbclid=y&page=2#top")?.url).toBe(
      "https://docs.acme.dev/guides/retries?page=2",
    )
  })

  test("reads GitHub repositories, issues, pull requests and commits", () => {
    expect(github("https://github.com/acme/widget")).toMatchObject({ kind: "repository", repository: "acme/widget" })
    expect(github("https://github.com/acme/widget/issues/7")).toMatchObject({ kind: "issue", reference: "7" })
    expect(github("https://github.com/acme/widget/pull/1251")).toMatchObject({ kind: "pull", reference: "1251" })
    expect(github("https://github.com/acme/widget/commit/a1b2c3d4e5")).toMatchObject({
      kind: "commit",
      reference: "a1b2c3d4e5",
    })
  })

  test.each([
    "https://github.com/acme/widget/pull/12/files",
    "https://github.com/acme/widget/issues/0",
    "https://github.com/acme/widget/commit/xyz1234",
    "https://github.com/settings/profile",
    "https://github.com/acme",
    "https://gist.github.com/acme/abc123",
  ])("lists %s as a plain page", (url) => {
    expect(linkTarget(url)?.type).toBe("web")
  })

  test("names a page from its host and readable path", () => {
    expect(linkTarget("https://www.acme.dev/guides/background-transfers")).toEqual({
      type: "web",
      url: "https://www.acme.dev/guides/background-transfers",
      host: "acme.dev",
      title: "Background transfers",
    })
  })
})

describe("readableTitle", () => {
  test.each([
    ["https://acme.dev/guides/background_transfers.html", "Background transfers"],
    ["https://acme.dev/incidents/42", "Incidents 42"],
    ["https://acme.dev/docs/setup/index.html", "Setup"],
    ["https://acme.dev/a/7f3a9c21e4", undefined],
    ["https://acme.dev/", undefined],
    ["https://acme.dev/x/ab", undefined],
  ])("%s reads %p", (url, title) => {
    expect(readableTitle(new URL(url))).toBe(title)
  })
})

describe("GitHub", () => {
  test("requests the REST endpoint for each kind", () => {
    expect(githubRequestURL(github("https://github.com/acme/widget"))).toBe("https://api.github.com/repos/acme/widget")
    expect(githubRequestURL(github("https://github.com/acme/widget/pull/3"))).toBe(
      "https://api.github.com/repos/acme/widget/pulls/3",
    )
    expect(githubRequestURL(github("https://github.com/acme/widget/issues/3"))).toBe(
      "https://api.github.com/repos/acme/widget/issues/3",
    )
    expect(githubRequestURL(github("https://github.com/acme/widget/commit/a1b2c3d"))).toBe(
      "https://api.github.com/repos/acme/widget/commits/a1b2c3d?per_page=1",
    )
  })

  test("captions what the URL alone says", () => {
    expect(githubCaption(github("https://github.com/acme/widget"))).toBe("acme/widget")
    expect(githubCaption(github("https://github.com/acme/widget/pull/1251"))).toBe("acme/widget #1251")
    expect(githubCaption(github("https://github.com/acme/widget/commit/a1b2c3d4e5f6"))).toBe("acme/widget · a1b2c3d")
  })

  const pull = github("https://github.com/acme/widget/pull/1251")
  const issue = github("https://github.com/acme/widget/issues/7")

  test.each([
    [pull, { title: "Add jitter", state: "open", draft: false, merged: false }, "open"],
    [pull, { title: "Add jitter", state: "open", draft: true, merged: false }, "draft"],
    [pull, { title: "Add jitter", state: "closed", draft: false, merged: true }, "merged"],
    [pull, { title: "Add jitter", state: "closed", draft: false, merged: false }, "closed"],
    [issue, { title: "Uploads retry forever", state: "open", state_reason: null }, "open"],
    [issue, { title: "Uploads retry forever", state: "closed", state_reason: "completed" }, "completed"],
    [issue, { title: "Uploads retry forever", state: "closed", state_reason: "not_planned" }, "notPlanned"],
  ] satisfies [GitHubTarget, GitHubResponse, GitHubState][])("reads %#: state %p", (link, response, state) => {
    expect(githubPreviewOf(link, response)?.state).toBe(state)
  })

  test("reads a repository's stars and language, and a commit's subject and diff", () => {
    expect(
      githubPreviewOf(github("https://github.com/acme/widget"), {
        full_name: "acme/widget",
        stargazers_count: 4200,
        language: "Swift",
      }),
    ).toEqual({ title: "acme/widget", stars: 4200, language: "Swift" })

    expect(
      githubPreviewOf(github("https://github.com/acme/widget/commit/a1b2c3d"), {
        commit: { message: "Retry with full jitter\n\nLonger body." },
        stats: { additions: 41, deletions: 9 },
      }),
    ).toEqual({ title: "Retry with full jitter", additions: 41, deletions: 9 })
  })

  test("decodes a full response body, and has no preview without a title", () => {
    const body = JSON.parse('{"title":"Add jitter","state":"open","draft":false,"user":{"login":"kai"},"body":null}')

    expect(Option.map(decodeGitHubResponse(body), (value) => githubPreviewOf(pull, value)?.state)).toEqual(
      Option.some("open"),
    )
    expect(Option.isNone(decodeGitHubResponse("Not Found"))).toBe(true)
    expect(githubPreviewOf(pull, {})).toBeUndefined()
  })
})
