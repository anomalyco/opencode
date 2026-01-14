# Implementation Plan: File Preview Viewer

**Branch**: `002-file-preview-viewer` | **Date**: 2026-01-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-file-preview-viewer/spec.md`

## Summary

Implement a file preview panel in the workspace file explorer that renders text (.txt), markdown (.md), and HTML (.html/.htm) files when clicked. The feature uses the existing file loading infrastructure from `local.tsx` context and leverages the existing `Markdown` component for markdown rendering, while adding new text and HTML preview capabilities with sandboxed rendering for security.

## Technical Context

**Language/Version**: TypeScript 5.8.2 / Rust 2024 Edition (Tauri backend)
**Primary Dependencies**: Solid.js 1.9.10, Tailwind CSS 4.1.11, @kobalte/core 0.13.11, Vite 7.1.4, Marked (markdown parsing), DOMPurify (HTML sanitization)
**Storage**: File system via SDK (`sdk.client.file.read()`)
**Testing**: Vitest (configured but limited test coverage)
**Target Platform**: Desktop (Tauri) and Web
**Project Type**: Monorepo with packages/app (main app), packages/ui (shared components), packages/desktop (Tauri)
**Performance Goals**: File preview within 1 second for files under 1MB, smooth scrolling
**Constraints**: Sandboxed HTML rendering (no script execution), UTF-8 encoding default, max 5MB file size
**Scale/Scope**: Single user, local file system access

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution template has placeholder values - no specific principles defined. Proceeding with standard best practices:

- [x] **Simplicity**: Feature adds minimal new components; reuses existing `Markdown` component
- [x] **Security**: HTML rendering sandboxed via DOMPurify (already in use)
- [x] **Testability**: Each preview type can be independently tested
- [x] **Integration**: Uses existing SDK file loading; no new external dependencies required

## Project Structure

### Documentation (this feature)

```text
specs/002-file-preview-viewer/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
packages/app/
├── src/
│   ├── components/
│   │   ├── workspace-sidebar.tsx     # MODIFY: Add preview panel integration
│   │   ├── file-tree.tsx             # EXISTING: File selection (no changes needed)
│   │   └── file-preview/             # NEW: Preview components
│   │       ├── file-preview.tsx      # Main preview container
│   │       ├── text-preview.tsx      # Plain text renderer
│   │       └── html-preview.tsx      # Sandboxed HTML renderer
│   └── context/
│       └── local.tsx                 # EXISTING: File loading (no changes needed)

packages/ui/
├── src/
│   └── components/
│       └── markdown.tsx              # EXISTING: Reuse for .md preview
```

**Structure Decision**: Extend existing packages/app structure with new `file-preview/` component directory. No new packages or major architectural changes needed.

## Complexity Tracking

> No constitution violations. Feature follows existing patterns.

| Decision | Rationale |
|----------|-----------|
| Reuse existing Markdown component | Already handles security (DOMPurify), caching, Shiki highlighting |
| Use iframe for HTML preview | Standard browser sandboxing for untrusted HTML content |
| Add preview panel to workspace-sidebar | Keeps feature localized; no layout changes needed |
