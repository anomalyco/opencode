import type { Plugin } from "@opencode-ai/plugin";
declare const OhMyOpenCodePlugin: Plugin;
export default OhMyOpenCodePlugin;
export type { OhMyOpenCodeConfig, AgentName, AgentOverrideConfig, AgentOverrides, McpName, HookName, BuiltinCommandName, } from "./config";
export type { ConfigLoadError } from "./shared/config-errors";
