//! `service` and `pair` (C.8, C.9) against a fake TypeScript binary, run as the real `opencode-rs` in a temporary
//! `HOME` and XDG roots with `OPENCODE_CHANNEL=local`.
//!
//! The fake binary (`OPENCODE_TS_BIN`) answers the two commands the Rust client runs: `serve --service` starts a
//! small Bun service that registers itself like the TS one and logs its requests, and `service set remote true`
//! writes a route and an OpenTunnel identity as the TS command and the SDK would, without any network. Every process
//! started here is killed at the end. Needs `bun`; without it the tests pass with a note.

use std::path::PathBuf;
use std::process::{Command, Output};

const SERVICE: &str = r#"
import { appendFile, rename, writeFile } from "node:fs/promises"
const [registration, log] = process.argv.slice(2)
const urls = (process.env.FAKE_URLS ?? "").split(",").filter(Boolean)
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    await appendFile(log, `${process.pid} ${request.method} ${path}\n`)
    if (path === "/api/info")
      return Response.json({ version: "fake", pid: process.pid, urls: [...urls, server.url.origin], paths: { tmp: "/tmp" } })
    if (path === "/api/experimental/persistent-pty/shutdown") return new Response(null, { status: 204 })
    if (path === "/api/pair") return Response.json({ code: "CODE7", expires_in: 300 })
    return new Response(null, { status: 404 })
  },
})
process.on("SIGTERM", async () => {
  await appendFile(log, `${process.pid} SIGTERM\n`)
  process.exit(0)
})
await writeFile(registration + ".tmp", JSON.stringify({ id: crypto.randomUUID(), version: "fake", url: server.url.origin, pid: process.pid, password: "private" }))
await rename(registration + ".tmp", registration)
"#;

struct Sandbox {
    root: tempfile::TempDir,
}

impl Sandbox {
    fn new() -> Option<Self> {
        if Command::new("bun").arg("--version").output().is_err() {
            eprintln!("skipped: bun is not on PATH");
            return None;
        }
        let sandbox = Self {
            root: tempfile::tempdir().unwrap(),
        };
        for dir in [
            "home",
            "state/opencode",
            "config/opencode",
            "data",
            "cache",
            "work",
        ] {
            std::fs::create_dir_all(sandbox.path(dir)).unwrap();
        }
        std::fs::write(sandbox.path("service.ts"), SERVICE).unwrap();
        let script = format!(
            r#"#!/bin/sh
echo "$*" >> '{log}'
case "$*" in
  "serve --service") exec bun '{service}' '{registration}' '{log}' ;;
  "service set remote true")
    mkdir -p '{data}/opentunnel/default'
    printf '{{"hostname":"t1.tunnel.test","id":"t","certificateExpiry":"2099-01-01T00:00:00.000Z"}}' > '{data}/opentunnel/default/tunnel.json'
    for name in token private-key.pem certificate.pem; do printf x > "{data}/opentunnel/default/$name"; done
    : > '{data}/opentunnel/default/chain.pem'
    config='{config}'
    if [ -f "$config" ]; then body=$(sed 's/}}$//' "$config" | tr -d '\n'); else body='{{'; fi
    case "$body" in "{{") sep="" ;; *) sep="," ;; esac
    printf '%s%s"remote":{{"route":"r0ute"}}}}\n' "$body" "$sep" > "$config"
    ;;
  *) exit 9 ;;
