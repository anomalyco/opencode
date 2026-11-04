# X02: the Experiments dialog does not list "New designs"

## TypeScript

The Experiments dialog lists `New designs` (`packages/tui/src/component/dialog-experiments.tsx:17-28`), and
`experimental["new-designs"]` (`useNewDesigns()`, `packages/tui/src/config/index.tsx:394-396`) switches the
theme list, the dialog kit, autocomplete, the agent accent step, and many dialogs between two designs. Off is the
default.

## Rust

The Rust client draws the new designs only, whatever the config says (`decisions.md`, "Design target"). The
experiment is graduated as `packages/tui/AGENTS.md` describes: its registry entry and gates are gone, and the
registry, dialog, and `experimental.<id>` persistence stay. A `cli.json` that sets `new-designs` is read and
written unchanged; the value has no effect.

## Reason

User decision: "designs should fit that and only that". Every P-COMP and P-APP fixture is recorded from the TS TUI
with the experiment on (`parity/lib/app.ts` `withNewDesigns`), and `parity/component/E.18a-settings.tsx` records
the Experiments dialog with the same registry as Rust, without the `new-designs` entry.
