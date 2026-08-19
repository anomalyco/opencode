import { expect, test } from "bun:test"
import { EOL } from "node:os"
import { format } from "../src/commands/handlers/plugin/list"

test("formats server and TUI plugins in sections without builtins", () => {
  expect(
    format(
      [
        { id: "opencode.agent", source: { type: "builtin" }, status: "active", tui: false },
        {
          id: "acme.dual",
          source: { type: "package", package: "acme-plugin@1.0.0" },
          status: "active",
          tui: true,
        },
        {
          source: { type: "package", package: "broken-plugin" },
          status: "failed",
          error: "broken",
          tui: false,
        },
      ],
      [
        { target: "tui-only", source: "configured" },
        { target: "/tmp/local.ts", source: "discovered" },
      ],
    ),
  ).toBe(
    [
      "TUI",
      "/tmp/local.ts (discovered)",
      "acme-plugin@1.0.0 (advertised)",
      "tui-only (configured)",
      "",
      "Server",
      "acme.dual (active)",
      "broken-plugin (failed)",
    ].join(EOL),
  )
})

test("includes builtins when requested", () => {
  expect(
    format([{ id: "opencode.agent", source: { type: "builtin" }, status: "active", tui: false }], [], true),
  ).toBe(["Server", "opencode.agent (active)"].join(EOL))
})
