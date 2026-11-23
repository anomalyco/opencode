# T21: a replacing toast does not keep the old toast's fields

## TypeScript

`toast.show` replaces the current toast when it is not paused and nothing is queued
(`packages/tui/src/ui/toast.tsx:167-175`). It does so with `setStore("currentToast", toastOptions)`. A Solid
store merges an object into the object already there, so fields the new toast does not set stay from the old
one. Showing `{ title: "Failed to load theme: mine", message: "…" }` and then `{ message: "queued" }` shows the
title of the first toast over the message of the second. A wrong `action` can stay the same way.

## Rust

`Toasts::show` replaces the whole toast. The second toast shows only its own message.

## Reason

The TypeScript behavior is a store-merge defect, not a design choice: the toast's type has no field meant to
carry over. P-COMP fixture `U.3/toast-theme` shows one toast only, so both sides render the same cells.
