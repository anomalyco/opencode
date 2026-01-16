import { describe, expect, test } from "bun:test"
import path from "path"
import { Debug } from "../../src/debug"

describe("Debug.configSystemBlock", () => {
  test("emits ingestUrl + log file paths with correct wrapping tags", () => {
    const worktreeRoot = path.join("/tmp", "opencode-worktree")
    const sessionID = "ses_debug_test_123"
    const requestUrl = "http://localhost:4096/session/" + sessionID + "/message"

    const block = Debug.configSystemBlock({ requestUrl, sessionID, worktreeRoot })

    expect(block).toContain("<debug_config>")
    expect(block).toContain("</debug_config>")
    expect(block).toContain(`ingestUrl: http://localhost:4096/ingest/${sessionID}`)
    expect(block).toContain("logFileRelative: .opencode/debug.log")
    expect(block).toContain(`logFileAbsolute: ${path.join(worktreeRoot, ".opencode", "debug.log")}`)
  })
})
