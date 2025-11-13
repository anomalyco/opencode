# PATCH /config Spec

Provides concrete steps clients can follow to update runtime configuration without restarting the server. This section focuses on `PATCH /config`, but also highlights the companion `GET /config` for verification.

## Purpose

- Enables project- or global-scoped config updates that persist to disk.
- Returns the merged runtime configuration so clients immediately know the active state.
- Triggers targeted invalidation and publishes `config.updated` events after the response so other components can react.

## Endpoint

- **URL:** `/config`
- **Method:** `PATCH`
- **Query parameters:**
  - `scope=project|global` (optional, defaults to `project`)

## Request body

Must satisfy the `Config.Info` schema (see `packages/opencode/src/config/config.ts`). Examples of supported keys:

```jsonc
{
  "username": "new-name",
  "agent": {
    "build": {
      "model": "anthropic/claude-3",
    },
  },
  "share": "manual",
}
```

- Partial updates are merged deep into the existing configuration; unspecified keys inherit their current values.
- JSONC comments are preserved when writing back to disk.
- The server normalizes defaults (e.g., ensures `agent`, `mode`, `plugin`, `keybinds` exist) before persisting.

## Behavior

1. **Target file selection**
   - `project` scope: the first existing file from `./.opencode/opencode.jsonc`, `./.opencode/opencode.json`, `./opencode.jsonc`, `./opencode.json`. If none exist, a new `./.opencode/opencode.jsonc` is created.
   - `global` scope: always `~/.config/opencode/opencode.jsonc`; directories are created as needed.
2. Acquire a file lock (30s timeout) and backup the current file before modifications.
3. Merge the request payload with the target file’s content, validate against the schema, normalize defaults, and persist while preserving comments.
4. On success, delete the backup; on failure, restore the backup and raise `ConfigUpdateError`.
5. When `OPENCODE_CONFIG_HOT_RELOAD=true`, invalidate the registered `config` state so the next `Config.get()` reflects the update and powers hot reloads without restarting the server. If the flag is unset/false, the cached config intentionally remains in memory and `GET /config` continues to return the pre-patch view until the process restarts.
6. When hot reload is enabled, publish `config.updated` events via `Bus.publish` and, for project scope, only for the current directory (global scope notifies every directory tracked by `Instance.forEach`). With the flag disabled, events are suppressed so legacy integrations see the old cache.

## Response

- **200 OK** – returns the merged runtime config after applying the patch.
- Clients can immediately call `GET /config` (no query params) to double-check, or rely on the response body for the canonical view.
  - Example response (truncated):
    ```jsonc
    {
      "username": "new-name",
      "agent": { ... },
      "share": "manual",
      ...
    }
    ```

## Error cases

- `400` – validation failures (body doesn’t match `Config.Info`, invalid plugin/agent entries, missing fields required by custom LSPs).
- Any other failure returns `500` with an error object that includes `data` and `errors` fields when triggered by `NamedError`.

## Client workflow (curl example)

```bash
SERVER=http://10.0.2.100:3366

# 1. inspect current config
curl "$SERVER/config" | jq .

# 2. update username and sharing mode
curl -X PATCH "$SERVER/config" \
  -H 'Content-Type: application/json' \
  -d '{"username":"config-hot-reload-test","share":"manual"}' \
  | jq .

# 3. verify changes persist
curl "$SERVER/config" | jq .
```

- With `OPENCODE_CONFIG_HOT_RELOAD=true`, no server restart is required because `Config.update` invalidates cached state and `Config.get()` reloads the merged data; when the flag is unset, plan for a restart before `GET /config` reflects the disk change.
- After the PATCH returns, subscribers (e.g., UI, CLI tooling) can listen for `config.updated` to refresh views or rerun initialization logic whenever hot reload is enabled.

## Notes for integrators

- If your integration maintains its own config cache, refresh it when you observe the `config.updated` event.
- Use `scope=global` when the update must affect every project directory; global updates are applied once and broadcast to all tracked directories.
- When calling from scripts, prefer `jq` or equivalent to diff the before/after payload, since the server returns the merged view.

### Feature flag: `OPENCODE_CONFIG_HOT_RELOAD`

- Default state: unset/false, which matches the legacy behavior where PATCH persists to disk but in-memory caches (and `GET /config`) are not refreshed until a restart.
- Hot reload path: set `OPENCODE_CONFIG_HOT_RELOAD=true` **before starting** the server or CLI to enable on-the-fly invalidations and `config.updated` bus events.
- Backward-compatibility check: with the flag unset, run the curl workflow above (`GET` → `PATCH` → `GET`) and confirm the final `GET` still returns the pre-patch configuration while the on-disk file has the new content.
- Regression test expectation: with the flag enabled, run `bun --cwd packages/opencode test config/hot-reload.test.ts` (or your integration-specific suite) to verify targeted invalidations and event fan-out continue to work.
