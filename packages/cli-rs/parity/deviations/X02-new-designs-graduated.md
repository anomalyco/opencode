# X02: the Experiments dialog does not list "New designs"

## TypeScript

The Experiments dialog lists `New designs` (`packages/tui/src/component/dialog-experiments.tsx:20-25`), on unless the
config turns it off (#64988), and `experimental["new-designs"]: false` (`useNewDesigns()`,
`packages/tui/src/config/index.tsx:393-397`) switches the theme list, the dialog kit, autocomplete, the agent accent
step, and many dialogs back to the old designs.

## Rust

The Rust client draws the new designs only, whatever the config says (`decisions.md`, "Design target"). The
experiment is graduated as `packages/tui/AGENTS.md` describes: its registry entry and gates are gone, and the
registry, dialog, and `experimental.<id>` persistence stay. A `cli.json` that sets `new-designs` is read and
written unchanged; `false` has no effect.

## Reason

User decision: "designs should fit that and only that". Since #64988 a release starts with the new designs in both
clients, so only a config that turns the experiment off, or the Experiments dialog, shows the difference. Every P-COMP
and P-APP fixture is recorded from the TS TUI with the experiment on (`parity/lib/app.ts` `withNewDesigns`, which
also names the default theme because TS's test fixtures now pick `opencode-classic`), and
`parity/component/E.18a-settings.tsx` records the Experiments dialog with the same registry as Rust, without the
`new-designs` entry. `parity/scenarios/D131/designs.pty.ts` and `D131/plugins-release.pty.ts` run with the config a
release starts with and are equal.
