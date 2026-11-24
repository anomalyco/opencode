# F16: TypeScript TUI plugins run by default on the JS host when Bun is found; Luau plugins load beside them

**TypeScript.** The plugin host (`packages/tui/src/plugin/context.tsx:290-420`) loads every `cli.json`
`plugins` entry that names no built-in, every directory under the `plugins` directories, and the server's
TUI plugins, then runs each one's `setup` beside the built-ins.

**Rust.** The registry (`crates/plugin/src/lib.rs`, `docs/plugin-abi.md`) applies the entries that select
built-ins (`-<id>`, `<id>`, `*`, `<prefix>.*`) exactly as TS does. The loader (`crates/plugin/src/loader`,
`docs/plugins.md`) discovers the same targets as TS: the subdirectories of the `plugins` directories and the
`cli.json` entries that name no built-in. A directory with a `plugin.toml` is a Luau plugin, and loads with hot
reload. A native plugin library (`plugin.so`, `.dylib`, `.dll`) is listed `Skipped`: "opencode-native does not load
native plugin libraries". Any other directory target is a TypeScript plugin. By default it
runs on the JS host, a Bun process the client starts (`docs/plugin-abi.md`, "The JS
host"), through the V2 compatibility layer (P8), which gives a V2 `{ id, setup }` module the context
and the modules TS gives it. Bun is looked for only when the first TypeScript plugin needs it (`OPENCODE_BUN`, the
local server's opencode binary run as its own Bun, the opencode bundled beside the client, or `bun` on the path), so a client with none runs no process for
it. Otherwise the registry lists it with status `Skipped`, its slot claims, commands and routes absent:
- `OPENCODE_PLUGIN_JS` set to `0`, `false` or `off` (any case) turns the JS host off: "TypeScript TUI plugins run on
  the JS host, which OPENCODE_PLUGIN_JS turns off: unset it to turn the JS host back on";
- a build without the cargo feature `ts` (on by default, ts-feature) has no JS host: "this build of opencode-native has
  no TypeScript plugin support (built without the ts feature)";
- with no Bun found: "TypeScript TUI plugins run on the JS host, which needs Bun: neither the server's opencode nor bun
  on the path runs it; install Bun 1.4 or newer, or set OPENCODE_BUN to its absolute path".

`scenarios/F16/ts-plugin-loads.pty.ts` drives the default: a plugin in the global `plugins` directory loads in both
clients, with no variable set.

Plugins named by npm package run on the JS host too, from the package cache TS installs into, and only from there:
opencode-native installs and fetches nothing. TS's client prepares a `cli.json` entry with `Npm.add`
(`packages/cli/src/commands/handlers/default.ts:143`), which installs a package the cache lacks and returns an
installed one as it is (`packages/util/src/npm.ts:263-268`), and a server plugin's TUI part with `Npm.resolve`
(`npm.ts:358-366`), then loads `Host.resolve(target).tui` (`packages/tui/src/plugin/context.tsx:652-671`). The Rust
loader (`crates/plugin/src/loader/npm.rs`) finds the package as `Npm.resolve` does: under
`<cache>/npm/<key>` (`npm.ts:148`, `<cache>` the global cache, `$XDG_CACHE_HOME/opencode` else `~/.cache/opencode`),
the key being the spec's text and not a version it resolves to (`npm.ts:60-97`: `<name>@<spec>` for a version, range or
tag, `<name>@latest` for a bare name, `git-<slug>-<hash>` for a git spec, else the spec), in the generation with the
largest number (`npm.ts:149-162`), as `node_modules/<name>` (`installedName`, `npm.ts:173-183`); so the same spec
picks the same directory, and a range is never matched against another version installed under another key. The
classification is `npm-package-arg` 13 and `hosted-git-info` 9 ported: hosted git URLs (HTTPS, SSH, SCP
`git@host:path`, `www.`), `name@<hosted URL>`, GitHub's `user/repo` with a `#committish`, sourcehut's `~user/repo`,
and tarballs keyed by their text. `plugin_npm.rs` checks 95 specs against TS's own `Npm.cacheKey`. Unlike TS, only a
spec TS's `parse` classifies (a version, range or tag of a named package, or a git spec) is looked up.
A tarball, a URL, an alias or a path keyed by its text names no package, and such a key can lead out of the
cache, as `existing@1.0.0/../../x` does in TS. The name joined under `node_modules` must be a package name (`name`,
`@scope/name`, as `validate-npm-package-name` takes it), so a `dependencies` key that is absolute or `..` is refused.
The package's real path must lie under the cache's `npm` directory, so a link out of it is refused too. The JS
host loads its `./tui` export, as for a directory. The TUI module must be one of the plugin's own files.
TS's client imports whatever `<name>/tui` resolves to (`packages/plugin/src/host.ts` `resolve`); TS's
server checks only its own server entry (`FSUtil.contains`, `core/src/config/plugin/source.ts`). The JS host refuses a
module whose real path is not inside the plugin directory's real path, for every plugin: a `package.json` `name` of
`../../x` or an absolute path resolves anywhere. A confined (approved project) plugin's own resolution from its root is
also refused there. Either way the plugin fails, saying why. A package's `<name>/tui` resolves inside the package, by
self-reference or from the `node_modules` it sits in, so no legitimate plugin is refused. "Inside" is TS's own
`FSUtil.contains` test, `path.relative` between real paths (`realpathSync.native`, with no verbatim prefix), for the
module and for each confined root (`pipe/compat/paths.ts`). So on Windows a drive letter's case, an
8.3 short name or a `\\?\` prefix on either side does not read as outside. The loader also hands the JS host real
paths without that prefix. Like any global or `cli.json` plugin a `cli.json` package needs no
approval, and its build identity is computed off the UI thread (FT-2). As TS resolves a loaded package once a session
(`context.tsx:663-665`), the directory a spec resolved to stays while the spec is a target: a later install (a new
generation) does not move it, and a package is not watched. A `cli.json` entry whose key the cache does not hold, where
TS installs it, is listed `Skipped` with the reason "not in opencode's package cache, and opencode-native installs
nothing: run `opencode-native plugin add <spec>`", and named so in the notice below. The TUI parts of the server's
plugins (`GET /api/plugin`, active with `features.tui`, by the package target or the local path the server reports,
TS `serverTuiPlugins`, `context.tsx:96-103`, `301-305`) load the same way, in TS's order: the discovered directories,
then the server parts, then `cli.json`; one the cache does not hold is left out, as TS leaves out an optional target it
cannot load (`context.tsx:362-363`).

Unlike TS, which asks for no approval at all, a server part loads without approval only when the user's own
configuration names it. `GET /api/plugin` carries no provenance, and a project's
`opencode.json` can name a package (a `.tgz`, a git spec) with no server export, so the server runs none of its code.
So the client reads the user's layers itself. They are the `plugins` entries of the global opencode config (`opencode.json`,
then `opencode.jsonc`, in the global config directory, in the order TS's `loadDirectory` reads them), then those of
`cli.json`. Each is a string or the `package` of `{ package, options }`. The entries fold in order, as TS's server folds
its operations (`core/src/plugin/supervisor.ts` `resolve`):
- a plugin directly under a global `plugin` or `plugins` directory starts named, as discovery adds it before any
  entry;
- an entry that is a part's spec, or names its path, names and enables it;
- a selector (`*`, `<prefix>.*`, `opencode.…`, or the part's ID) enables it again, without naming it;
- a removal `-<selector>` disables it, when the selector is the spec, the path or the plugin ID the server reports
  (`selects` is TS's `matches`).

A part is vouched for when it is named and, after the last entry, enabled. TS removes by plugin ID only. Matching a
removal by spec or path too can only withdraw a vouch, so the client errs toward asking. A `cli.json` change
refolds them at once.
- **Package:** it is named by an entry that is its spec exactly as written, which is the text TS's server reports as
  `source.target` (`core/src/config/plugin/source.ts` `parse`, `plugin/module.ts` `source`). The same package at
  another version, or one named only by the project's configuration (`opencode.json`, `.opencode/opencode.json`),
  waits for approval. A managed, explicit (`OPENCODE_CONFIG`) or `OPENCODE_CONFIG_CONTENT` layer vouches for
  nothing.
- **`cli.json`'s version of a package wins.** A server part for a package that a `cli.json` entry names, by its npm
  name or, for a git spec, by its installed name, is left out at whatever version. TS folds
  `cli.json` after the server's parts, and `desired.set` keys by plugin ID, so `cli.json`'s version replaces the
  server's (`tui/src/plugin/context.tsx:289-309`). The client decides by package name before anything loads. So
  `cli.json`'s entry never fails as "plugin ID … is already registered" behind the server's, and the server's part is
  not asked about. Two different packages with one ID still follow P.4's rule: the first one loaded keeps the ID.
- **Approval of a package:** it is keyed by the package's artifact: the SHA-256 of its own tree, folded with its
  install's `package.json` and `package-lock.json`, which name its dependencies (`approval::install_root`). Once
  approved it runs where it is, unstaged and unconfined: its dependencies sit beside it in the generation (about
  300 MB for a field-test plugin), so a copy of it could not import them.
- **Local path:** the path a server reports is made a real path: canonicalized, without the `\\?\` verbatim prefix
  Windows gives.
  - **Vouched:** a direct child of a global plugin directory (the reported path's parent is one; a link there
    counts, nothing deeper such as its `node_modules` does), or a path an entry of the user's configuration names
    (TS resolves `./`, `../` and `file://` against the config file's directory).
  - **Otherwise:** it is held as a project's plugin directory is, staged and confined, keyed by the same artifact.
  - **Merging:** a part that names a target already found under any spelling (a link, another case) is that target:
    one target with one decision. A `cli.json` entry for the same directory replaces the server's part in its place,
    with its options, compared by real path, as TS's `mergePluginTargets` merges them. A server part never stands in
    for a project's plugin the way a `cli.json` entry does (no alias).
- **Native build:** a server target never opens one. A part whose directory holds `plugin.so` (`.dylib`, `.dll`), or
  that names the library itself, is left out, as TS leaves out a part with no TUI entry.
- **Remote server:** local-path parts are dropped, unless the server is on this machine: one the client started or
  the service (no `--server`), or a `--server` URL whose host is a loopback address or `localhost`. A loopback port can
  be a tunnel to another machine. A path it reports then is held for approval like any path the user's configuration
  does not name.

`F16-project-plugin-approval` covers the approval itself. With the JS host turned off, an npm entry and a server part are listed as a directory is,
with the JS-host reason, each server part by its package target or path beside the server plugin's own row.
`crates/tui/tests/all/plugin_npm.rs` checks the keys of the spec forms against TS's `Npm.cacheKey`.

Where TS draws these plugins, the Rust client tells the user once a run, in the host's notice lane (a warning toast that
stays, with "Open plugins", as its "Plugin failed" toast is told; no plugin's toast hides it): "N TypeScript plugins
not loaded", then one line per reason naming the plugins, then "Run /plugins to view details." It waits for the server's
plugin list, so the server plugins' TUI parts are in the same notice; one found later (a config change, a new
directory, a new server plugin) is told then, once. `/plugins` lists each as a TUI row `skipped`, named by the `name` of
its directory's `package.json` where there is one, else by its target, with the reason as its error; the log has
`plugin <target> skipped: <reason>` once for each. `scenarios/F16/ts-plugins-skipped.pty.ts` drives it: a server plugin
whose TUI part TS loads and Rust, with `OPENCODE_PLUGIN_JS=0`, lists as skipped, with the notice.

