//! TUI plugins named by npm package (js-npm): with the JS host, a `cli.json` entry and a server plugin's TUI part load
//! from the package cache TS installs into, found as TS's `Npm.resolve` finds them; nothing is installed. The
//! packages are the pinned tarballs of `parity/plugins/npm`, laid out as an install leaves them.

use std::path::Path;
use std::sync::Arc;

use opencode_plugin::Status;
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};

use crate::plugin_pipe::{Pipe, config};
use crate::support::{self, Fake};

/// Installs the pinned tarball of `name` in the cache under `home` as TS's `Npm.add` of `spec` leaves it: the key's
/// directory, a generation, its `package.json` naming the package, and the package in its `node_modules`.
pub(crate) fn install(home: &Path, spec: &str, name: &str, generation: &str) {
    let root = support::home_paths(home).cache.join("npm").join(spec).join(generation);
    let manifest =
        serde_json::json!({ "dependencies": { name: spec.rsplit_once('@').map_or("*", |(_, version)| version) } });
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("package.json"), manifest.to_string()).unwrap();
    crate::ports::unpack(name, &root.join("node_modules").join(name));
}

/// The TUI on Home with `plugins` in `cli.json`, the roots of a run with `HOME=home`, and the JS host; the server
/// lists `server` as its plugins.
fn open(home: &opencode_util::temp::TempDir, plugins: &[&str], server: serde_json::Value) -> Option<Pipe> {
    open_in(home, plugins, server, None, &[], true)
}

/// [`open`], working in `cwd` when one is given, with `user` as the `plugins` of the global opencode config, and a
/// server on this machine when `here` (one the client started; the fake's URL is not a loopback address).
fn open_in(
    home: &opencode_util::temp::TempDir,
    plugins: &[&str],
    server: serde_json::Value,
    cwd: Option<&Path>,
    user: &[&str],
    here: bool,
) -> Option<Pipe> {
    let config = config()?;
    let fake = Fake::new(move |seen| match seen.path.as_str() {
        "/api/plugin" => {
            (200, serde_json::json!({ "location": support::location("/tmp/app"), "data": server.clone() }))
        }
        _ => support::base(seen, "/tmp/app"),
    });
    let info = serde_json::json!({ "animations": false, "plugins": plugins });
    let deps = Deps {
        route: Route::Home,
        config: support::config(support::decode(&info.to_string())),
        roots: support::roots(support::home_paths(home.path()), "test"),
        ..support::deps(Arc::new(fake))
    };
    let args = opencode_tui::Args { local: here, ..opencode_tui::Args::default() };
    let harness = support::mount_on(opentui::testing::TestApp::new(120, 30), deps, args);
    let root = opencode_util::temp::tempdir().unwrap();
    let cwd = cwd.map_or_else(|| root.path().to_path_buf(), Path::to_path_buf);
    let config_dir = root.path().join("config");
    std::fs::create_dir_all(&config_dir).unwrap();
    // JSONC, as the user may write it.
    let global = format!("// mine\n{}", serde_json::json!({ "plugins": user }));
    std::fs::write(config_dir.join("opencode.jsonc"), global).unwrap();
    let external = External { config_dir, cwd, dev: Vec::new() };
    external_with(&harness.tui, external, Some(config));
    Some(Pipe { harness, root })
}

fn status(pipe: &Pipe, target: &str) -> Option<Status> {
    let entries = pipe.harness.tui.plugins.entries();
    entries.into_iter().find(|entry| entry.target.as_deref() == Some(target)).map(|entry| entry.status)
}

