# Proposal: Attachment File Save

## Intent

When users attach images/PDFs but use text-only models, the file data is LOST — it only exists as an ephemeral base64 data URL in the session DB and is never written to disk. Tools like OCR (tesseract) can't access the file. Add a config option to save attachments to disk so they're always accessible to filesystem tools regardless of model capabilities.

## Scope

### In Scope
- Add `save_to_disk` (bool) and `save_to_disk_path` (string) config fields to attachment schema
- Hook into `createUserMessage()` → `resolvePart()` `case "data:"` to decode and save files
- Use existing `Global.Path.tmp` + `/attachments` as default save location
- Store saved file path in a message part metadata field
- Enhance `unsupportedParts()` error to reference saved file path
- Unit tests for save, skip, and custom path scenarios

### Out of Scope
- Cleanup/TTL for saved files (deferred — tmpdir cleaned on OS reboot)
- Frontend changes (server-side interception only)
- Changes to existing vision model pipeline

## Capabilities

### New Capabilities
- `attachment-disk-save`: Save uploaded file attachments to disk on receipt, configurable via settings, with path accessible to downstream tools and error messages

### Modified Capabilities
- None

## Approach

1. **Config**: Add `save_to_disk` (default: `true`) and `save_to_disk_path` (default: `Global.Path.tmp + "/attachments"`) to both `packages/opencode/src/config/attachment.ts` and `packages/core/src/config/attachments.ts`
2. **Hook**: In `resolvePart()` `case "data:"` (~line 853 of `prompt.ts`), for non-text binary mime types (`image/*`, `application/pdf`), decode the base64 payload using `Buffer.from()` directly (existing `decodeDataUrl()` converts to string — need a raw Buffer variant for binary data), save to `{save_to_disk_path}/{timestamp}-{filename}`, attach `savedPath` to the message part
3. **Error enhancement**: In `unsupportedParts()` (`provider/transform.ts`), append `(saved to {savedPath})` when a path exists
4. **Tests**: Unit tests in `packages/opencode/test/` covering config parsing, save-to-disk on data: parts, and skip when disabled

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/opencode/src/config/attachment.ts` | Modified | Add `save_to_disk`, `save_to_disk_path` |
| `packages/core/src/config/attachments.ts` | Modified | Mirror new config fields |
| `packages/opencode/src/session/prompt.ts` | Modified | Save logic in `resolvePart()` ~L853 |
| `packages/opencode/src/provider/transform.ts` | Modified | Enhance `unsupportedParts()` error |
| `packages/opencode/src/util/data-url.ts` | Modified | Add `decodeDataUrlAsBuffer()` helper |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Disk space accumulation | Low | tmpdir cleaned on reboot; `save_to_disk: false` opt-out |
| Performance overhead | Low | Async write; one-time per attachment; negligible for typical sizes |
| Binary data corruption | Low | Use raw `Buffer.from()` not string intermediary |

## Rollback Plan

Set `attachment.save_to_disk: false` in user config — reverts to current ephemeral behavior. Remove config lines to fully restore defaults.

## Dependencies

- `Global.Path.tmp` already initialized at startup (`packages/core/src/global.ts`)

## Success Criteria

- [ ] Attached images saved to `{tmpdir}/opencode/attachments/` when model doesn't support images
- [ ] Config `save_to_disk: false` produces zero disk writes
- [ ] `unsupportedParts()` error includes saved file path when available
- [ ] Unit tests cover save, skip-with-false, and custom path scenarios
