import { describe, expect, test } from "bun:test"
import { posix } from "path"
import { configEntryNameFromPath } from "@/config/entry-name"

// Use POSIX semantics so the test is deterministic regardless of host OS —
// production code passes paths through `path.relative` on the runtime
// platform, but the helper normalizes via `replaceAll("\\", "/")`, so the
// regression assertion ("the helper returns the bare name") holds on either
// platform as long as we feed it a relative path. Using `posix.relative`
// keeps the intermediate values stable across CI runners.

// The prefixes shipped by config/agent.ts after the relative-path refactor.
const AGENT_PREFIXES = ["agent/", "agents/"]

describe("configEntryNameFromPath", () => {
  test("strips an `agents/` prefix and returns the bare name", () => {
    expect(configEntryNameFromPath("agents/build.md", AGENT_PREFIXES)).toBe("build")
  })

  test("strips an `agent/` (singular) prefix", () => {
    expect(configEntryNameFromPath("agent/build.md", AGENT_PREFIXES)).toBe("build")
  })

  test("preserves nested subdirectories in the key", () => {
    expect(configEntryNameFromPath("agents/team/build.md", AGENT_PREFIXES)).toBe("team/build")
  })

  test("normalizes Windows-style backslashes", () => {
    expect(configEntryNameFromPath("agents\\team\\build.md", AGENT_PREFIXES)).toBe("team/build")
  })

  test("falls back to basename when no prefix matches", () => {
    expect(configEntryNameFromPath("orphaned.md", AGENT_PREFIXES)).toBe("orphaned")
    expect(configEntryNameFromPath("anywhere/orphaned.md", [])).toBe("orphaned")
  })

  // Regression for #25713: a username (or any parent segment) containing
  // `agent` or `agents` used to win the substring match before the real
  // `agents/` directory could match, leaking the entire intervening path into
  // the agent key (e.g. `.config/opencode/agents/build`). Anchoring at the
  // caller via `path.relative(dir, item)` makes this impossible — the relative
  // path is always rooted at `agent/` or `agents/`.
  test("regression #25713: caller passes relative path; parent /agent/ segment is irrelevant", () => {
    const dir = "/home/agent/.config/opencode"
    const item = "/home/agent/.config/opencode/agents/build.md"
    const relative = posix.relative(dir, item)
    expect(relative).toBe("agents/build.md")
    expect(configEntryNameFromPath(relative, AGENT_PREFIXES)).toBe("build")
  })

  test("regression #25713: parent /agents/ segment is irrelevant", () => {
    const dir = "/srv/agents/team/.config/opencode"
    const item = "/srv/agents/team/.config/opencode/agents/build.md"
    const relative = posix.relative(dir, item)
    expect(configEntryNameFromPath(relative, AGENT_PREFIXES)).toBe("build")
  })
})
