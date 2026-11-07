//! The event stream of a managed client recovers when its service crashes (review carbon-1). The crashed
//! service leaves its registration behind, so `ensure` waits the spawn delay (5 s) before it starts a
//! replacement: longer than the connect timeout (2 s) a stream attempt may take. The connection loop
//! must find the service between attempts, as TS `createClientConnection` runs `reconnect`.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::StreamExt;
use opencode_api::events::{self, Status};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::paths::Paths;
use opencode_local::registration;
use opencode_service::connect::{self, Env};
use opencode_service::follow;
use opencode_service::ts_command::write_script;
use opencode_store::connection::Events;
use tokio::sync::watch;

const OLD: u16 = 4096;
const NEW: u16 = 5000;

/// The old service on port 4096 until it dies, and its replacement on port 5000 once the contender
/// registered it.
struct Services {
    registration: PathBuf,
    alive: watch::Sender<bool>,
    streams: Mutex<Vec<u16>>,
}

impl Transport for Services {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let port = request.url.port().unwrap_or_default();
        let path = request.url.path().to_owned();
        Box::pin(async move {
            let pid = match port {
                OLD if *self.alive.borrow() => 9,
                NEW => match registration::read(&self.registration) {
                    Some(info) if info.url.ends_with(":5000") => info.pid,
                    _ => return Err("connection refused".to_owned()),
                },
                _ => return Err("connection refused".to_owned()),
            };
            match path.as_str() {
                "/api/info" => Ok(reply(
                    200,
                    "application/json",
                    format!(r#"{{"version":"2.0.0","pid":{pid},"urls":[],"paths":{{"tmp":"/tmp"}}}}"#),
                    futures_util::stream::empty().boxed(),
                )),
                "/api/event" => {
                    self.streams.lock().unwrap().push(port);
                    let mut alive = self.alive.subscribe();
                    let tail = match port {
                        OLD => futures_util::stream::once(async move {
                            let _ = alive.wait_for(|alive| !alive).await;
                            Err("connection reset".to_owned())
                        })
                        .boxed(),
                        _ => futures_util::stream::pending().boxed(),
                    };
                    Ok(reply(
                        200,
                        "text/event-stream",
                        "data: {\"id\":\"evt_1\",\"type\":\"server.connected\",\"data\":{}}\n\n".to_owned(),
                        tail,
                    ))
                }
                _ => Ok(reply(404, "application/json", "{}".to_owned(), futures_util::stream::empty().boxed())),
            }
        })
    }
}

fn reply(
    status: u16,
    content_type: &str,
    body: String,
    tail: futures_util::stream::BoxStream<'static, Result<Bytes, String>>,
) -> Response {
    Response {
        status,
        headers: vec![("content-type".to_owned(), content_type.to_owned())],
        body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))]).chain(tail)),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_event_stream_follows_a_service_that_crashed_and_was_replaced() {
    let dir = opencode_util::temp::tempdir().unwrap();
    let paths = Paths::from_vars(|name| match name {
        "HOME" => Some(OsString::from(dir.path())),
        "XDG_STATE_HOME" => Some(dir.path().join("state").into()),
        "XDG_CONFIG_HOME" => Some(dir.path().join("config").into()),
        _ => None,
    })
    .unwrap();
    std::fs::create_dir_all(&paths.state).unwrap();
    let file = paths.state.join("service-oc-x.json");
    std::fs::write(&file, format!(r#"{{"url":"http://127.0.0.1:{OLD}","pid":9,"password":"old"}}"#)).unwrap();
    // The contender registers the replacement under its own pid.
    let program = dir.path().join("opencode-ts");
    write_script(
        &program,
        &format!(
            "#!/bin/sh\nprintf '{{\"url\":\"http://127.0.0.1:{NEW}\",\"pid\":%s,\"password\":\"new\"}}' $$ > {0}.tmp\nmv {0}.tmp {0}\nexec sleep 30\n",
            file.display()
        ),
    );
    let services = Arc::new(Services {
        registration: file.clone(),
        alive: watch::channel(true).0,
        streams: Mutex::new(Vec::new()),
    });
    let env = Env {
        ts_bin: Some(program.to_string_lossy().into_owned()),
        channel: Some("oc-x".to_owned()),
        ..Env::default()
    };
    let connection = connect::resolve(services.clone(), &paths, &env, &connect::Options::default()).await.unwrap();
    let client = follow::client(services.clone(), &connection, &paths, &env).unwrap();
    let (connection, _batches) = events::connect(Events { client }, events::Options::default());
    let mut state = connection.watch();
    state.wait_for(|state| state.status == Status::Connected).await.unwrap();

    services.alive.send_replace(false);
    state.wait_for(|state| state.status != Status::Connected).await.unwrap();
    let started = Instant::now();
    let reconnected =
        tokio::time::timeout(Duration::from_secs(15), state.wait_for(|state| state.status == Status::Connected)).await;
    let replacement = registration::read(&file).filter(|info| info.pid != 9);
    if let Some(info) = &replacement {
        let _ = std::process::Command::new("kill").arg(info.pid.to_string()).status();
    }
    assert!(reconnected.is_ok(), "no reconnect after {:?}: {:?}", started.elapsed(), connection.history());
    assert!(replacement.is_some(), "no replacement service was started");
    assert_eq!(services.streams.lock().unwrap().last(), Some(&NEW));
}
