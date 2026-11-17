//! D.1: the delegated commands run `OPENCODE_TS_BIN` with the same arguments, stdio, and exit code. A fake
//! TypeScript binary records what it got, so nothing real is installed, removed, or served.
#![cfg(unix)]

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use opencode_service::ts_command::write_script;

const FAKE: &str = r#"#!/bin/sh
printf '%s\n' "$@" > "$DELEGATE_DIR/args"
echo "$$" > "$DELEGATE_DIR/pid"
echo "print-logs=$OPENCODE_PRINT_LOGS" > "$DELEGATE_DIR/env"
cat
echo "to stderr" >&2
exit "${DELEGATE_EXIT:-0}"
"#;

struct Fake {
    dir: opencode_util::temp::TempDir,
}

impl Fake {
    fn new() -> Self {
        let dir = opencode_util::temp::tempdir().unwrap();
        let bin = dir.path().join("opencode");
        write_script(&bin, FAKE);
        Self { dir }
    }

    fn run(&self, args: &[&str], stdin: &str, exit: u8) -> (Output, u32) {
        let mut child = Command::new(env!("CARGO_BIN_EXE_opencode-native"))
            .args(args)
            .env("OPENCODE_TS_BIN", self.dir.path().join("opencode"))
            .env("XDG_DATA_HOME", self.dir.path())
            .env("DELEGATE_DIR", self.dir.path())
            .env("DELEGATE_EXIT", exit.to_string())
            .env_remove("OPENCODE_PRINT_LOGS")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let pid = child.id();
        child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
        (child.wait_with_output().unwrap(), pid)
    }

    fn read(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.path().join(name)).unwrap_or_default()
    }
}

#[test]
fn every_delegated_command_gets_the_arguments_as_typed() {
    let fake = Fake::new();
    let cases: &[&[&str]] = &[
        &["uninstall", "--dry-run", "-f"],
        &["serve", "--port", "4096", "--cors", "a", "--cors", "b", "--service"],
        &["--log-level", "debug", "plugin", "list", "--builtin"],
        &["plugin", "add", "@scope/pkg@1"],
        &["plugin", "check", "pkg", "--server", "http://127.0.0.1:1"],
        &["plugin", "update"],
        &["plugin", "remove", "pkg"],
    ];
    for args in cases {
        let (output, _) = fake.run(args, "", 0);
        assert!(output.status.success(), "{args:?}: {output:?}");
        let recorded = fake.read("args");
        assert_eq!(recorded.lines().collect::<Vec<_>>(), *args);
    }
}

#[test]
fn the_child_keeps_the_process_stdio_and_exit_code() {
    let fake = Fake::new();
    let (output, pid) = fake.run(&["--print-logs", "plugin", "list"], "piped input\n", 7);
    assert_eq!(output.status.code(), Some(7));
    assert_eq!(String::from_utf8_lossy(&output.stdout), "piped input\n");
    // `--print-logs` prints this process's "cli starting" line before the TypeScript binary takes over.
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("message=\"cli starting\"") && stderr.ends_with("\nto stderr\n"), "{stderr}");
    // On Unix the TypeScript binary replaces the process, so `serve --service` registers this pid.
    assert_eq!(fake.read("pid").trim(), pid.to_string());
    assert_eq!(fake.read("env"), "print-logs=1\n");
}

