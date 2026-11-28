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

test("shows the authorized shell resource instead of stale tool input", () => {
  expect(
    permissionPresentation({
      action: "shell",
      resources: ['git commit --trailer "X: rewritten" -m "test"'],
      input: { command: 'git commit -m "test"' },
    }),
  ).toMatchObject({
    title: "Shell command",
    lines: ['- git commit --trailer "X: rewritten" -m "test"'],
  })

  expect(permissionPresentation({ action: "shell", resources: [], input: { command: "echo test" } })).toMatchObject({
    title: "Shell command",
    lines: ["$ echo test"],
  })
})