What runs on the JS host differs from TS as `F16-v2-compat-layer` says, and one found in a project's
`.opencode/plugins` waits for the user's approval first (`F16-project-plugin-approval`). It is a second timing tier: a
tree, an effect and a read arrive a paint late or more; a node's layout (`getLayout()`, R1 to R3) is what the host laid
out, a frame late (`F16-v2-compat-layer`, "Layout reads"); and a handler that throws fails the plugin with none of its
effects (as `F16-plugin-panic-no-effects` does in process), where TS keeps them and the plugin. A key reaches a handler
a round trip late: a key a plugin's command declines goes on, as in TS, held at most 50 ms while the JS host answers
(CT-8, CT-19; `F16-v2-compat-layer`, "A key a command declines" and "The hold's bound"); a paste or a press the plugin
declared is the plugin's; a listener of every key only hears; and a key that switches a mode holds the next ones until
its answer applied (`hold`). All TypeScript plugins share one process: when it ends (a plugin hung, crashed or flooded
it, or it went over its memory), every other plugin is set up again with new state, where TS's plugins share the TUI's
process and die with it. The calls the process never started run once on the next one; the one it ran is not run again.

**Reason.** External plugins become Rust plugins; P.4 loads them as native shared
libraries. The Rust client cannot run TypeScript in its own process, so it runs today's V2
plugins on a JS host beside it, as the second tier, where their features map.