// Expected (FT-11, js-npm, O-166): after the TypeScript binary added a TUI package to `cli.json`, `plugin add` says, while
// `OPENCODE_PLUGIN_JS` turns the JS host off, that `opencode-native` loads it on the JS host and how to turn that back
// on; with the JS host on, the default, it says nothing more, as TS, since the package loads from the cache the add
// filled. An add that changes nothing, or fails,
// says nothing more and keeps the exit code.
#[test]
fn adding_a_tui_package_says_how_opencode_native_loads_it() {
    let dir = opencode_util::temp::tempdir().unwrap();
    let config = dir.path().join("config");
    std::fs::create_dir_all(&config).unwrap();
    let bin = dir.path().join("opencode");
    write_script(
        &bin,
        r#"#!/bin/sh
[ "$3" = "fail" ] && exit 4
[ "$3" = "same" ] && exit 0
printf '{ "plugins": ["old-tui@1.0.0", "%s"] }\n' "$3" > "$OPENCODE_CONFIG_DIR/cli.json"
echo "TUI plugin \"$3\" installed and added to $OPENCODE_CONFIG_DIR/cli.json"
"#,
    );
    let run = |package: &str, js: Option<&str>| {
        std::fs::write(config.join("cli.json"), r#"{ "plugins": ["old-tui@1.0.0"] }"#).unwrap();
        let mut command = Command::new(env!("CARGO_BIN_EXE_opencode-native"));
        command
            .args(["plugin", "add", package])
            .env("OPENCODE_TS_BIN", &bin)
            .env("OPENCODE_CONFIG_DIR", &config)
            .env("XDG_DATA_HOME", dir.path())
            .env_remove("OPENCODE_PLUGIN_JS");
        if let Some(js) = js {
            command.env("OPENCODE_PLUGIN_JS", js);
        }
        command.output().unwrap()
    };
    let installed = "TUI plugin \"opencode-pulse-ticker@0.2.1\" installed";
    // A build without the `ts` feature never loads it, whatever the variable says (ts-feature).
    #[cfg(not(feature = "ts"))]
    for js in [None, Some("1"), Some("0")] {
        let output = run("opencode-pulse-ticker@0.2.1", js);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut lines = stdout.lines();
        assert!(output.status.success() && lines.next().is_some_and(|line| line.starts_with(installed)), "{stdout}");
        let warning = lines.next().unwrap_or_default();
        assert!(
            warning.starts_with(
                "opencode-native will not load TUI plugin \"opencode-pulse-ticker@0.2.1\": this build has no \
                 TypeScript plugin support"
            ),
            "{stdout}"
        );
        assert_eq!(lines.next(), None);
    }
    #[cfg(feature = "ts")]
    for off in ["0", "false", "off"] {
        let output = run("opencode-pulse-ticker@0.2.1", Some(off));
        assert!(output.status.success(), "{output:?}");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut lines = stdout.lines();
        assert!(lines.next().is_some_and(|line| line.starts_with(installed)));
        let warning = lines.next().unwrap_or_default();
        assert!(
            warning.starts_with(
                "opencode-native loads TUI plugin \"opencode-pulse-ticker@0.2.1\" on its JS host, which \
                 OPENCODE_PLUGIN_JS turns off: unset it"
            ),
            "{stdout}"
        );
        assert_eq!(lines.next(), None);
    }
    // On by default (O-166), and with any other value: nothing more, as TS.
    #[cfg(feature = "ts")]
    for on in [None, Some("1")] {
        let output = run("opencode-pulse-ticker@0.2.1", on);
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success() && stdout.lines().count() == 1 && stdout.starts_with(installed), "{stdout}");
    }
    let output = run("same", Some("0"));
    assert!(output.status.success() && output.stdout.is_empty(), "{output:?}");
    let output = run("fail", Some("0"));
    assert_eq!(output.status.code(), Some(4));
    assert!(output.stdout.is_empty(), "{output:?}");
}

#[test]
fn usage_errors_and_bare_plugin_never_start_the_binary() {
    let fake = Fake::new();
    let (output, _) = fake.run(&["upgrade", "--method", "apt"], "", 0);
    assert_eq!(output.status.code(), Some(1));
    let (output, _) = fake.run(&["plugin"], "", 0);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("Manage plugins"));
    assert!(!Path::new(&fake.dir.path().join("args")).exists());
}

