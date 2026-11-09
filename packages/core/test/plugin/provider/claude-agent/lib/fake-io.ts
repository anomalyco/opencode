export * as FakeIO from "./fake-io"

import type { ClaudeIO } from "@opencode/core/plugin/provider/claude-agent/claude/io"
import type { FakeClaude } from "./fake-claude"

export const EXECUTABLE = "/fake/bin/claude"

export function make(input: {
  readonly claude: FakeClaude.Fake
  readonly env?: Record<string, string | undefined>
}): ClaudeIO.Interface {
  return {
    spawn: input.claude.spawn,
    which: () => EXECUTABLE,
    env: () => input.env ?? {},
    sessionExists: async () => true,
    fork: input.claude.fork,
    remove: input.claude.remove,
  }
}
