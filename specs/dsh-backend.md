# DeepSeek Harness execution backend

## Investigation and implementation plan

Upstream: `https://github.com/anomalyco/opencode`, active `dev` revision `337fd144d2ba144743368f78d9579a99cce175bd` (GitHub reports non-archived and pushed 2026-09-06). DSH source: `/home/daz/dsh`; existing modifications there belong to the user.

OpenCode's CLI `packages/opencode/src/cli/cmd/run.ts` submits through the HTTP client. The TUI uses the same server session API. `src/server/routes/instance/httpapi/handlers/session.ts` delegates to `SessionPrompt.Service`; `src/session/prompt.ts` creates user messages and runs OpenCode's orchestration. Model providers sit below that loop and cannot replace execution. The newer `packages/core/src/session/execution.ts` routes V2 sessions, but the existing CLI session endpoint uses `SessionPrompt`. The adapter will branch at that application service before native prompt preprocessing or orchestration, preserving the HTTP API and message projection used by the CLI and TUI.

DSH offers SDK JSON-RPC (`packages/sdk/protocol/src/types.ts`) with durable session events including token deltas, but no cancel, permission reply, or persistent resume. Its ACP server (`packages/acp/acp/src/index.ts`, `session.ts`, `updates.ts`) provides session creation, persistent resume, ordered semantic output, tools, permission decisions, and cancellation. Use the existing ACP SDK already depended on by OpenCode, speaking the public protocol to an owned `dsh --profile acp` child. No DSH changes are planned. ACP emits committed message chunks during execution, not speculative provider token deltas; document this visible latency limitation explicitly.

Implementation:

1. Add optional configuration selecting native or DSH execution with an executable argument array, an explicit provider/model catalog, and bounded startup/shutdown settings. Native remains the default. DSH owns provider credentials, route validation, tools, system prompt, and orchestration.
2. Add an ACP process client with version/capability checks, bounded initialization, serialized updates, model configuration updates, explicit permission callbacks, session creation/resume, cancellation, and bounded teardown to confirmed process exit. Never log command arguments, child stderr, or remote error payloads that may contain credentials.
3. Add an instance-scoped execution service that records OpenCode user/assistant messages and maps ACP text/thought/tool updates to native parts, permission requests to the existing permission service, and completion/errors to existing session status/events. Persist the DSH session identity and selected route before sending a prompt. Apply model changes to the next turn without replay or automatic prompt retries after a failure.
4. Route selected prompts and cancellation through that service. Prevent unsupported workflows from silently invoking the native agent on DSH history. Preserve the existing UI and native execution path.
5. Add deterministic protocol-process and service tests covering config, model catalog and route switching, streaming order, identity, permission decisions, errors, cancellation, teardown, and native selection. Run package typechecking and the practical relevant regression subset.
6. Exercise the real DSH runtime through OpenCode with a prompt, follow-up, cancellation or shutdown, and process checks. Record credential/runtime blockers without claiming success. Document exact setup and commands.

Expected files: core V1 configuration schema; OpenCode session prompt service; new session DSH transport/execution modules; focused tests and fixtures; this plan and usage documentation. Public HTTP response schemas and UI layouts should need no changes.

First-version exclusions: attaching to arbitrary externally owned stdio processes, importing DSH-only transcripts, automatic resend after ambiguous failures, DSH private UI cards, token-level speculative output, OpenCode agent/system-prompt/tool customizations within DSH, and transcript operations DSH cannot represent (fork/revert/compaction). Such operations must be rejected or explicitly documented with safe behavior.

Verification must establish that updates are visible before prompt completion, follow-ups use one DSH identity, denied permissions remain denied, cancellation settles owned work, failures do not retry prompts, and disposal leaves no owned process alive. TUI/browser behavior is unverified until exercised against the real implementation.
