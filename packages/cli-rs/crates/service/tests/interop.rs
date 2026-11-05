//! Interop with the real TypeScript CLI, run from source: Rust `ensure` starts
//! `opencode serve --service`, and the TypeScript `opencode service status` in the same directories
//! sees it.
//!
//! Everything runs in a temporary `HOME`, `XDG_*`, and `OPENCODE_CONFIG_DIR`, on a free port. The
//! TypeScript CLI runs under `env -i`, so nothing of this machine's environment reaches it, and it
//! never sees the user's state directories or service. Every process is killed at the end.
//!
//! Needs `bun` and a TypeScript checkout with `node_modules`: `OPENCODE_TS_ROOT`, else this
//! repository. Without them the test passes with a note.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::transport::Reqwest;
use opencode_service::ensure::{self, Options, Timing};
use opencode_service::ts_command::TsCommand;
use rustix::process::{Pid, Signal, kill_process, test_kill_process};

fn ts_root() -> Option<PathBuf> {
    let root = std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.."));
    let ready = root.join("node_modules").is_dir() && root.join("packages/cli/src/index.ts").is_file();
    if !ready {
        eprintln!("skipped: no TypeScript checkout with node_modules; set OPENCODE_TS_ROOT");
    }
    ready.then_some(root)
}

struct Isolation {
    root: tempfile::TempDir,
}

impl Isolation {
    fn path(&self, part: &str) -> PathBuf {
        self.root.path().join(part)
    }

    // The TypeScript CLI from source, with only the isolated environment.
    fn wrapper(&self, ts_root: &Path) -> PathBuf {
        let vars = [
            ("HOME", self.path("home")),
            ("XDG_STATE_HOME", self.path("state")),
            ("XDG_CONFIG_HOME", self.path("config")),
            ("XDG_DATA_HOME", self.path("data")),
            ("XDG_CACHE_HOME", self.path("cache")),
            ("OPENCODE_CONFIG_DIR", self.path("config/opencode")),
        ]
        .map(|(name, value)| format!("{name}='{}'", value.display()))
        .join(" ");
        let script = format!(
            "#!/bin/sh\ncd '{}/packages/cli' || exit 1\nexec env -i PATH=\"$PATH\" {vars} OPENCODE_DISABLE_MODELS_FETCH=1 bun run src/index.ts \"$@\"\n",
            ts_root.display()
        );
        let wrapper = self.path("opencode-ts");
        std::fs::write(&wrapper, script).unwrap();
        let mut permissions = std::fs::metadata(&wrapper).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
        std::fs::set_permissions(&wrapper, permissions).unwrap();
        wrapper
    }
}

impl Drop for Isolation {
    fn drop(&mut self) {
        let needle = self.root.path().as_os_str().as_encoded_bytes().to_vec();
        let pids: Vec<i32> = std::fs::read_dir("/proc")
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let pid = entry.file_name().to_str()?.parse().ok()?;
                let cmdline = std::fs::read(entry.path().join("cmdline")).ok()?;
                let cwd = std::fs::read_link(entry.path().join("cwd")).ok()?;
                let named = cmdline.windows(needle.len()).any(|window| window == needle.as_slice());
                (named || cwd.starts_with(self.root.path())).then_some(pid)
            })
            .collect();
        for pid in pids.iter().filter_map(|pid| Pid::from_raw(*pid)) {
            let _ = kill_process(pid, Signal::KILL);
        }
    }
}

fn stop(pid: u32) {
    let Some(pid) = Pid::from_raw(pid as i32) else {
        return;
    };
    let _ = kill_process(pid, Signal::TERM);
    for _ in 0..200 {
        if test_kill_process(pid).is_err() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let _ = kill_process(pid, Signal::KILL);
}

#[tokio::test(flavor = "multi_thread")]
async fn typescript_service_status_sees_a_service_rust_started() {
    let Some(ts_root) = ts_root() else {
        return;
    };
    let isolation = Isolation { root: tempfile::tempdir().unwrap() };
    for dir in ["home", "state/opencode", "config/opencode", "data", "cache"] {
        std::fs::create_dir_all(isolation.path(dir)).unwrap();
    }
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    // A source build is channel `local`: its service config is `service-local.json`.
    std::fs::write(isolation.path("config/opencode/service-local.json"), format!("{{\"port\":{port}}}\n")).unwrap();
    let wrapper = isolation.wrapper(&ts_root);
    let state = isolation.path("state/opencode");
    let mut options = Options::new(state.join("service.json"), state.clone(), &TsCommand::new(&wrapper));
    options.timing = Timing { deadline: Duration::from_secs(60), ..Timing::default() };
    let mut started = 0;
    let ensured = ensure::ensure(Arc::new(Reqwest::default()), &options, &mut || started += 1).await.unwrap();
    let pid = ensured.service.registration.pid;
    let status = Command::new(&wrapper).args(["service", "status"]).output().unwrap();
    let printed = String::from_utf8_lossy(&status.stdout).trim().to_owned();
    eprintln!(
        "rust started: url={} pid={pid} file={} version={:?}",
        ensured.service.endpoint.url,
        ensured.file.display(),
        ensured.service.version
    );
    eprintln!("typescript `service status`: {printed}");
    stop(pid);
    assert_eq!(started, 1);
    assert_eq!(ensured.file, state.join("service-local.json"));
    assert_eq!(ensured.service.endpoint.url, format!("http://127.0.0.1:{port}"));
    assert_eq!(printed, ensured.service.endpoint.url);
}
