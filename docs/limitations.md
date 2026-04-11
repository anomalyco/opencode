# OpenCode Limitations

Architectural limitations discovered during plugin development and model integration.

---

## 1. No Per-Model Permission Control

**Description**: The `permission` field in `opencode.json` is global — it applies to ALL models equally. There is no way to restrict specific tools for specific models (e.g., allow bash for a trusted model but deny it for an experimental one).

**Impact**: Cannot implement tiered trust levels. An experimental or less-capable model has the same tool access as a flagship model.

**Workaround**: None. Users must manually switch models and be aware of tool permissions.

**Suggested**: Support per-model permission overrides:

```json
"permission": {
  "bash": "allow",
  "per_model": {
    "experimental-model": { "bash": "deny", "edit": "ask" }
  }
}
```

---

## 2. No Config-Level Caching

**Description**: OpenCode has no built-in response caching mechanism at the config level. The same prompt sent to the same model with the same context will always result in a new API call. The only caching is an in-memory singleton within the process (lost on restart).

**Impact**: Wasted API quota on repeated/redundant requests. For rate-limited APIs (e.g., 3000 requests/month), this is significant.

**Workaround**: Use an external proxy that supports response caching with configurable TTL.

**Suggested**: Add optional caching config:

```json
"cache": {
  "enabled": true,
  "ttl": 900,
  "backend": "memory"
}
```

---

## 3. No Fallback Model Mechanism

**Description**: If a model returns an error (429 rate limit, 500 server error, timeout), OpenCode does not automatically retry with an alternative model. The user must manually switch models.

**Impact**: Single point of failure. If the primary model is unavailable, the entire session stalls until manual intervention.

**Workaround**: Use an external proxy that supports fallback chains to transparently route to backup models on failure.

**Suggested**: Add fallback config:

```json
"model": "primary-model",
"fallbacks": ["fallback-model-1", "fallback-model-2"]
```

---

## 4. No Sandbox Mode

**Description**: OpenCode has no sandboxed execution environment. All bash commands run with the full permissions of the user's shell. The permission system is purely a UI prompt (`allow`/`deny`/`allow_session`) — not an isolation boundary.

**Impact**: Risky commands can be approved accidentally or via `allow_session` persistence. No rollback mechanism.

**Workaround**: The bash auto-policy bans dangerous commands (curl, wget, nc, etc.) and auto-approves safe ones (ls, git status). Everything else prompts the user.

**Suggested**: Add optional containerized execution for bash commands (e.g., Docker or Firecracker microVM).

---

## 5. No Per-Model Timeout Configuration

**Description**: OpenCode uses a single timeout for all models. Reasoning models (chain-of-thought) can take 5-10x longer than fast models, but there is no way to configure per-model timeouts in the config.

**Impact**: Fast models may be given excessive timeouts (wasting time on hung requests), while reasoning models may be killed prematurely.

**Workaround**: Configure timeouts at the proxy level to support per-model timeout settings.

**Suggested**: Add per-model timeout overrides:

```json
"models": {
  "reasoning-model": {
    "name": "...",
    "timeout": 600,
    "stream_timeout": 120
  }
}
```

---

## 6. Strict Permission Matching (No Wildcards)

**Description**: Permission matching uses strict equality on `(ToolName, Action, SessionID, Path)` tuples. There is no wildcard or pattern matching support. The `mymcp_*` syntax in the config does not actually function as a wildcard in the permission matching code.

**Impact**: Managing permissions for MCP tools with many sub-tools is tedious. Each tool must be listed individually.

**Workaround**: List each tool individually, or use `"ask"` as a blanket policy for unknown tools.

**Suggested**: Implement glob/wildcard matching for tool names, especially for MCP tools.