// Expected (TS `Npm.cacheKey`, run with Bun on this checkout): each spec form is keyed in the cache as TS keys it, so
// the same spec finds the same directory: a bare name, a version, ranges, tags, a scope, git and hosted specs, an alias,
// a path, a URL, and specs `npm-package-arg` refuses.
#[test]
fn a_spec_is_keyed_as_ts_keys_it() {
    let Some(root) = support::ts_root() else { return };
    let specs = [
        "foo",
        "foo@1.2.3",
        "foo@^1",
        "foo@~1.2",
        "foo@1.x",
        "foo@v1.2.3",
        "foo@01",
        "foo@>=1 <2 || 3",
        "foo@latest",
        "foo@beta",
        "foo@",
        "Foo",
        "@s/foo",
        "@s/foo@2",
        "@s/foo@next",
        "@s/foo@>=1 <2",
        "github:u/r",
        "u/r",
        "u/r#v1",
        "x/Y.Git",
        "git+https://x.org/y.git#abc",
        "git+https://x.org/a%20b.git",
        "git://x.org/%zz.git",
        "foo@git+https://x.org/y.git",
        "gitlab:g/p",
        "foo@npm:bar@1",
        "file:../x",
        "https://x.org/y.tgz",
        "foo bar",
        "foo@bad tag",
        ".foo",
        "_foo",
        "@s",
        "opencode-sidebar-tokens@0.1.3",
    ];
    let script = format!(
        "const {{ Npm }} = await import({:?}); const specs = JSON.parse(process.argv[1]); \
         console.log(JSON.stringify(await Promise.all(specs.map((spec) => Npm.cacheKey(spec)))))",
        root.join("packages").join("util").join("src").join("npm.ts").to_string_lossy()
    );
    let output = std::process::Command::new("bun")
        .args(["-e", &script, &serde_json::to_string(&specs[..]).unwrap()])
        .current_dir(std::env::temp_dir())
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let ts: Vec<String> = serde_json::from_slice(&output.stdout).unwrap();
    let rust: Vec<String> = specs.iter().map(|spec| opencode_plugin::loader::npm::cache_key(spec)).collect();
    for ((spec, ts), rust) in specs.iter().zip(&ts).zip(&rust) {
        assert_eq!(rust, ts, "{spec}");
    }
}

// Expected (TS `Npm.resolve`, `prepare`): a `cli.json` entry that names an installed package loads its TUI entry from
// the cache on the JS host, with no approval, as TS loads it. One whose key the cache does not hold (another version,
// or a bare name, which is `latest`) is skipped, and it and the startup notice say how to install it; nothing is
// installed or fetched.
#[test]
fn a_package_named_in_cli_json_loads_from_the_cache() {
    let home = opencode_util::temp::tempdir().unwrap();
    install(home.path(), "opencode-sidebar-tokens@0.1.3", "opencode-sidebar-tokens", "1794700000000");
    let plugins = ["opencode-sidebar-tokens@0.1.3", "opencode-sidebar-tokens", "opencode-sidebar-tokens@0.1.2"];
    let Some(pipe) = open(&home, &plugins, serde_json::json!([])) else { return };
    pipe.active("sidebar.tokens");
    pipe.settle();
    assert_eq!(status(&pipe, "opencode-sidebar-tokens@0.1.3"), Some(Status::Active));
    for missing in &plugins[1..] {
        let reason = opencode_plugin::loader::npm::missing(missing);
        assert_eq!(status(&pipe, missing), Some(Status::Skipped(reason)), "{missing}");
    }
    // The startup notice names each, with the command that installs it.
    pipe.harness.wait("the notice", || {
        pipe.settle();
        pipe.harness.tui.toasts.current().is_some()
    });
    let notice = pipe.harness.tui.toasts.current().unwrap();
    assert_eq!(notice.title.as_deref(), Some("2 TypeScript plugins not loaded"));
    for missing in &plugins[1..] {
        let line = format!("{missing}: {}.", opencode_plugin::loader::npm::missing(missing));
        assert!(notice.message.lines().any(|known| known == line), "{line:?} in {:?}", notice.message);
    }
    let npm = support::home_paths(home.path()).cache.join("npm");
    let keys: Vec<String> = std::fs::read_dir(&npm)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(keys, ["opencode-sidebar-tokens@0.1.3"], "something was installed");
}

