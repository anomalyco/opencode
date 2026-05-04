// Stable test fixture for test/agent/plugin-agent-regression.test.ts. Lives in
// the repo (not a tmpdir) so the test can skip the heavy InstanceBootstrap
// chain (FileWatcher / LSP / MCP / etc.) — that's the actual source of Windows
// teardown flakiness, not the plugin import path itself.
//
// Exports must all be functions; the plugin loader throws on any export that
// isn't (`getLegacyPlugins` in src/plugin/index.ts). Constants for the test
// live alongside this file in `agent-plugin.constants.ts`.
export default async () => ({
  config: async (cfg: { agent?: Record<string, unknown> }) => {
    cfg.agent = cfg.agent ?? {}
    cfg.agent["plugin_added"] = {
      description: "Added by a plugin via the config hook",
      mode: "subagent",
    }
  },
})