// Expected (native-upgrade): `upgrade` runs nothing and exits 1. Beside a bundled `opencode` it says to run that
// `opencode upgrade`; with only an `opencode` on `PATH` or in `OPENCODE_TS_BIN`, this source build says to rebuild. In
// none of them does any `opencode` run, and its flags keep their errors.
#[test]
fn upgrade_runs_no_opencode() {
    let separate = Fake::new();
    let install = Install::new();
    let client = install.path().join("opencode-native");
    // A hard link, as the client finds what is beside its own real path; a copy where the link cannot be made.
    std::fs::hard_link(env!("CARGO_BIN_EXE_opencode-native"), &client)
        .or_else(|_| std::fs::copy(env!("CARGO_BIN_EXE_opencode-native"), &client).map(drop))
        .unwrap();
    // It records into `bundled`, the separate install into `args`, both in `DELEGATE_DIR`.
    write_script(&install.path().join("opencode"), &FAKE.replace("/args", "/bundled"));
    let run = |client: &Path, args: &[&str], ts_bin: bool, path: bool| {
        let mut command = Command::new(client);
        command
            .args(args)
            .env("XDG_DATA_HOME", separate.dir.path())
            .env("DELEGATE_DIR", install.path())
            .env("PATH", if path { std::env::join_paths([separate.dir.path()]).unwrap() } else { "".into() })
            .env_remove("OPENCODE_TS_BIN");
        if ts_bin {
            command.env("OPENCODE_TS_BIN", separate.dir.path().join("opencode"));
        }
        let output = command.output().unwrap();
        let ran = ["bundled", "args"].map(|name| install.path().join(name).exists());
        assert_eq!(ran, [false, false], "an opencode ran for {args:?}");
        output
    };
    let bundled = std::fs::canonicalize(install.path().join("opencode")).unwrap();
    let beside = format!(
        "This opencode-native is updated with the opencode installed beside it ({}): run `opencode upgrade`.\n",
        bundled.display()
    );
    let source = "This opencode-native is a source build; rebuild it to update it.\n\
                  `opencode upgrade` updates a separate TypeScript install, not this one.\n";
    let rows: [(&Path, &[&str], bool, bool, &str); 4] = [
        // Bundled, with a separate install in both lookups too.
        (&client, &["upgrade", "v1.2.3", "-m", "npm"], true, true, &beside),
        (&client, &["update", "--method=brew"], true, true, &beside),
        // `PATH` alone and `OPENCODE_TS_BIN` alone, with nothing beside the binary.
        (Path::new(env!("CARGO_BIN_EXE_opencode-native")), &["upgrade"], false, true, source),
        (Path::new(env!("CARGO_BIN_EXE_opencode-native")), &["upgrade"], true, false, source),
    ];
    for (client, args, ts_bin, path, expected) in rows {
        let output = run(client, args, ts_bin, path);
        assert_eq!(output.status.code(), Some(1), "{args:?}: {output:?}");
        assert_eq!(
            String::from_utf8_lossy(&output.stderr),
            expected,
            "{args:?}, OPENCODE_TS_BIN {ts_bin}, PATH {path}"
        );
        assert!(output.stdout.is_empty(), "{output:?}");
    }
    // A flag's error comes first, as in TS.
    let output = run(&client, &["upgrade", "--method", "apt"], true, true);
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("apt") && !stderr.contains("opencode-native is"), "{stderr}");
}

/// A new directory in cargo's target directory, on the file system of the test binaries, so they hard-link there.
struct Install(std::path::PathBuf);

impl Install {
    fn new() -> Self {
        let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("upgrade-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Install {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_missing_binary_says_how_to_fix_it() {
    let data = opencode_util::temp::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_opencode-native"))
        .args(["uninstall", "--dry-run"])
        .env("OPENCODE_TS_BIN", "/nonexistent/opencode")
        .env("XDG_DATA_HOME", data.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Failed to start /nonexistent/opencode: No such file or directory")
            && stderr.contains("set OPENCODE_TS_BIN"),
        "{stderr}"
    );
}

// Ctrl+C reaches the whole foreground group. The CLI waits for the TS command to finish its own teardown
// before it exits 130, so nothing it prints lands after the shell's prompt.
#[test]
fn an_interrupt_waits_for_the_remote_access_command() {
    use std::os::unix::process::CommandExt;
    let dir = opencode_util::temp::tempdir().unwrap();
    let bin = dir.path().join("opencode");
    write_script(
        &bin,
        "#!/bin/sh\ntrap 'sleep 0.5; echo done > \"$DELEGATE_DIR/teardown\"; exit 130' INT\necho > \"$DELEGATE_DIR/started\"\nwhile :; do sleep 0.05; done\n",
    );
    let mut child = Command::new(env!("CARGO_BIN_EXE_opencode-native"))
        .args(["service", "set", "remote", "true"])
        .env("OPENCODE_TS_BIN", &bin)
        .env("HOME", dir.path())
        .env("XDG_CONFIG_HOME", dir.path().join("config"))
        .env("XDG_DATA_HOME", dir.path().join("data"))
        .env("XDG_STATE_HOME", dir.path().join("state"))
        .env("DELEGATE_DIR", dir.path())
        .stdin(Stdio::null())
        .process_group(0)
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !dir.path().join("started").exists() {
        assert!(std::time::Instant::now() < deadline, "the fake never started");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let group = rustix::process::Pid::from_raw(child.id() as i32).unwrap();
    rustix::process::kill_process_group(group, rustix::process::Signal::INT).unwrap();
    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(130));
    assert_eq!(std::fs::read_to_string(dir.path().join("teardown")).unwrap_or_default(), "done\n");
}