// Expected (TS `serverTuiPlugins`, `context.tsx:96-103`, `301-305`): the TUI part of an active server plugin with a
// TUI feature loads from the cache under the target the server reports, and a local one from its path, each named by
// the user's global opencode config, so with no approval (O-162); a part of a
// plugin that is not active, or has no TUI feature, is not loaded, and one the cache does not hold is left out, as TS
// leaves out an optional target it cannot load (`context.tsx:362-363`).
#[test]
fn a_server_plugins_tui_part_loads_from_what_the_server_reports() {
    let home = opencode_util::temp::tempdir().unwrap();
    install(home.path(), "opencode-session-usage@0.1.8", "opencode-session-usage", "1794700000000");
    let local = home.path().join("local-part");
    crate::ports::unpack("opencode-sidebar-prompt", &local);
    let part = |target: serde_json::Value, tui: bool, status: &str| {
        let state = match status {
            "failed" => serde_json::json!({ "status": "failed", "error": "boom" }),
            status => serde_json::json!({ "status": status }),
        };
        let features = match tui {
            true => serde_json::json!({ "server": true, "tui": true }),
            false => serde_json::json!({ "server": true }),
        };
        serde_json::json!({ "source": target, "features": features, "state": state })
    };
    let server = serde_json::json!([
        part(serde_json::json!({ "type": "package", "target": "opencode-session-usage@0.1.8" }), true, "active"),
        part(serde_json::json!({ "type": "local", "path": local.to_string_lossy() }), true, "active"),
        part(serde_json::json!({ "type": "package", "target": "opencode-sidebar-tokens@0.1.3" }), false, "active"),
        part(serde_json::json!({ "type": "package", "target": "opencode-sidebar-tokens@0.1.3" }), true, "failed"),
        part(serde_json::json!({ "type": "package", "target": "not-cached@1.0.0" }), true, "active"),
    ]);
    let user = ["opencode-session-usage@0.1.8", local.to_str().unwrap()];
    let Some(pipe) = open_in(&home, &[], server, None, &user, true) else { return };
    pipe.active("opencode.sidebar.limit");
    pipe.active("sidebar.prompt");
    assert_eq!(status(&pipe, "opencode-session-usage@0.1.8"), Some(Status::Active));
    assert_eq!(status(&pipe, "opencode-sidebar-tokens@0.1.3"), None, "a part without a TUI feature was listed");
    assert_eq!(status(&pipe, "not-cached@1.0.0"), None, "a part the cache does not hold was listed");
}

// Expected (O-146, O-162): a server plugin's TUI part whose files are inside the project, as a local path in the
// project's `opencode.json` is, is a project plugin: it waits for the user's approval, and runs once approved. A part
// the server names by package, from the user's npm cache, loads with none when the user's global config names it.
#[test]
fn a_project_local_server_part_waits_for_approval_and_a_cached_one_does_not() {
    let home = opencode_util::temp::tempdir().unwrap();
    install(home.path(), "opencode-sidebar-tokens@0.1.3", "opencode-sidebar-tokens", "1794700000000");
    let work = home.path().join("work");
    std::fs::create_dir_all(work.join(".git")).unwrap();
    let local = work.join("tools").join("prompt");
    crate::ports::unpack("opencode-sidebar-prompt", &local);
    let part = |source: serde_json::Value| serde_json::json!({ "source": source, "features": { "server": true, "tui": true }, "state": { "status": "active" } });
    let target = local.to_string_lossy().into_owned();
    let server = serde_json::json!([
        part(serde_json::json!({ "type": "local", "path": target })),
        part(serde_json::json!({ "type": "package", "target": "opencode-sidebar-tokens@0.1.3" })),
    ]);
    let Some(pipe) = open_in(&home, &[], server, Some(&work), &["opencode-sidebar-tokens@0.1.3"], true) else {
        return;
    };
    pipe.active("sidebar.tokens");
    pipe.harness.wait("the part is held", || {
        pipe.settle();
        status(&pipe, &target) == Some(Status::Pending)
    });
    assert_eq!(pipe.status("sidebar.prompt"), None, "the project's part ran before its approval");
    let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(&pipe.harness.tui, &target) else {
        panic!("no artifact held for {target}")
    };
    // Its tree is hashed again and staged off the UI thread, as a project directory's is (js-followups).
    let before = opencode_plugin::loader::approval::hashed();
    let decision = opencode_plugin::loader::approval::Decision::Approved;
    assert_eq!(crate::plugin_pipe::decide(&pipe.harness, &target, &artifact, decision), Ok(true));
    pipe.active("sidebar.prompt");
    assert_eq!(opencode_plugin::loader::approval::hashed(), before, "the UI thread read the part's files");
}

