import { expect, test } from "bun:test"
import { permissionDetailsOverflow, permissionPresentation } from "../../src/util/permission"

test("approval height accounts for long words and whitespace", () => {
  expect(permissionDetailsOverflow(["short reason"], 44, 24, 11)).toBe(false)
  expect(permissionDetailsOverflow(["x".repeat(500)], 44, 24, 11)).toBe(true)
  expect(permissionDetailsOverflow([" ".repeat(600)], 44, 24, 11)).toBe(true)
  expect(permissionDetailsOverflow(["\t".repeat(80)], 44, 24, 11)).toBe(true)
})

test("sandbox escalation displays the reviewed command and one-invocation scope", () => {
  expect(
    permissionPresentation({
      action: "sandbox.exec",
      resources: ["npm install"],
      metadata: { command: "npm install", cwd: "/project", justification: "Download project dependencies." },
      input: { command: "unreviewed command" },
    }),
  ).toEqual({
    icon: "#",
    title: "Run command outside the sandbox",
    lines: ["$ npm install"],
    sandboxDetails: {
      directory: "/project",
      reason: "Download project dependencies.",
      scope: [
        "This command and its descendants will run with your account's filesystem and network access.",
        "Approval applies to this invocation only.",
      ],
    },
  })
})

test("workspace approval explains the effect on future commands and built-in file tools", () => {
  expect(
    permissionPresentation({
      action: "sandbox.workspace",
      resources: ["/new-project"],
      metadata: { directory: "/new-project", targetSessionID: "ses_target" },
    }),
  ).toMatchObject({
    title: "Change sandbox workspace",
    lines: [
      "Directory: /new-project",
      "Session: ses_target",
      "This changes the filesystem boundary for future commands and built-in file tools in that session.",
      "Changing it again requires another approval.",
    ],
  })
})

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
