# DeepSeek Harness backend

This integration uses DeepSeek Harness (DSH) to execute agent sessions. OpenCode remains the CLI, terminal UI, HTTP API, and transcript viewer. DSH owns model requests, tool execution, permissions requiring runtime approval, persistence, and compaction. Selecting a DeepSeek model in OpenCode's normal provider menu does not enable this backend.

## Setup

Install this OpenCode checkout's dependencies with Bun 1.3.14 (`bun install --frozen-lockfile`). Install or prepare a DSH runtime supporting ACP v1, `session/resume`, and `session/close`. Configure its provider credentials and desired model using DSH's existing profile, environment, credential store, or patches. The adapter inherits the environment and does not copy OpenCode provider credentials to DSH.

Add this to your project's `opencode.json`:

```json
{
  "backend": {
    "type": "dsh",
    "command": ["dsh", "--profile", "acp"],
    "models": [
      { "key": "deepseek-official/deepseek-v4-flash", "name": "DeepSeek V4 Flash" },
      { "key": "deepseek-official/deepseek-v4-pro", "name": "DeepSeek V4 Pro" }
    ],
    "default_model": "deepseek-official/deepseek-v4-flash",
    "startup_timeout": 30000,
    "shutdown_timeout": 5000
  }
}
```

`command` is an executable followed by arguments, without shell expansion. Timeouts are positive milliseconds. Use an absolute executable path if it is not on `PATH`. Pass DSH profile patches as additional command arguments. Keep secrets in DSH's credential mechanisms rather than command arguments or OpenCode configuration. OpenCode serves its configuration to authenticated clients.

`models` is the explicit model catalog shown by OpenCode's existing model selector. Each `key` is a DSH `provider/model` route, and `default_model` must name one of the entries. OpenCode applies a changed route to the next prompt through ACP's `session/set_config_option`; DSH remains the authority that validates credentials and the route. Omitting `models` preserves the single `DSH profile` compatibility entry.

For the source checkout at `/home/daz/dsh`, this Linux launch command selects its source resolution configuration explicitly, even when the agent workspace is elsewhere:

```json
{
  "backend": {
    "type": "dsh",
    "command": [
      "env", "TSX_TSCONFIG_PATH=/home/daz/dsh/tsconfig.json",
      "node", "--import", "/home/daz/dsh/node_modules/tsx/dist/esm/index.mjs",
      "/home/daz/dsh/apps/cli/src/bin.ts", "--profile", "acp"
    ]
  }
}
```

From this OpenCode repository:

```sh
bun run --cwd packages/opencode src/index.ts /absolute/path/to/project
bun run --cwd packages/opencode src/index.ts run --dir /absolute/path/to/project "Describe this project"
bun run --cwd packages/opencode src/index.ts run --dir /absolute/path/to/project --session ses_YOUR_ID "Continue"
```

The terminal UI displays the configured default as **Build · _model_ · DeepSeek Harness** and lists the configured routes in its normal model selector. When `models` is omitted, it displays the compatibility entry **DSH profile**; no OpenCode model adapter is registered. Use the build agent. Choose the actual provider, model, reasoning effort, and execution policy in DSH. Remove `backend`, or select `{"type":"native"}`, for native OpenCode execution in new/native sessions. An existing DSH session refuses native continuation.

## Sessions and interaction

Each prompt owns a fresh ACP subprocess, started in the OpenCode workspace. OpenCode records the returned DSH session ID and selected model route in session metadata before sending the prompt. Follow-ups resume that persisted DSH session in a new subprocess. Process startup therefore adds latency per turn. No shared or externally managed DSH server is stopped or reconfigured.

ACP updates are delivered while the prompt runs and translated into ordinary OpenCode text, reasoning, and generic tool parts. DSH's ACP interface emits committed message blocks, not speculative provider token deltas. A single-message reply can first appear when that message is committed; multi-step work displays intermediate messages and tools before the overall prompt completes. Resume does not replay old updates, and the adapter never automatically resends a failed prompt. OpenCode retains its own transcript for display.

The model selector changes the route for the next turn only. Changing the selector while a prompt is active does not mutate the in-flight DSH turn. A route rejected by DSH fails before prompt submission and is not retried.

DSH runs all agent tools. ACP permission requests appear through OpenCode's normal permission UI and resolve to DSH's one-shot allow/reject choices. The adapter does not silently approve requests. OpenCode's noninteractive `run` command rejects prompts for permission using its existing behavior. DSH's own configured policy determines which operations require an approval request at all; OpenCode's native tool policy is not substituted for it.

The normal double-Escape shortcut cancels active execution. On cancellation and prompt completion, the adapter closes the DSH session, lets persistence flush, closes stdin, and escalates termination if necessary. Instance disposal uses the same cleanup path. A failed prompt is recorded as an assistant error; ambiguous failures are not retried. A later explicit prompt resumes persisted state and may observe work already performed before the failure.

## Limits

- Text and local file references are accepted. Images, agent/subtask attachments, structured output, prompt-level tool overrides, custom system prompts, and `noReply` are rejected.
- OpenCode's alternate agents, reasoning variants, shell mode, and custom commands do not configure DSH and are rejected. Model overrides are limited to the configured `backend.models` catalog; DSH remains the configuration authority for credentials and route validity.
- Fork, revert, manual OpenCode compaction, and message editing/deletion are rejected because DSH cannot apply the same transcript operation. Removing an OpenCode session does not delete the persisted DSH session.
- This does not import sessions created outside this adapter or attach to an externally owned stdio stream. Concurrent prompts in one OpenCode session are rejected; separate sessions can run independently.
- Tool display is generic. DSH-specific cards, plans, terminal widgets, elicitation, and subagent UI trees are not projected. ACP pricing and exact model limits are not available here; displayed zero usage/cost fields are not billing measurements.
- The implementation's verification commands and remaining platform limits are reported with the change; the supported setup and smoke-test commands are listed above.

## Troubleshooting

For startup failures, verify the executable exists and run the configured command directly in the project directory. ACP stdout must contain only JSON-RPC; avoid launchers that print package-manager banners. The adapter excludes child stderr and remote error payloads from public diagnostics because they can contain credentials. Inspect DSH directly for detailed startup/provider errors without posting secrets.

A `FiberState` missing-export error when launching a DSH source checkout from another directory indicates source/built resolution mismatch. Use the explicit `TSX_TSCONFIG_PATH` command above, or a correctly built installed DSH executable.

For resume failures, verify that the same DSH persistence configuration and workspace are in use. Do not delete or replace the stored session ID to force continuation: that would discard model context. Start a new OpenCode session when the original DSH session is unavailable.

If an Orca overlay overrides your project configuration, inspect `OPENCODE_CONFIG_DIR`. For an isolated diagnostic run, use `env -u OPENCODE_CONFIG_DIR` on Linux/macOS. This is not required for normal installations.

Architecture and source references: [implementation plan](specs/dsh-backend.md).
