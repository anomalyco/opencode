import { expect, test } from "bun:test"
import { EOL } from "node:os"
import { format } from "../src/commands/handlers/plugin/list"

test("lists plugin IDs, installed versions, and sources without runtime sections", () => {
  expect(
    format(
      [
        { id: "opencode.agent", source: { type: "builtin" }, state: { status: "active" }, features: { server: true } },
        {
          id: "acme.dual",
          source: { type: "package", target: "acme-plugin@1.0.0", version: "1.0.0" },
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
        { target: "tui-only", version: "2.0.0" },
        { target: "/tmp/local.ts", version: "local" },
        { target: "acme-plugin@1.0.0", version: "1.0.0" },
        { target: "/tmp/local/tui.ts", version: "local" },
      ],
    )
      .split(EOL)
      .map((line) => line.split(/\s{2,}/)),
  ).toEqual([
    ["ID", "VERSION", "SOURCE"],
    ["-", "local", "/tmp/local.ts"],
    ["-", "-", "broken-plugin"],
    ["-", "2.0.0", "tui-only"],
    ["acme.dual", "1.0.0", "acme-plugin@1.0.0"],
    ["local.dual", "local", "/tmp/local/index.ts"],
  ])
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
    )
      .split(EOL)
      .map((line) => line.split(/\s{2,}/)),
  ).toEqual([
    ["ID", "VERSION", "SOURCE"],
    ["opencode.agent", "-", "builtin"],
  ])
})

test("shortens Git commits and leaves absent IDs unknown", () => {
  expect(
    format(
      [
        {
          source: { type: "package", target: "github:acme/plugin", version: "a".repeat(40) },
          state: { status: "active" },
          features: { server: true },
        },
      ],
      [],
    )
      .split(EOL)[1]
      .split(/\s{2,}/),
  ).toEqual(["-", "aaaaaaa", "github:acme/plugin"])
  expect(format([], [])).toBe("")
})
