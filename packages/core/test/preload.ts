import { mock } from "bun:test"

process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"

// Keep the host's system-managed config and MDM profiles out of every test graph.
// Tests that exercise managed config pass explicit paths through Config.Options.
const { systemPaths, ...managed } = await import("../src/config/managed.ts")
const isolated = {
  ...managed,
  systemPaths: ((platform, username) =>
    platform === undefined && username === undefined ? {} : systemPaths(platform, username)) as typeof systemPaths,
}
void mock.module("../src/config/managed.ts", () => ({ ...isolated, ConfigManaged: isolated }))
