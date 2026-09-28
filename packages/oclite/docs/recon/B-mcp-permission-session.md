# Recon B — MCP / permission / session / output / test infra

Cartographer report (Phase 0). Paths are relative to `packages/`. The opencode package exports
`"./*": "./src/*.ts"`, so imports look like `opencode/mcp/index`.

| module | import path | key exports | required services | blockers | verdict |
|---|---|---|---|---|---|
| MCP client | `opencode/mcp/index` | `MCP.Service`, `MCP.node`, `Interface` (index.ts:164-198) | ChildProcessSpawner, McpAuth, EventV2Bridge, McpBrowser (207-210), Config.Service (416), InstanceRef | EventV2Bridge → EventV2 → Database (sqlite); `@/` aliases; internal `layer` is not exported | path-import via `LayerNode.compile(MCP.node, [[Config.node, stub], [EventV2Bridge.node, stub]])` (core/src/effect/layer-node.ts:250); provide InstanceRef |
| MCP catalog | `opencode/mcp/catalog` | `toolName` = sanitize(server)+"_"+sanitize(tool) (117-119), `convertTool` (AI-SDK dynamicTool) | pure | imports `ai` | import, or copy the naming |
| MCP auth | `opencode/mcp/auth` | McpAuth.Service/node | FSUtil, EffectFlock | shares `Global.Path.data/mcp-auth.json` with opencode | import |
| OAuth | `opencode/mcp/oauth-provider`, `oauth-callback` | McpOAuthProvider, ensureRunning, waitForCallback | McpAuth; node net/http | – | import |
| MCP config | `@opencode-ai/core/v1/config/mcp` | `ConfigMCPV1.{Local,Remote,OAuth,Info}` | none | – | import |
| Permission (pure) | `opencode/permission/index` | `evaluate` (28-38), `fromConfig` (186), `merge`, `disabled`, `visibleTools` | none at call time | the module import loads InstanceState + EventV2Bridge | path-import, or copy the ~10-line evaluate |
| Permission service | same | Service.ask/reply/list | EventV2Bridge + InstanceRef | replies are `once/always/reject`; no timeout on ask | oclite's own small ask queue around `evaluate` |
| Wildcard | `@opencode-ai/core/util/wildcard` | `Wildcard.match` | none | – | import |
| Permission types | `@opencode-ai/core/v1/permission` | DeniedError, RejectedError, CorrectedError, Rule, Ruleset | none | – | import |
| Sub-agent permissions | `opencode/agent/subagent-permissions` | `deriveSubagentSessionPermission` | none | – | import |
| external_directory | `opencode/tool/external-directory` | `assertExternalDirectoryEffect` (15-43) | InstanceRef | – | path-import with InstanceRef |
| Overflow V1 | `opencode/session/overflow` | usable, isOverflow | pure | COMPACTION_BUFFER not exported; context-0 bug (29, 12) | copy the policy, fix the bug |
| Compaction V1 | `opencode/session/compaction` | – | heavy | – | don't import |
| Compaction V2 | `@opencode-ai/core/session/compaction` | `buildPrompt`, `serializeToolContent`, `make(...)` | plain deps on @opencode-ai/llm | tied to SessionMessage V2; skips context ≤0 (179, 227) | import buildPrompt/templates |
| Redaction | `opencode/cli/cmd/debug/redact`, http-recorder `redaction.ts` | redactConfig, redactHeaders | none | – | copy redactConfig into the shared helper |

## Ground-truth corrections
- MCP: StreamableHTTP→SSE fallback at index.ts:269-284; an auth error stops the fallback (330-331). The code default timeout is 30_000 ms (index.ts:38), although the docs say 5000. `tools()` returns raw `{def, client, timeout}` with no permission wrapping.
- Elicitation is commented out at index.ts:43-44. Sampling and tasks are off as well; only `roots` is advertised.
- run.ts: only `message.part.updated` is consumed (720). Tools print at completed/error (724-731), and the task tool also prints at running. Text prints at time.end (753), and reasoning at time.end && thinking (766), which defaults off (275). Step tokens appear only in json (749-751). The hidden `--mini` mode does consume deltas (run/session-data.ts:872).
- Core also has a V2 compaction module, with the same skip for unknown context.

## MCP SDK patch (client-side only)
The patch changes:
- session-expiry re-init
- StreamableHTTP 404 session recovery
- JSON-RPC errors on SSE treated as final
- `isRequestActive` passed to send
- listTools validator caching
- callTool overloads
- `determineScope` with offline_access

Server classes are available at 1.29.0: Server (elicitInput, sendLoggingMessage), McpServer, StdioServerTransport, StreamableHTTPServerTransport, WebStandardStreamableHTTPServerTransport, and SSE. Test templates: `opencode/test/fixture/mcp-lifecycle-stdio.ts` and `test/mcp/lifecycle.test.ts:59-63`.

## Test infra
- The http-recorder `HttpRecorder.http(name, {...})` returns a Layer<HttpClient>, which is in-process only. Replay happens when a cassette exists or CI is set.
- `llm-server.ts` (779 lines, effect + platform-node only) has a scripted queue for chat/completions. It's a clean copy target.
- `cli-process.ts` needs adapting. `effect.ts` and `fixture.ts`: copy only the generic helpers.
- `@modelcontextprotocol/server-everything` is not installed and not in bun.lock.
- yargs 18.0.0 is available. The linker is isolated, so oclite declares its own deps.
- JSONL precedent: `cli/cmd/run/trace.ts` only.

## Risks
- Bun may not resolve opencode's `@/*` paths when a different package imports it. Needs a smoke test.
- A Config.Service stub has to satisfy 8 methods.
- InstanceRef needs a minimal Project.Info.
- The shared mcp-auth.json store needs an ADR decision.
- The ask reply vocabulary needs a mapping layer.
- The import graph (ai, EventV2, GlobalBus) adds startup cost.
- Unknown-context compaction skip: oclite owns its own policy.
- New deps are subject to minimumReleaseAge.
