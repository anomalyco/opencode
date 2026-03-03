Title: Allow third-party chat session content providers to appear in Agent Session Providers list

Description:
VS Code's Agent Session Providers UI (session target picker / agent sessions) only recognizes a fixed set of provider IDs (AgentSessionProviders enum: 'local', 'copilotcli', 'copilot-cloud-agent', 'claude-code', 'openai-codex', 'copilot-growth', ...). Third-party extensions that register chat session content providers with custom session types (e.g. 'sst-dev.opencode') cannot surface in the Agent Session Providers list because getAgentSessionProvider(...) only returns one of the built-in values.

Reproduction:
1. Create an extension that registers a Chat Participant and a Chat Session Content Provider with a custom type (e.g. 'sst-dev.opencode').
2. Open the Chat view and look at the session target picker / agent sessions UI.
3. The custom provider does not appear in the Agent Session Providers list; the picker only shows built-in providers.

Expected behavior:
Third-party chat session content providers should be able to be listed in the Agent Session Providers UI (session target picker) with a display name and icon, or VS Code should provide an alternative API to opt-in to appear in that list.

Suggested API enhancements:
- Allow extensions to register a provider ID and display metadata (name, icon, description) that can be included in the Agent Session Providers list.
- Or expose an API to let session content providers supply a 'providerKind' mapping to existing AgentSessionProviders so they can show under an allowed target.
- Provide a registration method such as `vscode.chat.registerAgentSessionProvider(providerId, { displayName, icon, description })` or extend `registerChatSessionContentProvider` to accept display metadata.

Notes:
- Workaround: extensions can use built-in provider types (e.g. use type 'local' or 'copilotcli') so the provider appears in the picker, but this conflates third-party providers with first-party IDs and is not ideal for discoverability or telemetry.

References:
- agentSessions.ts: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/agentSessions/agentSessions.ts
- sessionTargetPicker.ts: https://github.com/microsoft/vscode/blob/main/src/vs/sessions/contrib/chat/browser/sessionTargetPicker.ts
