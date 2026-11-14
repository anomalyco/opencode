# OT1896: an image too large for one frame draws in half blocks

TypeScript: `@opentui/core` 0.8.4 sends an image over the Kitty graphics protocol whatever its size, across as many
frames as the upload takes.

Rust: the native renderer since anomalyco/opentui#1890 and #1896 sends each frame within the output queue's limit
(4 MiB by default). A Kitty upload larger than that is tried once more as a copy at the placement's pixel size. When
that copy is no smaller, the placement draws in half blocks until its size changes.

Seen with the image preview dialog on a terminal with Kitty graphics and 20x40-pixel cells, 120x40, on a 1600x1200
noise PNG (about 6 MB): TS shows the picture with Kitty, and Rust draws it in half blocks. With 10x20-pixel cells the
copy is smaller, and both sides use Kitty. The prompt's thumbnail is a Kitty copy on both sides.

Driven: `parity/scenarios/OT/kitty-preview.pty.ts` (P-PTY, `rsOnly`) waits for the preview's half blocks. It checks
#2130, which clears them when the preview closes over the thumbnail. TS takes the same steps with Kitty and has no
blocks to wait for, so the row cannot compare the sides. The TS screens were taken with the same terminal replies, out
of tree, during `repin-c6`.

Reason: the frame limit is OpenTUI's. It keeps a frame within the queue, so a large picture does not stall input or
drop frames. Whether TS shows the same once it moves to a newer `@opentui/core` has not been checked.