esac
"#,
            log = sandbox.path("log").display(),
            service = sandbox.path("service.ts").display(),
            registration = sandbox.path("state/opencode/service-local.json").display(),
            data = sandbox.path("data").display(),
            config = sandbox.path("config/opencode/service-local.json").display(),
        );
        let program = sandbox.path("opencode-ts");
        std::fs::write(&program, script).unwrap();
        let mut permissions = std::fs::metadata(&program).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
        std::fs::set_permissions(&program, permissions).unwrap();
        Some(sandbox)
    }

    fn path(&self, part: &str) -> PathBuf {
        self.root.path().join(part)
    }

    fn run(&self, args: &[&str], env: &[(&str, &str)]) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_opencode-rs"));
        command
            .args(args)
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", self.path("home"))
            .env("XDG_STATE_HOME", self.path("state"))
            .env("XDG_CONFIG_HOME", self.path("config"))
            .env("XDG_DATA_HOME", self.path("data"))
            .env("XDG_CACHE_HOME", self.path("cache"))
            .env("OPENCODE_CONFIG_DIR", self.path("config/opencode"))
            .env("OPENCODE_CHANNEL", "local")
            .env("OPENCODE_CLI_NAME", "opencode")
            .env("OPENCODE_TS_BIN", self.path("opencode-ts"))
            .current_dir(self.path("work"));
        for (name, value) in env {
            command.env(name, value);
        }
        command.output().unwrap()
    }

    fn log(&self) -> String {
        std::fs::read_to_string(self.path("log")).unwrap_or_default()
    }

    fn registration(&self) -> Option<serde_json::Value> {
        let text = std::fs::read_to_string(self.path("state/opencode/service-local.json")).ok()?;
        serde_json::from_str(&text).ok()
    }

    fn config(&self) -> serde_json::Value {
        let text = std::fs::read_to_string(self.path("config/opencode/service-local.json"))
            .unwrap_or_else(|_| "{}".into());
        serde_json::from_str(&text).unwrap()
    }

    // Lines of the request log from the service with this pid.
    fn requests(&self, pid: u64) -> Vec<String> {
        let prefix = format!("{pid} ");
        self.log()
            .lines()
            .filter_map(|line| line.strip_prefix(&prefix).map(str::to_owned))
            .filter(|line| line != "GET /api/info")
            .collect()
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let needle = self.root.path().as_os_str().as_encoded_bytes().to_vec();
        for entry in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|pid| pid.parse::<i32>().ok())
            else {
                continue;
            };
            let named = std::fs::read(entry.path().join("cmdline")).is_ok_and(|cmdline| {
                cmdline
                    .windows(needle.len())
                    .any(|window| window == needle.as_slice())
            });
            if named && let Some(pid) = rustix::process::Pid::from_raw(pid) {
                let _ = rustix::process::kill_process(pid, rustix::process::Signal::KILL);
            }
        }
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn pid(registration: &serde_json::Value) -> u64 {
    registration["pid"].as_u64().unwrap()
}

#[test]
fn start_status_stop_and_restart() {
    let Some(sandbox) = Sandbox::new() else {
        return;
    };
    let status = sandbox.run(&["service", "status"], &[]);
    assert_eq!(text(&status.stdout), "stopped\n");

    let start = sandbox.run(&["service", "start"], &[]);
    assert!(start.status.success(), "{}", text(&start.stderr));
    let first = sandbox.registration().unwrap();
    assert_eq!(text(&start.stdout), format!("{}\n", first["url"].as_str().unwrap()));
    // A second start reuses the running service.
    let again = sandbox.run(&["service", "start"], &[]);
    assert_eq!(again.stdout, start.stdout);
    assert_eq!(sandbox.log().matches("serve --service").count(), 1);
    assert_eq!(text(&sandbox.run(&["service", "status"], &[]).stdout), text(&start.stdout));

    // Restart: the persistent terminals end, then SIGTERM, then a new service.
    let restart = sandbox.run(&["service", "restart"], &[]);
    assert!(restart.status.success(), "{}", text(&restart.stderr));
    let second = sandbox.registration().unwrap();
    assert_ne!(pid(&second), pid(&first));
    assert_eq!(text(&restart.stdout), format!("{}\n", second["url"].as_str().unwrap()));
    assert_eq!(
        sandbox.requests(pid(&first)),
        ["POST /api/experimental/persistent-pty/shutdown", "SIGTERM"]
    );

    let stop = sandbox.run(&["service", "stop"], &[]);
    assert!(stop.status.success(), "{}", text(&stop.stderr));
    assert_eq!(text(&stop.stdout), "");
    assert!(sandbox.registration().is_none());
    assert_eq!(
        sandbox.requests(pid(&second)),
        ["POST /api/experimental/persistent-pty/shutdown", "SIGTERM"]
    );
    assert_eq!(text(&sandbox.run(&["service", "status"], &[]).stdout), "stopped\n");
}

