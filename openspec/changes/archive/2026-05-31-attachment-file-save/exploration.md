## Exploration: Attachment File Save

### Current State

When a user drops/attaches an image (or PDF) in OpenCode, the flow is:

1. **Frontend** (`packages/app/src/components/prompt-input/attachments.ts`): Reads the file as a base64 data URL (`data:image/png;base64,...`), creates an `ImageAttachmentPart` stored in the prompt context.

2. **Submission** (`packages/app/src/components/prompt-input/submit.ts`): On submit, images are extracted from the prompt and mapped to `{type: "file", url: attachment.dataUrl, mime, filename}` — the raw base64 data URL is sent to the server via the HTTP API.

3. **Server reception** (`packages/opencode/src/session/prompt.ts`, `createUserMessage` at ~line 795): The file parts arrive with protocol `data:` and are stored directly into the SQLite database as session message parts. The `url` field contains the full base64 data URL. The data is never written to disk.

4. **Model message conversion** (`packages/opencode/src/session/message-v2.ts`, `toModelMessagesEffect` at line 143): When preparing messages for the LLM, `file` parts with non-text mime types are included as `{type: "file", url: part.url, mediaType: part.mime}`.

5. **Provider content filtering** (`packages/opencode/src/provider/transform.ts`, `unsupportedParts` at line 396): Before sending to the LLM, `unsupportedParts()` checks each file against the model's capabilities (`model.capabilities.input.image`). If the model does NOT support the modality (e.g., `deepseek-v4-pro` has no `image` capability), the file part is replaced with an error text: `"ERROR: Cannot read \"filename\" (this model does not support image input). Inform the user."`. The original base64 data is **lost** at this point — it was only in the message URL field and was never written to disk.

### The Problem

There is **no filesystem-level save** of attached files anywhere in the pipeline. The data URL is ephemeral — it lives in the prompt state (frontend) and the message parts (database), but is never materialized to disk. Once `unsupportedParts()` filters it, the file content is gone for any fallback tool (OCR, tesseract, etc.).

### Affected Areas

- `packages/app/src/components/prompt-input/attachments.ts` — Entry point: file drops/pastes read as data URLs
- `packages/app/src/components/prompt-input/submit.ts` — Submission: images mapped to `{type:"file", url: dataUrl}`
- `packages/app/src/components/prompt-input/build-request-parts.ts` — Image parts constructed for API
- `packages/opencode/src/session/prompt.ts` — `createUserMessage()`: data URL parts written to DB as-is
- `packages/opencode/src/session/message-v2.ts` (`toModelMessagesEffect`, line 143) — File parts prepared for model
- `packages/opencode/src/provider/transform.ts` — `unsupportedParts()` (line 396): WHERE images are rejected
- `packages/opencode/src/image/image.ts` — Image resizer (also works with data URLs, not disk files)
- `packages/opencode/src/config/attachment.ts` — Existing attachment config schema (image limits only)
- `packages/opencode/src/config/config.ts` — Root config schema (line 248: `attachment` field)
- `packages/core/src/config/attachments.ts` — Core attachment config schema (mirrors opencode)
- `packages/core/src/global.ts` — `Global.Path.tmp` = `os.tmpdir() + "/opencode"` — existing temp dir pattern
- `packages/opencode/src/util/data-url.ts` — `decodeDataUrl()` helper already exists

### Existing Temp File Patterns

The codebase already has patterns for temporary file management:

1. **`packages/core/src/global.ts`** (line 14): `Global.Path.tmp = path.join(os.tmpdir(), "opencode")` — guaranteed to exist (created at startup). This is the canonical temp directory.

2. **`packages/opencode/src/cli/cmd/tui/util/editor.ts`**: Creates temp files with `path.join(tmpdir(), \`${Date.now()}.md\`)`, writes content, reads back, then deletes.

3. **`packages/opencode/src/cli/cmd/tui/util/clipboard.ts`** (line 63): `path.join(tmpdir(), "opencode-clipboard.png")` for clipboard image capture.

4. **`packages/opencode/src/lsp/server.ts`** (line 1270): `fs.mkdtemp(path.join(os.tmpdir(), "opencode-jdtls-data"))` for JDT LS temp data.

### Approaches

1. **Save at attachment creation (frontend → API sidecar)** — Save file to temp dir when it's first attached in the frontend, before sending to server
   - Pros: Early capture, file available immediately
   - Cons: Requires frontend changes, temp cleanup on the browser side, adds latency
   - Effort: High

