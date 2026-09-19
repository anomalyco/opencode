# Advisor smoke fixture

Manual end-to-end check for the native Anthropic advisor tool (`agent.<name>.advisor`). Copy `pool.ts` and `pool.test.ts` into a temporary project and run `bun test pool.test.ts` to establish the baseline (1 test passing).

The pool already bounds concurrency and preserves input order. The smoke test exercises consultation, file inspection, and a local check; it does not depend on the model inventing a repair.

## Deterministic backend (no API spend)

From `packages/opencode`:

```sh
bun test/fixture/advisor-server.ts --directory <absolute-project-path> --port 4197 --scenario pause
```

This boots the real server with isolated XDG/database state under `<project>/../advisor-state` and a test-only auth plugin that intercepts `https://api.anthropic.com/v1/messages` with scripted SSE responses. It writes an `opencode.json` for the project on first run (agent `build`, executor `anthropic/claude-sonnet-4-6`, advisor `claude-opus-4-6`, `maxUses: 1`).

Scenarios (`--scenario`):

| Scenario    | Behavior                                                                     |
| ----------- | ---------------------------------------------------------------------------- |
| `complete`  | one response: advisor call, plaintext result, local `read` tool call         |
| `pause`     | call with `pause_turn`; result and `read` arrive on the automatic resumption |
| `encrypted` | like `complete`, with an `advisor_redacted_result`                           |
| `error`     | like `complete`, with an `advisor_tool_result_error`                         |
| `cancel`    | streams the call, then holds the response open until the request is aborted |

Each request is appended to `advisor-state/requests.jsonl` as `{ phase, advertised, completed, pending, model, beta }`.

Connect any client that speaks the server API (the web app, the TUI, or an SDK client) to `http://127.0.0.1:4197` with the fixture directory, and prompt:

> Consult the advisor once, then read pool.ts and summarize.

Expected:

- `pause`: an Advisor tool part goes running → completed with "Use bounded concurrency.", a local read follows, the turn ends with "Fixture complete.". The request log shows `pause` → `resume` (`pending: true`, tool still advertised) → `finish` (`completed: true`).
- Restart the server and send a follow-up in the same session: the part and cost are rehydrated, the request carries the persisted `advisor_tool_result` (`completed: true`, `pending: false`), and cost grows by exactly one step.
- Set `"advisor": false` on the agent, restart, follow-up: `advertised: false`, `completed: true`, the `advisor-tool-2026-03-01` beta is still sent for history replay, and the new step has no advisor ledger.
- `encrypted` / `error`: the part shows `[Advisor consultation completed; advice is encrypted.]` or `[Advisor unavailable: <code>]` and the turn continues.
- `cancel`: stop the turn while the advisor is running. The part becomes `abandoned` with a terminal error and zero cost; after a restart with another scenario, the follow-up request has `pending: false` (the call is never resumed) and a fresh consultation happens.
- Fork the completed session and send a follow-up: earlier text and advice remain visible to the model.

## Live backend

Stop the deterministic server. Replace the generated `opencode.json` with an ordinary configuration (no fixture plugin, normal API-key authentication) and start the regular server against the same isolated state:

```json
{
  "agent": {
    "advisor-smoke": {
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-6",
      "steps": 8,
      "advisor": { "model": "claude-opus-4-6", "maxUses": 1 },
      "permission": { "advisor": "allow" }
    }
  }
}
```

Select the `advisor-smoke` agent and prompt:

> Consult the advisor once before deciding how this fixture should bound concurrent work. Read the fixture, explain the decision, and run `bun test pool.test.ts`.

Require a persisted provider-executed call (`srvtoolu_…` call ID) with an `advisor_result`, a completed local check, and a receiving step whose `usage.iterations` names the advisor model. The step cost must equal executor cost plus the advisor cost derived from those iterations, and the executor's context tokens must not include the advisor's tokens. Model narration claiming a consultation is not evidence; only the persisted `server_tool_use`/`advisor_tool_result` pair is.

Then restart the server and send a follow-up in the same session (native replay must be accepted and the prior total must not change), and finally set `advisor: false` for the agent, restart, and ask again (no advisor part, no request error).

Do not save API keys or personal session transcripts alongside this fixture.
