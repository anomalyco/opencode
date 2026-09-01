import { expect, test } from "bun:test"
import { EOL } from "node:os"
import { format } from "../src/commands/handlers/plugin/list"

test("formats server and TUI plugins in sections without builtins", () => {
  expect(
    format(
      [
        { id: "opencode.agent", source: { type: "builtin" }, state: { status: "active" }, features: { server: true } },
        {
          id: "acme.dual",
          source: { type: "package", target: "acme-plugin@1.0.0" },
          state: { status: "active" },
          features: { server: true, tui: true },
        },
        {
          source: { type: "package", target: "broken-plugin" },
          state: { status: "failed", error: "broken" },
          features: { server: true },
        },
        {
          id: "local.dual",
          source: { type: "local", path: "/tmp/local/index.ts" },
          state: { status: "active" },
          features: { server: true, tui: true },
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
      "/tmp/local (advertised)",
      "/tmp/local.ts (discovered)",
      "acme-plugin@1.0.0 (advertised)",
      "tui-only (configured)",
      "",
      "Server",
      "acme.dual (active)",
      "broken-plugin (failed)",
      "local.dual (active)",
    ].join(EOL),
  )
})

test("includes builtins when requested", () => {
  expect(
    format(
      [
        {
          id: "opencode.agent",
          source: { type: "builtin" },
          state: { status: "active" },
          features: { server: true },
        },
      ],
      [],
      true,
    ),
  ).toBe(["Server", "opencode.agent (active)"].join(EOL))
})
