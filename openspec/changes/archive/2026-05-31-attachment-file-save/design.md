# Design: Attachment File Save

## Technical Approach

Hook `resolvePart()` `case "data:"` (~L853, `prompt.ts`) to decode binary data URLs (image/*, application/pdf) as raw Buffers, write to `{save_path}/{session_id}/{ts}-{filename}`, and store path in `FilePart.metadata.savedPath`. Threads through AI SDK conversion into `unsupportedParts()` error text. Write failures log warning — never block message processing.

## Architecture Decisions

| Decision | Options | Chosen | Rationale |
|----------|---------|--------|-----------|
| Hook location | `resolvePart` vs pre-processor | `resolvePart` | Zero new loops, part has all context |
| Metadata storage | New field vs `metadata: Record<string, any>` | `metadata` (add to FilePart) | TextPart/ReasoningPart already use it — consistent pattern |
| Save function | Inline vs new util | New `util/attachment-save.ts` | Unit-testable, separates concerns |
| Binary decoding | `decodeDataUrl` vs `Buffer.from()` | `Buffer.from()` directly | No string intermediary, no data loss |
| savedPath threading | Extra field on AI SDK part | `(part as any).savedPath` | Minimal type fighting, AI SDK passes unknown fields through |

## Data Flow

```
User attachment → PromptInput FilePart (data: URL)
  → resolvePart case "data:"
    → saveDataUrlToFile() decode Buffer → write to disk
    → FilePart.metadata.savedPath = "/tmp/opencode/attachments/{sid}/{ts}-{name}"
  → MessageV2.toModelMessagesEffect() copies savedPath to AI SDK part
  → unsupportedParts() appends "(saved to {path})" when model lacks modality
```

## Config Schema

**`opencode/src/config/attachment.ts`**: Add to `Info`:
- `save_to_disk: Schema.optional(Schema.Boolean)` — default `true`
- `save_to_disk_path: Schema.optional(Schema.String)` — default `{Global.Path.tmp}/attachments`

**`core/src/config/attachments.ts`**: Same fields on `Info` class (`.pipe(Schema.optional)`)

**`core/src/session/legacy.ts`**: Add `metadata: Schema.optional(Schema.Record(...))` to `FilePart`

## Storage

- **Base**: `config.save_to_disk_path ?? path.join(Global.Path.tmp, "attachments")`
- **Per-session**: `{base}/{session_id}/`
- **File**: `{Date.now()}-{filename || "untitled"}`
- **Conflict**: Timestamp prefix guarantees uniqueness
- **Cleanup**: Deferred (tmpdir cleared on reboot)

## Code Changes

### `prompt.ts` ~L853 (case "data:")
Replace `break` for non-text with:
```
if (mime.startsWith("image/") || mime === "application/pdf") {
  const p = yield* saveDataUrlToFile(...)
  return [{ ...part, metadata: p ? { savedPath: p } : undefined }]
}
break  // keep for other mimes
```

### New `util/attachment-save.ts`
```
saveDataUrlToFile(url, cfg, sessionID) → Effect<string | undefined>
```
- Parse base64 from data URL via `Buffer.from(body, "base64")`
- Compute target dir from config or default
- `mkdir` + `writeFile` (async)
- On error: `log.warning`, return `undefined`

### `message-v2.ts` ~L233
Add to AI SDK file part: `...(part.metadata?.savedPath ? { savedPath } : {})`

### `transform.ts` ~L424
After error text: `const suffix = (part as any).savedPath ? \` (saved to ${(part as any).savedPath})\` : ""`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `opencode/src/util/attachment-save.ts` | Create | `saveDataUrlToFile()` |
| `opencode/src/config/attachment.ts` | Modify | Add `save_to_disk`, `save_to_disk_path` |
| `core/src/config/attachments.ts` | Modify | Mirror config fields |
| `core/src/session/legacy.ts` | Modify | Add `metadata` to FilePart |
| `opencode/src/session/prompt.ts` | Modify | Hook save in `case "data:"` |
| `opencode/src/session/message-v2.ts` | Modify | Thread `savedPath` into AI SDK part |
| `opencode/src/provider/transform.ts` | Modify | Append `(saved to ...)` |

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | `saveDataUrlToFile()` | Mock fs, cover: save enabled/disabled, write error, custom path |
| Unit | Config defaulting | Schema parse: defaults applied, custom path respected |
| Integration | Full prompt flow | Send data: URL part, verify metadata on FilePart |
| Integration | unsupportedParts | Mock text-only model, verify error contains saved path |

## Migration

None. Default `save_to_disk: true` activates on next start. Set to `false` to disable. Backward compatible.

## Open Questions

None.
