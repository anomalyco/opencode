# Fork Capability Matrix

| Capability | Fork-owned implementation | Upstream patches | Upstream equivalent? | Status | Notes |
|------------|---------------------------|------------------|----------------------|--------|-------|
| Loop mode | packages/opencode/src/cli/cmd/loop.ts | - | No | Retain | CLI command for loop |
| Auto-reply | packages/opencode/src/auto-reply/auto-reply.ts, packages/opencode/src/cli/cmd/auto-reply.ts | - | No | Retain | Automation feature |
| Pattern detection | packages/opencode/src/pattern-detection/pattern-detection.ts, packages/opencode/src/cli/cmd/pattern-detection.ts | - | No | Retain | |
| Hooks | packages/opencode/src/cli/cmd/hook.ts | - | Partial | Retain | |
| Scheduler / Automation | packages/opencode/src/automation/automation-features.ts, packages/opencode/src/scheduler/scheduler.ts | - | Partial | Retain/Consolidate | May overlap |
| Local provider discovery | packages/opencode/src/local/mdns.ts | packages/opencode/src/provider/provider.ts marker mergeDiscoveredModel, packages/tui/src/component/dialog-provider.tsx marker LOCAL_PROVIDER_OPTION_VALUE | No | Retain | mDNS discovery + LAN scan |
| Llama-skein client | packages/opencode/src/local/llama-skein/ | - | No | Retain | Generated client from OpenAPI spec, regenerated via bun run build:llama-skein-client |
| Context window display & adjustments | packages/tui/src/component/dialog-model-ctx.tsx | packages/tui/src/feature-plugins/sidebar/context.tsx marker freeMb | No | Retain | Context sidebar enhancements, window display |
| Local provider UI | packages/tui/src/component/dialog-model-ctx.tsx | packages/tui/src/component/dialog-provider.tsx, packages/tui/src/config/keybind.ts dialog.local | No | Adapt | Keybind missing upstream |
| Themed loading | packages/core/src/local/theme-state.ts | packages/tui/src/context/theme.tsx marker ThemeState.set | No | Retain | Writer/reader pair |
| Context sidebar enhancements | - | packages/tui/src/feature-plugins/sidebar/context.tsx marker freeMb | No | Retain | |
| Fork commands registration | packages/opencode/src/fork/commands.ts | packages/opencode/src/index.ts marker ForkCommands | No | Retain | Single patch |
| Fork distribution/updater | packages/opencode/src/fork/distribution.ts | packages/opencode/src/installation/index.ts marker ForkDistribution | No | Retain | Prevents upstream overwrite |
| Local server routes | packages/opencode/src/server/routes/instance/httpapi/handlers/local.ts, packages/opencode/src/server/routes/instance/httpapi/groups/local.ts | - | No | Retain | /local/* routes |
| Skein loading UI | packages/opencode/src/local/skein-loading.ts | - | No | Retain | |
| Logging | packages/core/src/util/log.ts | - | No | Retain | |
