import { expect, test } from "bun:test"
import { holds } from "./permissions"

// `request` answers `true` only for what the manifest already requires: this browser grants nothing optional.
test("an extension holds the permissions and origins its manifest requires, and nothing more", () => {
  const granted = { permissions: ["storage", "tabs"], hosts: ["https://*.example.com/*"] }

  expect(holds(granted, { permissions: ["storage"] })).toBe(true)
  expect(holds(granted, { permissions: ["storage", "contextMenus"] })).toBe(false)
  expect(holds(granted, { origins: ["https://app.example.com/*"] })).toBe(true)
  expect(holds(granted, { origins: ["https://example.com/*"] })).toBe(true)
  expect(holds(granted, { origins: ["<all_urls>"] })).toBe(false)
  expect(holds({ permissions: [], hosts: ["<all_urls>"] }, { origins: ["<all_urls>"] })).toBe(true)
})
