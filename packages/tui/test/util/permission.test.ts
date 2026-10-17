import { expect, test } from "bun:test"
import { collapsePermissionLines, permissionPresentation } from "../../src/util/permission"

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

test("collapsed permission lines keep what fits and count the hidden rows", () => {
  const short = ["$ ls -la"]
  expect(collapsePermissionLines(short, 80, 8)).toEqual({ lines: short, hidden: 0 })

  const command = ["$ set -euo pipefail\n" + Array.from({ length: 12 }, (_, n) => `step ${n}`).join("\n")]
  const collapsed = collapsePermissionLines(command, 80, 8)
  expect(collapsed.lines).toEqual(["$ set -euo pipefail", "step 0", "step 1", "step 2", "step 3", "step 4", "step 5"])
  expect(collapsed.hidden).toBe(6)

  // A long single line wraps at the given width before counting.
  const long = collapsePermissionLines(["x".repeat(250)], 50, 3)
  expect(long.lines).toEqual(["x".repeat(50), "x".repeat(50)])
  expect(long.hidden).toBe(3)
})
