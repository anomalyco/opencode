# P.1: the plugin API

The in-process Rust plugin API (plan 6.10). Built-in feature plugins (E.14, E.18b, E.15a, E.19a) and the
LaTeX and Mermaid plugins (P.2, P.3) register through it, compiled in. External plugins load later as WASM
components on `wasmtime` (P.4, decision O-7); `crates/plugin/src/loader` is its stub.

The API covers what the TS built-ins use (`packages/tui/src/feature-plugins`, `packages/latex`,
`packages/merman`), nothing more. A count of `context.*` uses in those plugins: slots (14), keymap layers
(16), routes (`ui.router`, 22), the theme (50), the store (`data.*`, about 40), dialogs and toasts (24),
storage (4), code-block renderers (3). Dialogs, toasts, the store, and the client are already on the TUI's
shared context, so a built-in reaches them through the host it is given rather than through a second copy
of each API.

## Shape

`opencode-plugin` depends on opentui and opencode-ui only. It is generic over the host, so the TUI is
never a dependency of the plugins crate, and LaTeX and Mermaid can be written against any host:

```rust
pub trait Host: 'static {
    /// What changed since the last sync (the TUI: `opencode_store::Changes`).
    type Changes;
    fn app(&self) -> &App;
    /// The page theme (`context.theme`).
    fn theme(&self) -> Theme;
    /// The keymap plugin layers register on (`context.keymap`).
    fn keymap(&self) -> &DialogKeymap;
}

pub struct Definition<H> { id, setup: Rc<dyn Fn(&mut Setup<H>)> }   // TS `Plugin.define`
```

The TUI implements `Host for Tui` (`crates/tui/src/plugins/host.rs`). A built-in is a
`Definition<Tui>` and reads the store, dialogs, and toasts from the `Rc<Tui>` that `Setup::host` returns.
LaTeX and Mermaid are `Definition<H>` for any `H: Host`.

`Setup` is TS's `Context` reduced to registrations. Each registration is undone when the plugin
deactivates:

| `Setup` | TS | Notes |
| --- | --- | --- |
| `host()` | the context itself | `&Rc<H>`; closures keep a `Weak` |
| `id()`, `storage_key(key)` | `storage.store(key)` | `plugin.<id>.<key>`, the key TS stores under, for `Storage` on the host |
| `slot(Placement, render)` | `ui.slot(claim)` | `render(&H, &SlotInput) -> Box<dyn Slotted<H>>` |
| `layer(KeymapLayer)` | `keymap.layer(factory)` | Commands, palette and slash entries, and keybinds; disposed explicitly on deactivation (O-32) |
| `route(name, render)` | `ui.router.register(page)` | `render(&H) -> Box<dyn Slotted<H>>`, shown by `Route::Plugin { id, name }` |
| `code_block(language, render)` | `markdown.registerCodeBlockRenderer` | `render(&CodeBlock, &Theme) -> Option<AnyWidget>`; the U.4c `CodeBlockRenderers` slot |
| `on_dispose(f)` | the cleanup `setup` returns | |

Keybinds need no API of their own: a plugin's commands use `Bind::Default`, so their keys come from the
`keybinds` config and the generated defaults (`diff.*`, `plugins.*` are already in the U.2 table).

A rendered slot or route is a `Slotted<H>`: its root `View` and a `sync(&H, &H::Changes)` that the owner
of the slot calls with each change batch, as route views do (plan 6.8). A plain `View` is a `Slotted` that
never changes. There is no reactive framework, so this replaces Solid's reactive render.

## Slots

`SlotPath` lists the `SlotMap` paths (`packages/plugin/src/tui/context.ts:191-202`): `app`,
`home.footer`, `home.footer.status`, `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`,
`session.composer.top`, `session.panel`, `sidebar.content`, `sidebar.footer`. `SlotInput` carries the
inputs those paths publish (session ID, prompt footer mode and details, panel state).

`slot::resolve` is a port of `packages/tui/src/plugin/structure.ts`: replacement takeover, last-enabled
wins at one target, an ancestor replacement beats a descendant one, claims inside a replaced boundary are
suppressed, and a claim aimed at an unknown path appends to its nearest known ancestor. The unit tests
port `structure.test.ts`.

A host mounts a slot with `Registry::mount(host, parent, path, input, content)`. TS's `<Slot>` is a
fragment, so the claims go straight into `parent` in the order before, prepend, the host's own content
(skipped when a claim replaces it), append, after. The returned `SlotMount` syncs every claim.

Deviation in mechanism, not in output: TS resolves against the paths currently mounted; Rust resolves
against the fixed `SlotMap` list. The two differ only while a parent slot has mounted and its child has
not, which never shows in a frame.

## Registry and configuration

`Registry<H>` holds the definitions in enable order: the built-ins first, then any added later (a test
plugin). `activate` runs `setup` for every enabled plugin; `set_active(id, bool)` toggles one (the plugin
manager, E.18b). Code-block renderers are rebuilt per theme with `code_blocks(&Theme)`.

The `cli.json` `plugins` entries apply as in TS (`plugin/context.tsx:313-330`, `matches` at `:648`):

- `-<selector>` disables matching built-ins; `<selector>`, `*`, and `<prefix>.*` re-enable them; an entry
  starting `opencode.` never names an external plugin.
- Every other entry names a TypeScript TUI plugin. It is not loaded; `entries()` lists it with status
  `Skipped` and the message "TypeScript TUI plugins do not run in opencode-rs yet", and the TUI logs it
  once (deviation of F16 until P.4).

`entries()` returns each plugin's ID, source (built-in or configured), and status (active, inactive,
skipped), for the plugin manager.

## The TUI side

`crates/tui/src/plugins/host.rs`:

- `impl Host for Tui`;
- `builtins()`: the built-in IDs in TS order (`plugin/builtins.ts`). Until their steps land, each has an
  empty setup; E.14, E.15a, E.18b, E.19a, P.2 and P.3 each replace their own line with their plugin;
- `install(&Rc<Tui>)`: builds the registry from `builtins()` and the config, logs skipped entries, and
  activates; `add(&Rc<Tui>, Definition<Tui>)` adds and activates one more and remounts the route;
- `slot(tui, parent, path, input, content)`, `route(tui, id, name)`, and `code_blocks(tui)` for the TUI
  call sites.

Call sites wired in this step (minimal edits in other steps' files): the `Tui` field and install call
(`app.rs`), the `home.footer` slot (`routes/home.rs`), the plugin route's sync (`routes/plugin.rs`), and
the transcript's code-block renderers (`routes/session/messages/list.rs`). The other slots
(`prompt.footer*`, `sidebar.*`, `session.composer.top`, `session.panel`, `app`) are mounted by the steps
that own those views, with the same one call.

## Proof

- Unit tests in `crates/plugin`: slot resolution (ported from `structure.test.ts`), selector matching,
  config directives and skipped entries, activation and deactivation (layers disposed, claims and code
  blocks removed), mount order.
- P-APP `P.1/slot`: a test plugin appends a line to `home.footer`. The TS side loads it as a local plugin
  directory (`parity/plugins/slot/tui.tsx`, configured in `plugins`); the Rust side registers its Rust twin
  when the recording's `OPENCODE_PARITY_PLUGIN` is `slot`, and lists the configured TS entry as skipped.
