//! Discovery prefers the service the TypeScript binary runs (O-51), proven with real processes:
//! two copies of `sleep` stand for `opencode` and an older `opencode2`, and a local server answers
//! `/api/info` for each with its pid. The `opencode2` registration is the newest.
#![cfg(target_os = "linux")]

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, SystemTime};

use opencode_api::transport::Reqwest;
use opencode_local::paths::Paths;
use opencode_service::discover::{self, Owner, process_executable};
use opencode_service::ts_command::TsCommand;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct Killed(Child);

impl Drop for Killed {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// Starts a copy of `sleep` at `path`.
fn start(sleep: &Path, path: &Path) -> Killed {
    std::fs::copy(sleep, path).unwrap();
    Killed(Command::new(path).arg("60").spawn().unwrap())
}

// Answers every request with `/api/info` for `pid`; returns the URL.
async fn serve(pid: u32) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 4096];
            let _ = socket.read(&mut buffer).await;
            let body = format!(r#"{{"version":"1.0.0","pid":{pid}}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    url
}

fn register(state: &Path, name: &str, url: &str, pid: u32, age: u64) {
    let file = state.join(name);
    std::fs::write(&file, format!(r#"{{"url":"{url}","pid":{pid},"password":"p"}}"#)).unwrap();
    let time = SystemTime::now() - Duration::from_secs(age);
    std::fs::File::options().write(true).open(&file).unwrap().set_modified(time).unwrap();
}

fn sleep_binary() -> PathBuf {
    std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|dir| dir.join("sleep"))
        .find(|path| path.is_file())
        .expect("sleep on PATH")
}

#[tokio::test(flavor = "multi_thread")]
async fn prefers_the_service_of_the_typescript_binary_over_a_newer_one() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("state");
    std::fs::create_dir_all(dir.path().join("install")).unwrap();
    let sleep = sleep_binary();
    let ts = start(&sleep, &dir.path().join("install/opencode"));
    let other = start(&sleep, &dir.path().join("install/opencode2"));
    // The TS binary is reached through a symlink, as an installed `opencode` may be.
    let link = dir.path().join("opencode");
    std::os::unix::fs::symlink(dir.path().join("install/opencode"), &link).unwrap();
    assert_eq!(process_executable(ts.0.id()), Some(std::fs::canonicalize(&link).unwrap()));

    let paths = Paths::from_vars(|name| match name {
        "HOME" => Some(OsString::from(dir.path())),
        "XDG_STATE_HOME" => Some(state.clone().into_os_string()),
        _ => None,
    })
    .unwrap();
    std::fs::create_dir_all(&paths.state).unwrap();
    register(&paths.state, "service-v2.json", &serve(other.0.id()).await, other.0.id(), 0);
    register(&paths.state, "service-oc-next.json", &serve(ts.0.id()).await, ts.0.id(), 100);
    let transport = Reqwest::default();

    let found = discover::discover_with(&transport, &paths, None, &Owner::new(TsCommand::new(&link))).await.unwrap();
    assert_eq!(found.channel, "oc-next");
    assert_eq!(found.service.registration.pid, ts.0.id());
    // Another binary runs neither service, and its version is unknown: the newest wins.
    let missing = Owner::new(TsCommand::new(dir.path().join("missing")));
    assert_eq!(discover::discover_with(&transport, &paths, None, &missing).await.unwrap().channel, "v2");
}