#[test]
fn set_stops_the_service_without_ending_terminals() {
    let Some(sandbox) = Sandbox::new() else {
        return;
    };
    assert!(sandbox.run(&["service", "start"], &[]).status.success());
    let first = sandbox.registration().unwrap();
    // `set disabled false` does not stop the service.
    assert!(sandbox.run(&["service", "set", "disabled", "false"], &[]).status.success());
    assert!(sandbox.registration().is_some());
    let set = sandbox.run(&["service", "set", "port", "5000"], &[]);
    assert!(set.status.success(), "{}", text(&set.stderr));
    assert!(sandbox.registration().is_none());
    assert_eq!(sandbox.requests(pid(&first)), ["SIGTERM"]);
    assert_eq!(sandbox.config(), serde_json::json!({ "disabled": false, "port": 5000 }));
}

#[test]
fn set_remote_true_runs_the_typescript_command() {
    let Some(sandbox) = Sandbox::new() else {
        return;
    };
    let set = sandbox.run(&["service", "set", "remote", "true"], &[]);
    assert!(set.status.success(), "{}", text(&set.stderr));
    assert_eq!(sandbox.log(), "service set remote true\n");
    assert_eq!(text(&sandbox.run(&["service", "get", "remote"], &[]).stdout), "true\n");
    // A failure of the TS command is the exit code.
    std::fs::write(sandbox.path("opencode-ts"), "#!/bin/sh\necho tunnel failed >&2\nexit 4\n").unwrap();
    let failed = sandbox.run(&["service", "set", "remote", "true"], &[]);
    assert_eq!(failed.status.code(), Some(4));
    assert_eq!(text(&failed.stderr), "tunnel failed\n");
}

#[test]
fn pair_remote_enables_remote_access_and_waits_for_the_tunnel() {
    let Some(sandbox) = Sandbox::new() else {
        return;
    };
    let pair = sandbox.run(
        &["pair", "--remote", "--yes"],
        &[("FAKE_URLS", "https://r0ute.t1.tunnel.test")],
    );
    assert!(pair.status.success(), "{}", text(&pair.stderr));
    let stdout = text(&pair.stdout);
    // `--yes` still shows the warning, then the tunnel link with its QR code.
    assert!(stdout.contains("This will expose your OpenCode server to the internet."), "{stdout}");
    assert!(stdout.contains("expire in 5 minutes."), "{stdout}");
    assert!(stdout.contains("  https://r0ute.t1.tunnel.test/auth/connect/CODE7\n\n  ██"), "{stdout}");
    assert!(!stdout.contains("127.0.0.1"), "{stdout}");
    assert_eq!(text(&pair.stderr), "");
    assert_eq!(
        // The fake binary's arguments; the service's request lines start with its pid.
        sandbox
            .log()
            .lines()
            .filter(|line| !line.starts_with(|c: char| c.is_ascii_digit()))
            .collect::<Vec<_>>(),
        ["service set remote true", "serve --service"]
    );
    assert_eq!(
        sandbox.config(),
        serde_json::json!({ "remoteAccepted": true, "remote": { "route": "r0ute" } })
    );
    // Accepted once: a second pair does not ask, and remote access is already on.
    let again = sandbox.run(&["pair", "--remote"], &[("FAKE_URLS", "https://r0ute.t1.tunnel.test")]);
    assert!(again.status.success(), "{}", text(&again.stderr));
    assert!(!text(&again.stdout).contains("This will expose"));
    assert_eq!(sandbox.log().matches("service set remote true").count(), 1);
}

#[test]
fn pair_prints_links_and_the_ssh_hint() {
    let Some(sandbox) = Sandbox::new() else {
        return;
    };
    let pair = sandbox.run(&["pair"], &[]);
    assert!(pair.status.success(), "{}", text(&pair.stderr));
    let url = sandbox.registration().unwrap()["url"].as_str().unwrap().to_owned();
    let port = url.rsplit(':').next().unwrap();
    assert_eq!(
        text(&pair.stdout),
        format!(
            "\n  Open a link to connect. Links work once and expire in 5 minutes.\n\n  {url}/auth/connect/CODE7\n\n"
        )
    );
    assert!(
        text(&pair.stderr).contains(&format!("  ssh -L {port}:127.0.0.1:{port} <host>\n")),
        "{}",
        text(&pair.stderr)
    );
    let pid = pid(&sandbox.registration().unwrap());
    assert_eq!(sandbox.requests(pid), ["POST /api/pair"]);
}