// Expected (O-162, carbon jsnpm-2): a package the server reports that only a project's configuration names waits for
// the user's approval, keyed by its files and its install's lockfile, while one the user's global config names loads at
// once. Once approved it runs where it is, in the cache, since its dependencies sit beside it.
#[test]
fn a_package_only_the_project_names_waits_for_approval() {
    let home = opencode_util::temp::tempdir().unwrap();
    install(home.path(), "opencode-sidebar-tokens@0.1.3", "opencode-sidebar-tokens", "1794700000000");
    install(home.path(), "opencode-sidebar-prompt@0.1.6", "opencode-sidebar-prompt", "1794700000000");
    let lock = support::home_paths(home.path()).cache.join("npm/opencode-sidebar-tokens@0.1.3/1794700000000");
    std::fs::write(lock.join("package-lock.json"), r#"{ "lockfileVersion": 3 }"#).unwrap();
    let part = |spec: &str| {
        let source = serde_json::json!({ "type": "package", "target": spec });
        serde_json::json!({ "source": source, "features": { "server": true, "tui": true }, "state": { "status": "active" } })
    };
    let server = serde_json::json!([part("opencode-sidebar-tokens@0.1.3"), part("opencode-sidebar-prompt@0.1.6")]);
    let target = "opencode-sidebar-tokens@0.1.3";
    let Some(pipe) = open_in(&home, &[], server, None, &["opencode-sidebar-prompt@0.1.6"], true) else { return };
    pipe.active("sidebar.prompt");
    pipe.harness.wait("the package is held", || {
        pipe.settle();
        status(&pipe, target) == Some(Status::Pending)
    });
    assert_eq!(pipe.status("sidebar.tokens"), None, "the project's package ran before its approval");
    let Some((Ok(artifact), _)) = opencode_tui::plugins::host::held(&pipe.harness.tui, target) else {
        panic!("no artifact held for {target}")
    };
    assert!(artifact.path.starts_with(lock.canonicalize().unwrap()), "{:?}", artifact.path);
    // The install's lockfile is part of what is approved.
    let identify = || opencode_plugin::loader::approval::Artifact::tree(&artifact.path).unwrap().sha256;
    assert_eq!(identify(), artifact.sha256);
    std::fs::write(lock.join("package-lock.json"), r#"{ "lockfileVersion": 3, "packages": {} }"#).unwrap();
    assert_ne!(identify(), artifact.sha256);
    std::fs::write(lock.join("package-lock.json"), r#"{ "lockfileVersion": 3 }"#).unwrap();
    let decision = opencode_plugin::loader::approval::Decision::Approved;
    assert_eq!(crate::plugin_pipe::decide(&pipe.harness, target, &artifact, decision), Ok(true));
    pipe.active("sidebar.tokens");
}

// Expected (O-162): a local path a server on another machine reports names nothing here and is left out, even one the
// user's configuration names; its packages still load from this machine's cache.
#[test]
fn a_remote_servers_local_parts_are_left_out() {
    let home = opencode_util::temp::tempdir().unwrap();
    install(home.path(), "opencode-sidebar-tokens@0.1.3", "opencode-sidebar-tokens", "1794700000000");
    let local = home.path().join("local-part");
    crate::ports::unpack("opencode-sidebar-prompt", &local);
    let part = |source: serde_json::Value| serde_json::json!({ "source": source, "features": { "server": true, "tui": true }, "state": { "status": "active" } });
    let target = local.to_string_lossy().into_owned();
    let server = serde_json::json!([
        part(serde_json::json!({ "type": "local", "path": target })),
        part(serde_json::json!({ "type": "package", "target": "opencode-sidebar-tokens@0.1.3" })),
    ]);
    let user = ["opencode-sidebar-tokens@0.1.3", target.as_str()];
    let Some(pipe) = open_in(&home, &[], server, None, &user, false) else { return };
    pipe.active("sidebar.tokens");
    assert_eq!(status(&pipe, &target), None, "a remote server's local path was listed");
    assert_eq!(pipe.status("sidebar.prompt"), None);
}
