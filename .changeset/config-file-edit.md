---
"@opencode-ai/core": major
---

Replace `Config.Service.update(mutate)` with `ConfigFile.update(path, mutate)` from
`@opencode-ai/core/config/file`. Callers now choose an existing JSON or JSONC file
explicitly, and each edit reads the current file without configuration discovery or
watchers. Catch `ConfigFile.UpdateError` instead of `Config.UpdateError`.

The callback and returned value are raw JSON objects, not normalized `Config.Info`.
The synchronous callback mutates an owned source clone; its return value is ignored.
Edit source keys directly, including legacy keys, and use `delete` to remove them.
Substitution expressions and unrelated fields remain unchanged. The editor validates
JSON syntax and values; configuration normalization and substitution remain the
reader's responsibility. Changed object fields and array elements are patched into
the original text to preserve untouched comments, and no-op edits do not rewrite it.

Configuration discovery, precedence, watching, the HTTP API, and CLI preferences
are unchanged.
