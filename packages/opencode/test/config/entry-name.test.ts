import { expect, test } from "bun:test"
import { configEntryNameFromPath } from "../../src/config/entry-name"

test("agent entry names ignore parent directories named agent", () => {
  expect(
    configEntryNameFromPath("/home/agent/.config/opencode/agents/build.md", [
      "/.opencode/agent/",
      "/.opencode/agents/",
      "/agent/",
      "/agents/",
    ]),
  ).toBe("build")
})
