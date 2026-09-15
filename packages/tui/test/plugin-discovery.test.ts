import { expect, test } from "bun:test"
import { mergePluginTargets } from "../src/plugin/discovery"

test("deduplicates equivalent local plugin targets while retaining the final source", () => {
  const directory = "/project"
  const discovered = { entry: "/project/.opencode/plugins/example", install: true, optional: true }
  const server = { entry: "./.opencode/plugins/example", install: false, optional: true }

  expect(mergePluginTargets([discovered, server], directory)).toEqual([server])
})

test("preserves the first target position when a later source overrides it", () => {
  const first = { entry: "example", install: true, optional: true }
  const other = { entry: "other", install: true, optional: true }
  const configured = { entry: { package: "example", options: { enabled: true } }, install: true, optional: false }

  expect(mergePluginTargets([first, other, configured], "/project")).toEqual([configured, other])
})