2. **Save on server when receiving parts** — In `createUserMessage()` in `prompt.ts`, when a `data:` URL file part is received, decode and save to temp dir
   - Pros: Centralized, captures all attachments regardless of source (API, CLI, etc.)
   - Cons: Adds I/O to every file attachment, need cleanup strategy
   - Effort: Medium

3. **Save before `unsupportedParts()` in the provider transform** — In `provider/transform.ts`, before `unsupportedParts()` replaces files with error text, save the base64 data to disk
   - Pros: Only saves files that would be rejected (text-only models), minimal overhead for vision models
   - Cons: Late in the pipeline, doesn't help with cases where you want files available regardless
   - Effort: Low

4. **Save as part of the LLM processing pipeline** — Hook into `message()` in `transform.ts` or add a new step in `runLoop()` in `prompt.ts` that saves attachments before sending to the model
   - Pros: Clean separation of concerns, can be conditional
   - Cons: More code, needs integration with session lifecycle
   - Effort: Medium

5. **Config-controlled save before model call** — Add a config option like `attachment.save_to_disk` (boolean or path), and save files to disk in `createUserMessage()` when the config option is enabled
   - Pros: User-controllable, discoverable, cleanest UX
   - Cons: More config surface area
   - Effort: Medium

### Recommendation

**Approach 5 (preferred)** combined with elements of Approach 2:

Add a config option `attachment.save_to_disk` (default: `true`) and/or `attachment.save_to_disk_path` (default: `{tmpdir}/opencode/attachments/`). When enabled, in `createUserMessage()` (`packages/opencode/src/session/prompt.ts`), for each file part with a `data:` URL and a media mime type (image/\*, application/pdf), decode the base64 data and write it to the temp directory before storing the message part. The message part `url` can optionally be updated to include a `file://` reference alongside the `data:` URL (or we can add a new metadata field like `saved_path`).

The hook point should be in `resolvePart()` (line 795 of `prompt.ts`), in the `case "data:"` branch (line 853), where we already handle `data:` URLs. This is the optimal interception point because:
- All attachment paths converge here (API, CLI, ACP)
- The file is available before it reaches the model layer
- It happens once per attachment, not per model call
- It can leverage existing `Global.Path.tmp`

### Config Integration

The config option would slot into the existing `AttachmentConfig.Info` schema in `packages/opencode/src/config/attachment.ts`:

```typescript
// New field in AttachmentConfig.Info
save_to_disk: Schema.optional(Schema.Boolean).annotate({
  description: "Save attached files (images, PDFs) to a temp directory so they are accessible to filesystem tools (default: true)",
}),
save_to_disk_path: Schema.optional(Schema.String).annotate({
  description: "Directory path for saving attached files (default: OpenCode temp dir)",
}),
```

### Files That Would Need Changes

| File | Change |
|------|--------|
| `packages/opencode/src/config/attachment.ts` | Add `save_to_disk` and `save_to_disk_path` config fields |
| `packages/core/src/config/attachments.ts` | Mirror config fields in core schema |
| `packages/opencode/src/session/prompt.ts` | In `resolvePart()` (~line 853), add save-to-disk logic for `data:` protocol file parts |
| `packages/opencode/src/image/image.ts` | Optionally update `normalize()` to work with file paths in addition to data URLs |
| `packages/opencode/src/provider/transform.ts` | Optionally enhance `unsupportedParts()` error to reference saved file path |

### Risks

- **Disk space**: Unbounded accumulation of saved attachments could fill temp dirs. Mitigation: use `Global.Path.tmp` (cleaned on restart) or add TTL-based cleanup.
- **Performance**: Synchronous base64 decode + file write for every attachment. Mitigation: files are typically small (images), and the I/O is negligible; use async writes.
- **Security**: Temp directory must not expose user data across sessions. Mitigation: `os.tmpdir()` is typically per-user, and the directory is cleaned on OS reboot.
- **Existing vision models**: No performance impact when `save_to_disk: false` is configured. When `true` (default), the write is a one-time cost.

### Ready for Proposal

Yes. The analysis is complete — the optimal hook point is clear (`createUserMessage` → `resolvePart()` for `data:` protocol), the config schema has an existing home, and the temp directory pattern is already established in `Global.Path.tmp`.
