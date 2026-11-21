# F16: a project's plugin waits for approval

## TypeScript

The plugin host loads every directory under the `plugins` directories: the global config directory's, then each
`.opencode/plugins` from the project root down to the working directory (`packages/tui/src/plugin/discovery.ts`,
`localPluginDirectories` and `discoverPluginTargets`; `packages/tui/src/app.tsx` reads them at start). A plugin that a
cloned repository ships in `.opencode/plugins` runs its `setup` as the TUI starts, with nothing asked.

## Rust

A plugin found in a project's `.opencode/plugins` does not run until the user approves it
(`crates/plugin/src/loader/approval.rs`, `Loader::reconcile`). Until then it is listed `pending` in `/plugins`, a toast
says "Plugin needs approval: <directory>" once for each build, and it claims nothing: no command, slot, route or fence
of it takes effect, and it does not replace a built-in of its ID. Enter on its row asks "Run project plugin?" with what
would run, its directory and the start of the SHA-256 of its files, Decline active. Approve loads it at once; Decline
lists it `declined` and stops asking about that build; Escape, Ctrl+C, the header and the backdrop close the question
and leave it pending. A declined row can be approved later. An answer names the build shown: if the files changed
while the question was open, nothing is saved and the new build is asked about.

A TypeScript plugin waits when the JS host runs it (Bun found, P7 and P8): the loader's one decision point holds it
back before anything of it reaches the JS host, which does not start for it. Its toast and question say "This project
wants to run TypeScript code in opencode's JS host" and show the module directory. A Luau plugin's say "This project
wants to run a Luau plugin inside opencode" and show the plugin directory. The artifact is the real path of the
directory and a hash of what it holds: each file's path and bytes, hidden ones and those in `node_modules` included,
links followed as Bun follows them. A save that changes nothing keeps the approval; a changed file, a moved one or a
reinstalled dependency asks again and stops the running plugin (its cleanup runs). What runs is a copy of exactly the
approved files. A file outside the directory that a TypeScript plugin imports (`../shared.ts`) is not part of the
approval: the approved code chose to import it.

A decision is kept in `plugin-approvals.json` in the client's state directory, so it lasts across clients. The global
`plugins` directory and the entries of `cli.json` need no approval, also an entry that names a project's plugin
another way (a link). A server plugin's TUI part loads without approval only when the user's own configuration
(`cli.json`, the global opencode config) names its spec or path, or its path is under a global plugin directory
(O-162). Any other is held: a local path for the same approval as a project's plugin directory, keyed by the same
artifact, and a package for one keyed by its files and its install's lockfile (`F16-typescript-plugins-skipped`).

The shared fixture `parity/machines/plugins.json`, machine `project`, has this deviation's two `xfail` rows: TS shows
the plugin at once (`A/yes/on/-`), where opencode-native lists it pending as the client starts and declined once the
user declines it. The Rust tests check the TypeScript and Luau plugins' rows
(`plugin_pipe::a_project_typescript_plugin_waits_for_approval`, `the_manager_asks_before_a_project_typescript_plugin_runs`,
and the Luau loader's tests).

## Reason

Decision O-125, 1 (rich-plugins synthesis 3.9): a Luau plugin runs inside the client, on the UI thread, with the
user's permissions, and a TypeScript plugin on the JS host runs with them too, so a repository the user clones must not
run code in it unasked. An approval by path alone would cover different code after the next `git pull`, so it names
the files' bytes too. A project cannot write `cli.json` or the global directory, so those stay as in TS.
