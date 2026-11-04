# T.1: TUI shell and UI structure

The frame every TUI step plugs into. T.1 builds the app, the routes, a minimal home and session view, the
dialog host, the connection status, and the module tree with a stub for every later file. It does not
build the features of later steps.

## Threads

- The UI thread runs `App::run` and owns every widget. opentui-rust handles are not `Send`.
- Network work runs on the app's tokio runtime (`App::runtime`, multi-threaded). `Data` is created with
  `Data::with_runtime(client, options, app.runtime())`, and the event connection
  (`opencode_store::connection::connect`) is started inside `runtime.enter()`.
- Blocking file work (`cli.json` writes, storage writes, custom theme discovery) runs on
  `spawn_blocking`. The file lock blocks, so it never runs on the UI thread.
- The store wakes the UI through one bounded path: a task awaits `data.subscribe().changed()` and posts
  a `DataChanged` message through `AppProxy` only when none is pending (an `AtomicBool`). So at most one
  wake is queued, however fast the store flushes. The connection state posts `StatusChanged` the same way.

## The shared context

`app::Tui` is the one shared context, held as `Rc<Tui>`. Closures keep a `Weak<Tui>`, so the app does
not leak through widget callbacks.

| Field | What |
| --- | --- |
| `app` | The `App` |
| `data` | The store (`opencode_store::Data`) |
| `keymap` | `Rc<DialogKeymap>`, that is `TuiKeymap<u32>` with widget ids as focus targets |
| `dialogs`, `toasts` | U.3's dialog host and toast stack |
| `theme` | `RefCell<ThemeState>` (U.1) |
| `config` | `Resolved` `cli.json` (F.5), and `CliConfig` and `Storage` when there are real roots |
| `directory` | The default location directory |
| `route` | The current `Route` and its mounted view |

`Tui::navigate(route)` detaches the current view, mounts the new one into the route container, and
syncs it with `Changes::everything()`.

## Routes and views

`routes::Route` is `Home`, `Session { id }`, or `Plugin { id, name }` (row T01, `context/route.tsx`).
A route view implements `routes::RouteView`:

```rust
pub trait RouteView {
    fn root(&self) -> View;
    fn sync(&self, tui: &Tui, changes: &Changes);
    fn focus(&self, tui: &Tui) {}
}
```

Each `DataChanged` calls `data.changes_since(seen)` once and passes the result to the current view. A
view updates only the widgets the changes name. A feature that is part of a view, such as the
transcript, the permission prompt, or the sidebar, has the same `sync` shape and is called by its view.

## Layout

```
root (column, page background)
├── main (grow): the route view
│   home:    title, session list (Select), hint
│   session: header (title), transcript (ScrollBox, sticky bottom),
│            permission region (E.9a), prompt region (E.2)
└── footer (row): directory · connection status
dialogs (absolute, z 3000), toasts (in root)
```

`grow()` is used with `basis(Length::Auto)` where the TS TUI uses `flexGrow` (cli-rs `AGENTS.md`).

## Keys

- One keymap, `TuiKeymap<u32>`, built from `Keybinds::resolve(&resolved.keybinds(), !cfg!(windows))` and
  `Options { leader_timeout }`.
- `dialog::route_keys` is installed once. It sets the keymap focus from the focused widget and its
  ancestors, and stops the key when the keymap handles it, before widgets see it.
- After every key, if `leader_deadline()` is set, a timer at that instant calls `expire_leader`.
- `textarea_enabled` reads `Tui::textarea`, a slot E.2 fills with the prompt's textarea; while it holds,
  the textarea's own key handling must be off (E.2).
- T.1's layer has `app.exit` (Ctrl+C, Ctrl+D, `<leader>q`), `command.palette.show` (Ctrl+P),
  `help.show`, and `session.new` (`<leader>n`), which goes home as in TS. `exit_on_ctrl_c` is off: Ctrl+C
  reaches the keymap, so an open dialog closes first, as in TS. Quitting restores the terminal.

## Theme

`ThemeState` starts from `cli.json`'s `theme`, the terminal mode `App::new` detected, and the cached
`system-theme` palette. `App::new` asks the terminal for 16 palette colors (`palette_size: 16`), and the
answer goes to `ThemeState::palette`. Effects: `PersistName` and `PersistMode` update `cli.json`,
`CachePalette` writes storage, all on `spawn_blocking`. `on_theme_mode` feeds `terminal_mode`. Custom
themes are discovered on `spawn_blocking` after mount. `take_error` goes to `toasts.theme_error`.
A theme change reapplies the theme to the dialogs, the toasts, and the mounted view (it is remounted).

## The module tree (plan 6.8, 8.4)

T.1 creates every shared `mod.rs` and a one-line stub for every file later steps own. A directory
owned by one step (`tabs/**`, `frame/**`, `panel/**`, `terminal/**`, `composer/**`, `client_mcp/**`,
`prompt/autocomplete/**`, `dialogs/integration/**`) gets a stub `mod.rs` that the step replaces.
`prompt/move.rs` is `r#move`.

Call sites T.1 wires as calls to stubs in the owning module:

| Caller | Stub | Owner |
| --- | --- | --- |
| `app::mount` | `features::startup::run`, `features::events::install`, `features::title::install`, `features::overlays::install` | E.1 |
| `app::mount` | `features::system_commands::commands` | E.20 |
| `routes::home` | `features::update_notification::mount`, `features::home_forms::mount`, `plugins::home_footer::mount` | E.18b, E.9b, E.14 |
| `routes::session` | `messages::list::Transcript` | E.6a |
| `routes::session` | `permission::sync` | E.9a |
| `routes::session` | `prompt::editor::mount` | E.2 |
| `routes::session` | `sidebar::mount` | E.14 |
| `routes::plugin` | `plugins::host::route`, `features::route_missing::mount` | P.1, E.1 |

T.1's plain transcript lives in `routes/session/messages/list.rs`, which E.6a replaces. The home in
`routes/home.rs` goes to E.1. E.11a's session list dialog is separate from the home list.

## Testability

`app::mount(app, Deps)` builds the TUI on any `App`, including `TestApp`. `Deps` carries the client
(any transport), the directory, the config (`Resolved`), optional real roots (`Paths`, for `cli.json` and
storage), the initial route, and whether to open the event connection. `app::run(Launch)` is the
terminal entry the root command calls: it resolves the connection first, prints any warning, then runs
the app until Ctrl+C.

## Root command

`opencode-rs [directory] [-s id] [-c] [--server url]`:

1. Enter `directory`, else `paths::start_directory()`.
2. Resolve the server with `connect::resolve` (F.6, F.9), passing `on_start` for "Starting background
   server..." on stderr. The `Connection` lives until the TUI ends (a standalone server stops when it is
   dropped).
3. `-s id` opens that session. `-c` lists `limit: 1, order: desc, parentID: null, archived: false,
   directory` and opens the result, as `app.tsx:689-715` does; no match stays on home.
