# attachment-disk-save Specification

## Purpose

Save uploaded file attachments (images, PDFs) to a configurable temp directory on receipt, so files remain accessible to filesystem tools (OCR, tesseract) even without vision model support.

## Requirements

### R1: Config Schema

The attachment config MUST expose two optional fields controlling disk persistence.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `save_to_disk` | boolean | `true` | Enable saving attachments to disk on receipt |
| `save_to_disk_path` | string | `{Global.Path.tmp}/attachments` | Target directory for saved files |

#### Scenario: Defaults applied when omitted

- GIVEN a config with no `attachment.save_to_disk` or `attachment.save_to_disk_path`
- WHEN the system initializes attachment config
- THEN `save_to_disk` MUST be `true`
- AND `save_to_disk_path` MUST default to `{Global.Path.tmp}/attachments`

#### Scenario: Custom path respected

- GIVEN a config with `attachment.save_to_disk_path: "/custom/path"`
- WHEN the system initializes attachment config
- THEN attachment files MUST be saved to `/custom/path`

#### Scenario: Save disabled

- GIVEN a config with `attachment.save_to_disk: false`
- WHEN any attachment is received
- THEN no file MUST be written to disk

### R2: File Save on Attachment Receipt

When `save_to_disk` is `true` and `resolvePart()` processes a `data:` URL with a non-text media mime type (`image/*`, `application/pdf`), the system MUST decode and save the payload to disk.

#### Scenario: Image saved to disk

- GIVEN `save_to_disk: true` and a user sends an `image/png` attachment
- WHEN `resolvePart()` processes the `data:` URL
- THEN the base64 payload MUST be decoded and written to `{save_to_disk_path}/{timestamp}-{filename}`
- AND the saved file path MUST be stored in the message part metadata

#### Scenario: PDF saved to disk

- GIVEN `save_to_disk: true` and a user sends an `application/pdf` attachment
- WHEN `resolvePart()` processes the `data:` URL
- THEN the PDF bytes MUST be written to `{save_to_disk_path}/{timestamp}-{filename}`
- AND the saved file path MUST be stored in the message part metadata

#### Scenario: Text/plain skipped

- GIVEN `save_to_disk: true` and a user sends a `text/plain` attachment
- WHEN `resolvePart()` processes the `data:` URL
- THEN no file MUST be written to disk
- AND text content MUST be inlined as before

### R3: Error Message Enhancement

When `unsupportedParts()` generates an error for a model that lacks the required modality and the attachment has a saved path, the error MUST include the path.

#### Scenario: Path appended to error

- GIVEN a text-only model and an attachment with `savedPath: "/tmp/opencode/attachments/photo.png"`
- WHEN `unsupportedParts()` processes the attachment
- THEN the error text MUST append `(saved to /tmp/opencode/attachments/photo.png)`

#### Scenario: No path, no suffix

- GIVEN a text-only model and an attachment without `savedPath`
- WHEN `unsupportedParts()` processes the attachment
- THEN the error text MUST NOT contain a path reference

### R4: Edge Cases

#### Scenario: No write permission

- GIVEN `save_to_disk: true` and the target directory is not writable
- WHEN the system attempts to save
- THEN the write error MUST be caught gracefully
- AND the attachment MUST be processed without `savedPath` metadata
- AND a warning SHOULD be logged

#### Scenario: Disk full

- GIVEN `save_to_disk: true` and the write fails with `ENOSPC`
- WHEN the system attempts to save
- THEN the error MUST be caught gracefully
- AND processing MUST continue without `savedPath`

#### Scenario: Existing file conflict

- GIVEN `save_to_disk: true` and a file exists at the computed target path
- WHEN the system attempts to save
- THEN the existing file MUST NOT be overwritten
- AND the system SHOULD generate a unique name (e.g., append counter)

### R5: Non-Regression — Vision Models

The disk save feature MUST NOT alter behavior for vision-capable models.

#### Scenario: Vision model receives image transparently

- GIVEN a vision-capable model and a user sends an image attachment with `save_to_disk: true`
- WHEN the attachment is processed
- THEN the model receives the image data identically to current behavior
- AND disk save (if enabled) is transparent to the model pipeline
