# Office extraction parser stack

Office attachments (doc/docx/xls/xlsx/ods, pptx/odt/odp, plus ppt stubbed) are extracted to text server-side in `packages/core/src/office.ts` instead of being forwarded to providers, because the AI SDK converters hard-reject office media types on every non-Bedrock route. We picked boring pure-JS parsers over richer WASM/OOXML stacks to keep the Bun server runtime WASM-free: `mammoth` for docx, `xlsx@0.18.5` (SheetJS) for spreadsheets, `word-extractor` for legacy .doc, and a ~60-line `@zip.js/zip.js` + text-run reader for pptx/odt/odp.

## Considered Options

- `@silurus/ooxml` (already used for preview): headless docx extraction fails in Bun (canvas font-metric dependency), and WASM loading in the server runtime was the risk we set out to avoid. It stays preview-only.
- `officeparser`: does not parse legacy `.doc/.xls/.ppt` (the formats we committed to) and drags `pdfjs-dist` + `tesseract.js` as hard dependencies.
- Hybrid WASM stack (`@silurus` xlsx/pptx + mammoth + word-extractor): better xlsx fidelity, one more runtime risk surface; revisit if CSV-per-sheet extraction measurably annoys models.

## Consequences

- `xlsx@0.18.5` is the frozen npm snapshot: SheetJS left the npm registry, so this version never receives updates and has no Dependabot path. It is pure JS, sandbox-safe input parsing, and pinned deliberately; migrate to SheetJS's CDN package only if a real parse bug forces it.
- Extraction caps: 10 MiB per file, 50 KB of text per attachment, both with model-facing stub messages when exceeded or unreadable.
- `.ppt` (legacy binary decks) has no parser and always yields the stub; the upgrade path is a CFB `TextBytesAtom` scan via SheetJS's bundled CFB module when a real file shows up.
