use std::path::Path;
use std::sync::Arc;

use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};

use crate::plugin_pipe::{Pipe, config};
use crate::support::{self, Fake};

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
        "opencode-some-plugin@0.1.3",
        "https://github.com/u/r",
        "https://github.com/u/r.git",
        "https://gitlab.com/u/r",
        "https://bitbucket.org/u/r",
        "ssh://git@github.com/u/r.git",
        "git@github.com:u/r.git",
        "foo@https://github.com/u/r",
        "u/r~1",
        "plugin.tgz",
        "plugin.tar.gz",
        "plugin.tar",
        "u/r#semver:^1",
        "u/r#a::b",
        "u/r#semver:^1::v2",
        "github:u/r#abc",
        "https://x.org/y.git",
        "https://x.org/y",
        "git@x.org:y/z.git",
        "git+ssh://git@x.org/y.git",
        "git+ssh://git@x.org:22/y.git",
        "foo@git@github.com:u/r.git",
        "foo@u/r",
        "./x.tgz",
        "/abs/x.tgz",
        "x.tgz.bak",
        "@s/x@./y.tgz",
        "http://github.com/u/r",
        "https://github.com/u/r/tree/main",
        "https://github.com/u",
        "https://www.github.com/u/r",
        "github:u",
        "gitlab:g/s/p",
        "gist:abc123",
        "bitbucket:u/r",
        "https://gist.github.com/u/abc",
        "foo@github:u/r",
        "sourcehut:u/r",
        "https://git.sr.ht/~u/r",
        "~/x",
        "~u/r",
        "a/b/c",
        "u/r.git",
        "U/r#x",
        "-u/r",
        "..",
        "../x",
        "x/..",
        "x/../y",
        "@s/../x",
        "@s/x/y",
        "existing@1.0.0/../../../outside",
        "-foo",
        "foo bar@",
        "node_modules",
        "@s/.x",
        "@../x",
        "ftp://x.org/y",
        "git+file:///tmp/r",
        "github:u/r%zz",
        "https://github.com/u/r%zz",
        "foo@npm:bar@1",
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
    let differ: Vec<String> = specs
        .iter()
        .zip(&ts)
        .zip(&rust)
        .filter(|((_, ts), rust)| ts != rust)
        .map(|((spec, ts), rust)| format!("{spec}: TS {ts}, Rust {rust}"))
        .collect();
    assert_eq!(ts.len(), specs.len());
    assert!(differ.is_empty(), "{} of {} keys differ:\n{}", differ.len(), specs.len(), differ.join("\n"));
}

#[test]
fn a_client_with_nothing_to_run_starts_no_bun() {
    let Some(real) = config() else { return };
    let looks = std::rc::Rc::new(std::cell::Cell::new(0));
    let find = opencode_plugin::pipe::Find(std::rc::Rc::new({
        let looks = looks.clone();
        move || {
            looks.set(looks.get() + 1);
            Some(real.clone())
        }
    }));
    let lazy =
        opencode_plugin::pipe::Config { find: Some(find), ..opencode_plugin::pipe::Config::new(Default::default()) };
    let server = serde_json::json!([{
        "id": "server-only", "source": { "type": "package", "target": "server-only@1.0.0" },
        "features": { "server": true }, "state": { "status": "active" },
    }]);
    let fake = Fake::new(move |seen| match seen.path.as_str() {
        "/api/plugin" => {
            (200, serde_json::json!({ "location": support::location("/tmp/app"), "data": server.clone() }))
        }
        _ => support::base(seen, "/tmp/app"),
    });
    let home = opencode_util::temp::tempdir().unwrap();
    let deps = Deps {
        route: Route::Home,
        roots: support::roots(support::home_paths(home.path()), "test"),
        ..support::deps(Arc::new(fake))
    };
    let args = opencode_tui::Args { local: true, ..opencode_tui::Args::default() };
    let harness = support::mount_on(opentui::testing::TestApp::new(120, 30), deps, args);
    let root = opencode_util::temp::tempdir().unwrap();
    let config_dir = root.path().join("config");
    let external = External { config_dir: config_dir.clone(), cwd: root.path().to_path_buf() };
    external_with(&harness.tui, external, Some(lazy));
    let pipe = Pipe { harness, root };
    pipe.settle();
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.settle();
    let scripts = pipe.scripts();
    assert_eq!((looks.get(), scripts.looked(), scripts.pid()), (0, false, None));
    let dir = config_dir.join("plugins").join("probe");
    crate::plugin_pipe::copy(&Path::new(crate::plugin_pipe::EXAMPLES).join("probe"), &dir);
    opencode_tui::plugins::host::reconcile(&pipe.harness.tui);
    pipe.active("example.probe");
    assert_eq!(looks.get(), 1);
    assert!(scripts.pid().is_some());
}
