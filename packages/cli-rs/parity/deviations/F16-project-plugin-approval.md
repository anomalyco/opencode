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

A decision names the artifact: the plugin directory, the real path of the library, and the SHA-256 of the bytes that
are loaded. It is kept in `plugin-approvals.json` in the client's state directory, so it lasts across clients, and a
changed library is pending again, which stops the running build. A build that names a dependency the project would
supply is refused. The global `plugins` directory and the entries of `cli.json` need no approval, also an entry that
names a project's plugin another way (the library itself, or a link).

The shared fixture shows it: `parity/machines/plugins.json`, machine `project`, whose two `xfail` rows are this
deviation. TS shows the plugin at once (`A/yes/on/-`); Rust lists it pending as the client starts
(`found mount -/no/pending/-`) and declined once the user declines it (`found decline -/no/declined/-`). Approved, it
is the plugin TS shows, which the machine's other states check on both clients.

## Reason

Decision O-125, 1 (rich-plugins synthesis 3.9): a native plugin runs inside the client, on the UI thread, with the
user's permissions, so a repository the user clones must not run code in it unasked. An approval by path alone would
cover a different library after the next `git pull`, so it names the bytes too. A project cannot write `cli.json` or
the global directory, so those stay as in TS.
