//! Opt-in live test (`OPENCODE_LIVE=1`): the store connects to the running service's event stream,
//! rehydrates session status on `server.connected`, reads sessions and one transcript, and prints
//! the counts. The URL and password come from `opencode service status` and
//! `opencode service get password`, as `script/live.sh` does. Reads only.

use std::time::{Duration, Instant};

use opencode_api::client::{Auth, Client};
use opencode_api::events::{self, Status};
use opencode_api::generated::*;
use opencode_store::{Data, Options};

fn command(args: &[&str]) -> String {
    let output = std::process::Command::new("opencode").args(args).output().expect("opencode runs");
    assert!(output.status.success(), "opencode {args:?} failed");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test(flavor = "multi_thread")]
async fn live_store_rehydrates_and_reads() {
    if std::env::var("OPENCODE_LIVE").as_deref() != Ok("1") {
        return;
    }
    let server = command(&["service", "status"]);
    let client = Client::new(&server).unwrap().auth(Auth::password(command(&["service", "get", "password"])));
    let data = Data::new(client.clone(), Options::default());
    data.on_error(|error| eprintln!("live: refresh failed: {error}"));

    let (connection, _task) = opencode_store::connection::connect(&data, events::Options::default());
    let mut state = connection.watch();
    tokio::time::timeout(Duration::from_secs(5), state.wait_for(|state| state.status == Status::Connected))
        .await
        .expect("connects within 5 s")
        .unwrap();
    // `server.connected` starts the `session.active` read; it records running sessions.
    let connected = Instant::now();
    let mut changes = data.subscribe();
    let _ = tokio::time::timeout(Duration::from_secs(2), changes.changed()).await;
    let running = data.read(|state| state.active_sessions().len());

    let page = client.session_list(&SessionListInput { limit: Some(20), ..Default::default() }).await.unwrap();
    for session in &page.data {
        data.session_sync(&session.id, false).await.unwrap();
    }
    let sessions = data.read(|state| state.sessions().len());
    let first = data.read(|state| state.sessions().first().map(|info| info.id.clone()));
    let first = first.expect("the service has sessions");
    data.message_sync(&first).await.unwrap();
    let (messages, more, title) = data.read(|state| {
        (
            state.messages(&first).len(),
            state.has_more_messages(&first),
            state.session(&first).and_then(|info| info.title.clone()).unwrap_or_default(),
        )
    });
    println!("live: {server} connected; {running} running after {:?}", connected.elapsed());
    println!("live: {sessions} sessions in the store");
    println!("live: {} {title:?}: {messages} messages (older pages: {more})", first.0);
    println!("live: revision {}", data.revision());
    // Rehydration also reads running sessions the page does not list.
    assert!(sessions >= page.data.len());
}
