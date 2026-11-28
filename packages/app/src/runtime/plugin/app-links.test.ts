import { expect, test } from "bun:test"
import { appLinkRoute } from "./app-links"

// A mail address is the system mail app's with or without a reviewer; only an attachment parameter keeps it out.
test.each([
  ["mailto:hello@example.invalid", true, "mail"],
  ["mailto:hello@example.invalid", false, "mail"],
  ["MAILTO:hello@example.invalid?subject=Hi&body=There", false, "mail"],
  ["mailto:hello@example.invalid?attach=C:/secrets.txt", true, "copy"],
  ["mailto:hello@example.invalid?Attachment=/etc/passwd", false, "copy"],
  ["tel:+15555550100", true, "review"],
  ["tel:+15555550100", false, "copy"],
  ["obsidian://open?vault=notes", true, "review"],
  ["vscode://file/repo/index.ts", false, "copy"],
] as const)("%s with a reviewer %s goes to %s", (href, reviewer, route) => {
  expect(appLinkRoute(href, reviewer)).toBe(route)
})
