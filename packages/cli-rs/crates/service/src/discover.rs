//! Registration discovery (F.6).
//!
//! The TypeScript client reads the registration of its build channel and probes it
//! (`discover`, `packages/client/src/effect/service.ts:25-31`). The Rust client has no build
//! channel, and the installed `opencode` may be a preview channel with its own file, so it tries
//! several registrations in order (decision O-21):
//!
//! 1. the registration of `OPENCODE_CHANNEL`, when set;
//! 2. the registration of the client's own channel ([`channel::DEFAULT`]);
//! 3. every other `service*.json` in the state directory, newest first.
//!
//! The first ready, compatible service wins. Discovery only reads: it never migrates, replaces, or
//! stops a service.

use std::path::{Path, PathBuf};

use futures_util::future::join_all;
use opencode_api::transport::Transport;
use opencode_local::channel;
use opencode_local::paths::Paths;
use opencode_local::registration;

use crate::probe::{self, Decision, LocalService, REQUEST_TIMEOUT};

/// A service discovery found, and where it was registered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub service: LocalService,
    pub file: PathBuf,
    /// The channel the file name stands for: `latest` for `service.json`, else the part after
    /// `service-` (a legacy file shows its hash).
    pub channel: String,
}

/// Why no candidate was usable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Missing {
    /// Why the first registration that answered or timed out could not be used, if any (such as
    /// "Background service failed to start").
    pub reason: Option<String>,
    /// The first registration of a live service that is not ready yet: it answered that it is
    /// starting, or it did not answer in time. A client waits on it instead of starting a service
    /// beside it. When this is `None`, a `reason` is final: the service failed or is incompatible.
    pub pending: Option<PathBuf>,
}

/// Discovers a ready, compatible service. `env_channel` is `OPENCODE_CHANNEL`.
pub async fn discover(
    transport: &dyn Transport,
    paths: &Paths,
    env_channel: Option<&str>,
) -> Result<Found, Missing> {
    let preferred = preferred(paths, env_channel);
    let mut missing = Missing {
        reason: None,
        pending: None,
    };
    for file in &preferred {
        match usable(transport, file).await {
            Ok(found) => return Ok(found),
            Err(unusable) => missing.add(file, unusable),
        }
    }
    let scanned = scan(&paths.state, &preferred);
    // Probes run together so that unresponsive registrations cost one timeout, not one each.
    let results = join_all(scanned.iter().map(|file| usable(transport, file))).await;
    for (file, result) in scanned.iter().zip(results) {
        match result {
            Ok(found) => return Ok(found),
            Err(unusable) => missing.add(file, unusable),
        }
    }
    Err(missing)
}

impl Missing {
    fn add(&mut self, file: &Path, unusable: Unusable) {
        let reason = match unusable {
            Unusable::Gone => return,
            Unusable::Pending(reason) => {
                self.pending.get_or_insert_with(|| file.to_owned());
                reason
            }
            Unusable::Failed(reason) => reason,
        };
        self.reason.get_or_insert(reason);
    }
}

/// The registration files of `OPENCODE_CHANNEL` and of the default channel, without duplicates.
pub fn preferred(paths: &Paths, env_channel: Option<&str>) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = env_channel
        .filter(|channel| !channel.is_empty())
        .into_iter()
        .chain([channel::DEFAULT])
        .map(|channel| registration::Files::new(paths, channel).file)
        .collect();
    files.dedup();
    files
}

/// Every `service*.json` in `state` not in `skip`, newest first.
pub fn scan(state: &Path, skip: &[PathBuf]) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(state) else {
        return Vec::new();
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("service") && name.ends_with(".json")
        })
        .filter(|entry| !skip.contains(&entry.path()))
        .filter_map(|entry| {
            let metadata = entry.metadata().ok().filter(std::fs::Metadata::is_file)?;
            Some((metadata.modified().ok()?, entry.path()))
        })
        .collect();
    files.sort_by(|left, right| right.cmp(left));
    files.into_iter().map(|(_, file)| file).collect()
}

/// The channel a registration file name stands for.
pub fn channel_of(file: &Path) -> String {
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    match name
        .strip_prefix("service-")
        .and_then(|rest| rest.strip_suffix(".json"))
    {
        Some(channel) => channel.to_owned(),
        None => channel::DEFAULT.to_owned(),
    }
}

// Why a registration is not usable.
enum Unusable {
    /// No registration, or no process answers for it.
    Gone,
    /// Starting, or registered and not answering in time.
    Pending(String),
    /// Failed to start, or incompatible.
    Failed(String),
}