// Interop with the real TS CLI from source, in the same sandbox: a service TS started is seen, stopped, and
// restarted by Rust, and the other way round. The TS CLI runs under `env -i` with only the sandbox's variables,
// on a free port from its service config. Needs a TS checkout with `node_modules` (`OPENCODE_TS_ROOT`, else this
// repository); without one the test passes with a note.
#[test]
fn interop_with_a_typescript_service() {
    let root = std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../..")));
    if !root.join("node_modules").is_dir() || !root.join("packages/cli/src/index.ts").is_file() {
        eprintln!("skipped: no TypeScript checkout with node_modules; set OPENCODE_TS_ROOT");
        return;
    }
    let Some(sandbox) = Sandbox::new() else {
        return;
    };
    let vars = [
        ("HOME", "home"),
        ("XDG_STATE_HOME", "state"),
        ("XDG_CONFIG_HOME", "config"),
        ("XDG_DATA_HOME", "data"),
        ("XDG_CACHE_HOME", "cache"),
        ("OPENCODE_CONFIG_DIR", "config/opencode"),
    ]
    .map(|(name, dir)| format!("{name}='{}'", sandbox.path(dir).display()))
    .join(" ");
    let wrapper = sandbox.path("opencode-ts-source");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\ncd '{}/packages/cli' || exit 1\nexec env -i PATH=\"$PATH\" {vars} OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 bun run --silent src/index.ts \"$@\"\n",
            root.display()
        ),
    )
    .unwrap();
    let mut permissions = std::fs::metadata(&wrapper).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
    std::fs::set_permissions(&wrapper, permissions).unwrap();
    let free_port = || {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    };
    let port = free_port();
    std::fs::write(
        sandbox.path("config/opencode/service-local.json"),
        format!("{{\"port\":{port}}}\n"),
    )
    .unwrap();
    let ts = |args: &[&str]| {
        let output = Command::new(&wrapper).args(args).output().unwrap();
        assert!(output.status.success(), "ts {args:?}: {}", text(&output.stderr));
        text(&output.stdout)
    };
    let ts_bin = wrapper.to_str().unwrap();
    let rs = |args: &[&str]| {
        let output = sandbox.run(args, &[("OPENCODE_TS_BIN", ts_bin)]);
        assert!(output.status.success(), "rs {args:?}: {}", text(&output.stderr));
        text(&output.stdout)
    };
    let url = format!("http://127.0.0.1:{port}\n");

    assert_eq!(ts(&["service", "start"]), url);
    let started = pid(&sandbox.registration().unwrap());
    assert_eq!(rs(&["service", "status"]), url);
    assert_eq!(rs(&["service", "stop"]), "");
    assert_eq!(ts(&["service", "status"]), "stopped\n");
    assert!(!std::path::Path::new(&format!("/proc/{started}")).exists());
    eprintln!("ts start, rs stop: pid {started} stopped");

    assert_eq!(rs(&["service", "start"]), url);
    let rust_started = pid(&sandbox.registration().unwrap());
    assert_eq!(ts(&["service", "status"]), url);
    assert_eq!(rs(&["service", "restart"]), url);
    let restarted = pid(&sandbox.registration().unwrap());
    assert_ne!(restarted, rust_started);
    assert_eq!(ts(&["service", "status"]), url);
    eprintln!("rs start: pid {rust_started}; rs restart: pid {restarted}; ts status: {}", url.trim());

    let moved = free_port();
    assert_eq!(rs(&["service", "set", "port", &moved.to_string()]), "");
    assert_eq!(ts(&["service", "status"]), "stopped\n");
    assert_eq!(ts(&["service", "get", "port"]), format!("{moved}\n"));
    assert_eq!(ts(&["service", "set", "hostname", "127.0.0.1"]), "");
    assert_eq!(rs(&["service", "get"]), ts(&["service", "get"]));
    assert_eq!(rs(&["service", "get", "password"]), ts(&["service", "get", "password"]));

    assert_eq!(rs(&["service", "start"]), format!("http://127.0.0.1:{moved}\n"));
    assert_eq!(ts(&["service", "stop"]), "");
    assert_eq!(rs(&["service", "status"]), "stopped\n");
    eprintln!("rs set port {moved}, ts get port, rs start there, ts stop: ok");
}
