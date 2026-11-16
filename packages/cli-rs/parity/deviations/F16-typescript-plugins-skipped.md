# F16: TypeScript TUI plugins run on the JS host when Bun is found; native plugins load beside them

**TypeScript.** The plugin host (`packages/tui/src/plugin/context.tsx:290-420`) loads every `cli.json`
`plugins` entry that names no built-in, every directory under the `plugins` directories, and the server's
TUI plugins, then runs each one's `setup` beside the built-ins.

**Rust.** The registry (`crates/plugin/src/lib.rs`, `docs/P.1.md`) applies the entries that select
built-ins (`-<id>`, `<id>`, `*`, `<prefix>.*`) exactly as TS does. The loader (`crates/plugin/src/loader`,
`docs/P.4.md`) discovers the same targets as TS: the subdirectories of the `plugins` directories and the
`cli.json` entries that name no built-in. A target with a native build (a shared library on the C ABI of
`opencode-plugin-abi`) loads, with hot reload. A directory target without one is a TypeScript plugin: when Bun is
found (`OPENCODE_BUN`, the local server's opencode binary run as its own Bun, or `bun` on the path) and `OPENCODE_PLUGIN_JS` is `1` (off by default), it runs on the JS host, a Bun process
the client starts (`docs/P.4.md`, "TypeScript plugins on the JS host"), through the V2 compatibility layer (P8), which
gives a V2 `{ id, setup }` module the context and the modules TS gives it. Without Bun, or without `OPENCODE_PLUGIN_JS=1`,
the registry lists it with status `Skipped` and the reason "TypeScript TUI plugins run on the JS host, which is off: set
OPENCODE_PLUGIN_JS=1 (with Bun installed) to turn it on"; its slot claims, commands and routes are absent.

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
picks the same directory, and a range is never matched against another version installed under another key. The JS
host loads its `./tui` export, as for a directory. The TUI module must be one of the plugin's own files (carbon
`jsnpm-3`). TS's client imports whatever `<name>/tui` resolves to (`packages/plugin/src/host.ts` `resolve`); TS's
server checks only its own server entry (`FSUtil.contains`, `core/src/config/plugin/source.ts`). The JS host refuses a
module whose real path is not inside the plugin directory's real path, for every plugin: a `package.json` `name` of
`../../x` or an absolute path resolves anywhere. A confined (approved project) plugin's own resolution from its root is
also refused there. Either way the plugin fails, saying why. A package's `<name>/tui` resolves inside the package, by
self-reference or from the `node_modules` it sits in, so no legitimate plugin is refused. Like any global or `cli.json` plugin a `cli.json` package needs no
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
configuration names it (O-162, carbon `jsnpm-2`). `GET /api/plugin` carries no provenance, and a project's
`opencode.json` can name a package (a `.tgz`, a git spec) with no server export, so the server runs none of its code.
So the client reads the user's layers itself: the `plugins` entries of `cli.json` and of the global opencode config
(`opencode.json`, `opencode.jsonc` in the global config directory, TS `ConfigDiscovery`), a string or the `package` of
`{ package, options }`, `-` removals ignored.
- **Package:** it is vouched for when one of those entries is its spec exactly as written, which is the text TS's
  server reports as `source.target` (`core/src/config/plugin/source.ts` `parse`, `plugin/module.ts` `source`). The
  same package at another version, or named only by the project's configuration (`opencode.json`,
  `.opencode/opencode.json`), waits for approval. A managed, explicit (`OPENCODE_CONFIG`) or `OPENCODE_CONFIG_CONTENT`
  layer vouches for nothing.
- **Approval of a package:** it is keyed by the package's artifact: the SHA-256 of its own tree, folded with its
  install's `package.json` and `package-lock.json`, which name its dependencies (`approval::install_root`). Once
  approved it runs where it is, unstaged and unconfined: its dependencies sit beside it in the generation (about
  300 MB for a field-test plugin), so a copy of it could not import them.
- **Local path:** the path a server reports is canonicalized. It is vouched for under a global plugin directory
  (`plugin`, `plugins` in the global config directory) or when an entry of the user's configuration names it (TS
  resolves `./`, `../` and `file://` against the config file's directory). Any other path is held as a project's
  plugin directory is, staged and confined, keyed by the same artifact. A part that names a target already found under
  any spelling (a link, another case) is that target: one target with one decision. A server part never stands in for
  a project's plugin the way a `cli.json` entry does (no alias).
- **Native build:** a server target never opens one. A part whose directory holds `plugin.so` (`.dylib`, `.dll`), or
  that names the library itself, is left out, as TS leaves out a part with no TUI entry.
- **Remote server:** local-path parts are dropped, unless the server is on this machine: one the client started or
  the service (no `--server`), or a `--server` URL whose host is a loopback address or `localhost`. A loopback port can
  be a tunnel to another machine. A path it reports then is held for approval like any path the user's configuration
  does not name.

`F16-project-plugin-approval` covers the approval itself. With the JS host off, an npm entry and a server part are listed as a directory is,
with the JS-host reason, each server part by its package target or path beside the server plugin's own row.
`scenarios/P.8/cache-cli.app.ts` and `cache-server.app.ts` drive both on each side from one cache holding a pinned
tarball: equal screens and requests. `crates/tui/tests/all/plugin_npm.rs` checks the keys of 34 spec forms against
TS's `Npm.cacheKey`, and the not-installed reason and notice.

Where TS draws these plugins, the Rust client tells the user once a run, in the host's notice lane (a warning toast that
stays, with "Open plugins", as its "Plugin failed" toast is told; no plugin's toast hides it): "N TypeScript plugins
not loaded", then one line per reason naming the plugins, then "Run /plugins to view details." It waits for the server's
plugin list, so the server plugins' TUI parts are in the same notice; one found later (a config change, a new
directory, a new server plugin) is told then, once. `/plugins` lists each as a TUI row `skipped`, named by the `name` of
its directory's `package.json` where there is one, else by its target, with the reason as its error; the log has
`plugin <target> skipped: <reason>` once for each. `scenarios/F16/ts-plugins-skipped.pty.ts` drives it: a server plugin
whose TUI part TS loads and Rust, with the JS host off, lists as skipped, with the notice.

What runs on the JS host differs from TS as `F16-v2-compat-layer` says, and one found in a project's
`.opencode/plugins` waits for the user's approval first (`F16-project-plugin-approval`). It is a second timing tier: a
tree, an effect and a read arrive a paint late or more, there is no `layout` call, and a handler that throws fails the
plugin with none of its effects (as `F16-plugin-panic-no-effects` does in process), where TS keeps them and the plugin.
A key reaches a handler a round trip late, so the host consumes what the plugin declared (a bind's key, a paste, a
press) and a listener of every key only hears; a key that switches a mode holds the next ones until its answer applied
(`hold`). All TypeScript plugins share one process: when it ends (a plugin hung, crashed or flooded it, or it went
over its memory), every other plugin is set up again with new state, where TS's plugins share the TUI's process and
die with it. The calls the process never started run once on the next one; the one it ran is not run again.

**Reason.** User decision Q5: external plugins become Rust plugins; P.4 loads them as native shared
libraries (decision O-42). The Rust client cannot run TypeScript in its own process; O-125 and O-128 run today's V2
plugins on a JS host beside it, as the second tier, where their features map.