// The service registered in `file` when it is ready and compatible.
async fn usable(transport: &dyn Transport, file: &Path) -> Result<Found, Unusable> {
    let registration = registration::read(file).ok_or(Unusable::Gone)?;
    let probe = probe::probe(transport, &registration, REQUEST_TIMEOUT).await;
    if probe.timed_out {
        return Err(Unusable::Pending(format!(
            "Background service at {} is not responding",
            registration.url
        )));
    }
    let service = probe.service.ok_or(Unusable::Gone)?;
    match probe::decide(&service, None) {
        Decision::Reuse => Ok(Found {
            service,
            file: file.to_owned(),
            channel: channel_of(file),
        }),
        Decision::Wait => Err(Unusable::Pending(format!(
            "Background service at {} is still starting",
            service.endpoint.url
        ))),
        Decision::Fail(reason) => Err(Unusable::Failed(reason)),
        Decision::Replace { .. } => unreachable!("no version requirement"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{Reply, Server};
    use std::ffi::OsString;
    use std::time::{Duration, SystemTime};

    fn paths(root: &Path) -> Paths {
        let state = root.join("state").into_os_string();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(OsString::from(root)),
            "XDG_STATE_HOME" => Some(state.clone()),
            _ => None,
        })
        .unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        paths
    }

    // Writes a registration for `port` with pid `port`, `age` seconds old.
    fn register(paths: &Paths, name: &str, port: u16, age: u64) {
        let file = paths.state.join(name);
        std::fs::write(
            &file,
            format!(r#"{{"url":"http://127.0.0.1:{port}","pid":{port},"password":"p"}}"#),
        )
        .unwrap();
        let time = SystemTime::now() - Duration::from_secs(age);
        std::fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(time)
            .unwrap();
    }

    fn ready(port: u16) -> (String, Reply) {
        let body = format!(r#"{{"version":"1.0.0","pid":{port}}}"#).leak();
        (
            format!("http://127.0.0.1:{port}/api/info"),
            Reply::json(200, body),
        )
    }

    fn server(replies: impl IntoIterator<Item = (String, Reply)>) -> Server {
        replies
            .into_iter()
            .fold(Server::default(), |server, (url, reply)| {
                server.reply(&url, reply)
            })
    }

    async fn found(server: &Server, paths: &Paths, env: Option<&str>) -> Result<String, Missing> {
        discover(server, paths, env)
            .await
            .map(|found| found.channel)
    }

    #[tokio::test]
    async fn prefers_the_env_channel_then_the_default_channel() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path());
        register(&paths, "service.json", 1001, 50);
        register(&paths, "service-oc-x.json", 1002, 100);
        register(&paths, "service-oc-new.json", 1003, 0);
        let all = server([ready(1001), ready(1002), ready(1003)]);
        assert_eq!(found(&all, &paths, Some("oc-x")).await.unwrap(), "oc-x");
        assert_eq!(found(&all, &paths, None).await.unwrap(), "latest");
        // `dev` shares `service.json`.
        assert_eq!(found(&all, &paths, Some("dev")).await.unwrap(), "latest");
    }

    #[tokio::test]
    async fn falls_back_to_the_newest_answering_registration() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path());
        register(&paths, "service.json", 1001, 0);
        register(&paths, "service-oc-old.json", 1002, 200);
        register(&paths, "service-oc-dead.json", 1003, 10);
        register(&paths, "service-oc-mid.json", 1004, 100);
        std::fs::write(paths.state.join("service.json.identity"), "{}").unwrap();
        std::fs::write(paths.state.join("service-oc-bad.json"), "{").unwrap();
        let live = server([ready(1002), ready(1004)]);
        assert_eq!(
            found(&live, &paths, Some("oc-gone")).await.unwrap(),
            "oc-mid"
        );
        // The scan probes the dead and newer registration too, but takes the newest that answered.
        let probed: Vec<String> = live.requests().into_iter().map(|(url, _)| url).collect();
        assert!(probed.contains(&"http://127.0.0.1:1003/api/info".to_owned()));
    }

    #[tokio::test]
    async fn reports_why_an_answering_service_was_not_used() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path());
        assert_eq!(
            found(&Server::default(), &paths, None).await,
            Err(Missing {
                reason: None,
                pending: None
            })
        );
        register(&paths, "service.json", 1001, 0);
        let failed = server([(
            "http://127.0.0.1:1001/api/info".to_owned(),
            Reply::json(500, r#"{"version":"1.0.0","pid":1001}"#),
        )]);
        assert_eq!(
            found(&failed, &paths, None).await,
            Err(Missing {
                reason: Some("Background service failed to start".to_owned()),
                pending: None
            })
        );
    }

    // Paused time: the hanging probe times out without waiting.
    #[tokio::test(start_paused = true)]
    async fn a_starting_or_unresponsive_registration_is_pending() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path());
        register(&paths, "service-oc-x.json", 1002, 0);
        let starting = server([(
            "http://127.0.0.1:1002/api/info".to_owned(),
            Reply::json(503, r#"{"version":"1.0.0","pid":1002}"#),
        )]);
        assert_eq!(
            found(&starting, &paths, None).await,
            Err(Missing {
                reason: Some(
                    "Background service at http://127.0.0.1:1002 is still starting".to_owned()
                ),
                pending: Some(paths.state.join("service-oc-x.json"))
            })
        );
        let hanging = server([("http://127.0.0.1:1002/api/info".to_owned(), Reply::Hang)]);
        assert_eq!(
            found(&hanging, &paths, None).await,
            Err(Missing {
                reason: Some(
                    "Background service at http://127.0.0.1:1002 is not responding".to_owned()
                ),
                pending: Some(paths.state.join("service-oc-x.json"))
            })
        );
        // A starting service anywhere wins over a failed one in a preferred registration.
        register(&paths, "service.json", 1001, 0);
        let both = server([
            (
                "http://127.0.0.1:1001/api/info".to_owned(),
                Reply::json(500, r#"{"version":"1.0.0","pid":1001}"#),
            ),
            (
                "http://127.0.0.1:1002/api/info".to_owned(),
                Reply::json(503, r#"{"version":"1.0.0","pid":1002}"#),
            ),
        ]);
        let missing = found(&both, &paths, None).await.unwrap_err();
        assert_eq!(missing.pending, Some(paths.state.join("service-oc-x.json")));
    }

    #[test]
    fn channel_names() {
        assert_eq!(channel_of(Path::new("/s/service.json")), "latest");
        assert_eq!(channel_of(Path::new("/s/service-oc-x.json")), "oc-x");
    }
}
