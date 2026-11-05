# F15: image diffs show no preview

**TypeScript.** A changed `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` file that is not deleted, outside the
committed source, shows the working-tree image in its card (`DiffViewerImage` in
`packages/tui/src/feature-plugins/system/diff-viewer-image.tsx`): it reads the file with `file.read`, decodes it,
and draws it, with a click that opens the image preview dialog.

**Rust.** The card's header says `Image`, as in TS, and its body says "Image preview is not available in
opencode-rs." (`plugins/diffs/viewer.rs`). No file is read. The committed and deleted image messages are the same
as in TS.

**Reason.** The image preview dialog (`dialogs/image_preview.rs`, E.4) and the image widget it draws with have
landed, but the diff card does not use them yet: it needs a `file.read` of the working-tree image and an
`ImageView` in the card body, then a click that calls `image_preview::show`. No scenario has an image file.
