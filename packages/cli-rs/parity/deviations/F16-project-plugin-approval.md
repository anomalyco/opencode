# F16: a project's plugin waits for approval

## TypeScript

The plugin host loads every directory under the `plugins` directories: the global config directory's, then each
`.opencode/plugins` from the project root down to the working directory (`packages/tui/src/plugin/discovery.ts`,
`localPluginDirectories` and `discoverPluginTargets`; `packages/tui/src/app.tsx` reads them at start). A plugin that a
cloned repository ships in `.opencode/plugins` runs its `setup` as the TUI starts, with nothing asked.

## Rust

A native build found in a project's `.opencode/plugins` is not opened until the user approves it
(`crates/plugin/src/loader/approval.rs`, `Loader::reconcile`). Until then it is listed `pending` in `/plugins`, a toast
says "Plugin needs approval: <directory>" once for each build, and it claims nothing: no command, slot, route or fence
of it takes effect, and it does not replace a built-in of its ID. Enter on its row asks "Run project plugin?" with
"This project wants to run native code inside opencode", the library that would run and the start of its SHA-256,
Decline active. Approve loads it at once; Decline lists it `declined` and stops asking about that build; Escape, Ctrl+C,
the header and the backdrop close the question and leave it pending. A declined row can be approved later. An answer
names the build shown: if the library changed while the question was open, nothing is saved and the new build is
asked about.

A TypeScript plugin found there waits the same way when the JS host runs it (`OPENCODE_PLUGIN_JS=1`, P7): the loader's
one decision point holds it back before anything of it reaches the JS host, which does not start for it. Its toast and
question say "This project wants to run TypeScript code in opencode's JS host" and show the module directory and the
SHA-256 of its files. Its artifact is the real path of the directory and a hash of what it holds: each file's path and
bytes, hidden ones and those in `node_modules` included, links followed as Bun follows them. A save that changes
nothing keeps the approval; a changed file, a moved one or a reinstalled dependency asks again and stops the running
plugin (its cleanup runs). The JS host reads the files itself, so a change between the hash and the import is caught by
the next reconcile, the watcher's (it watches the plugin's subdirectories too), which holds the new files back. A file
outside the directory that the plugin imports (`../shared.ts`) is not part of the approval: the approved code chose to
import it. Safe mode holds a TypeScript plugin as it holds a library.

A decision names the artifact: the plugin directory, the real path of the library, and the SHA-256 of the bytes that
are loaded. It is kept in `plugin-approvals.json` in the client's state directory, so it lasts across clients, and a
changed library is pending again, which stops the running build. A build that names a dependency the project would
supply is refused. The global `plugins` directory and the entries of `cli.json` need no approval, also an entry that
names a project's plugin another way (the library itself, or a link).

The shared fixture shows it: `parity/machines/plugins.json`, machine `project`, whose two `xfail` rows are this
deviation. TS shows the plugin at once (`A/yes/on/-`); Rust lists it pending as the client starts
(`found mount -/no/pending/-`) and declined once the user declines it (`found decline -/no/declined/-`). Approved, it
is the plugin TS shows, which the machine's other states check on both clients. The fixture's plugin is the native twin
on the Rust side; the TypeScript one (`parity/plugins/slot`) renders through Solid, which the JS host runs only with the
V2 compatibility layer (P8), so a TypeScript project plugin's rows are the Rust tests'
(`plugin_pipe::a_project_typescript_plugin_waits_for_approval`, `the_manager_asks_before_a_project_typescript_plugin_runs`).

## Reason

Decision O-125, 1 (rich-plugins synthesis 3.9): a native plugin runs inside the client, on the UI thread, with the
user's permissions, and a TypeScript plugin on the JS host runs with them too, so a repository the user clones must not run code in it unasked. An approval by path alone would
cover a different library after the next `git pull`, so it names the bytes too. A project cannot write `cli.json` or
the global directory, so those stay as in TS.
