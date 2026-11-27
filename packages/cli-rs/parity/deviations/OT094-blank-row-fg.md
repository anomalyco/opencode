# OT094: the foreground of a blank row in the compact rail

**TypeScript (`@opentui/core` 0.9.4, since #63989).** In the compact session rail, the blank row between the search
and files icons (row 2 of `E.12/rail-resize`'s `compact` checkpoint) keeps the default foreground in its eight
spaces. With Core 0.8.4 they carried the rail's tab color, `#1e1e1e`.

**Rust.** The eight spaces carry `#1e1e1e`, as TS drew them before 0.9.4.

**Reason.** A space shows no foreground, so nothing on screen differs; only the cell comparison sees it. 8 cells.
