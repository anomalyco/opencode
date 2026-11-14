//! Opt-in live test (`OPENCODE_LIVE=1`) of F.8: on `server.connected` the store reads the default
//! location, its VCS, and the projects; then it reads every catalog of the location and resolves
//! an existing session as `--session` does. Reads only: no environment upload, no creation, no
//! usage limits, and never `/api/experimental/session/stats`.

use std::time::Duration;

use opencode_api::client::{Auth, Client};
use opencode_api::events::{self, Status};
use opencode_api::generated::*;
use opencode_store::target::{Prepared, TargetInput, resolve_session_target};
use opencode_store::{Data, Options};

fn command(args: &[&str]) -> String {
    let output = std::process::Command::new("opencode").args(args).output().expect("opencode runs");
    assert!(output.status.success(), "opencode {args:?} failed");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test(flavor = "multi_thread")]
async fn live_store_reads_locations_and_resolves_a_session() {
    if std::env::var("OPENCODE_LIVE").as_deref() != Ok("1") {
        return;
    }
    let server = command(&["service", "status"]);
    let client = Client::new(&server).unwrap().auth(Auth::password(command(&["service", "get", "password"])));
    let directory = std::env::current_dir().unwrap().display().to_string();
    let data = Data::new(client.clone(), Options { directory, ..Default::default() });
    data.on_error(|error| eprintln!("live: refresh failed: {error}"));
    let (connection, _task) = opencode_store::connection::connect(&data, events::Options::default());
    let mut state = connection.watch();
    tokio::time::timeout(Duration::from_secs(5), state.wait_for(|state| state.status == Status::Connected))
        .await
        .expect("connects within 5 s")
        .unwrap();

    let rehydrated = || {
        data.read(|state| {
            let location = state.location(None);
            location.is_some_and(|data| data.info.is_some() && data.vcs.is_some()) && !state.projects().is_empty()
        })
    };
    let started = std::time::Instant::now();
    while !rehydrated() {
        assert!(started.elapsed() < Duration::from_secs(5), "rehydrates");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    data.read(|state| {
        let location = state.location(None).unwrap();
        let info = location.info.as_ref().unwrap();
        println!(
            "live: connected; location {} project {}; branch {:?}; {} projects",
            info.directory.0,
            info.project.id.0,
            location.vcs.as_ref().unwrap().branch.current,
            state.projects().len()
        );
    });

    data.location_sync(None).await.unwrap();
    data.read(|state| {
        let location = state.location(None).unwrap();
        let count = |items: Option<usize>| items.map_or("-".to_owned(), |n| n.to_string());
        println!(
            "live: agents {} commands {} integrations {} mcp {} resources {} models {} providers {} references {} skills {} shells {} global forms {}",
            count(location.agent.as_ref().map(Vec::len)),
            count(location.command.as_ref().map(Vec::len)),
            count(location.integration.as_ref().map(Vec::len)),
            count(location.mcp_server.as_ref().map(Vec::len)),
            count(location.mcp_resource.as_ref().map(Vec::len)),
            count(location.model.as_ref().map(Vec::len)),
            count(location.provider.as_ref().map(Vec::len)),
            count(location.reference.as_ref().map(Vec::len)),
            count(location.skill.as_ref().map(Vec::len)),
            state.shells(None).len(),
            count(
                state
                    .forms("global", Some(state.default_location()))
                    .map(|forms| forms.len())
            ),
        );
    });

    let page = client.session_list(&SessionListInput { limit: Some(1), ..Default::default() }).await.unwrap();
    let Some(latest) = page.data.first() else {
        println!("live: no session to resolve");
        return;
    };
    let target = resolve_session_target(
        &client,
        TargetInput { session: Some(latest.id.clone()), ..Default::default() },
        |preparation| async move { Ok(Prepared { model: preparation.model, agent: preparation.agent }) },
    )
    .await
    .unwrap();
    assert!(target.resume);
    println!(
        "live: --session {} resolves at {} with agent {:?}",
        target.session.id.0, target.location.directory.0, target.agent
    );
}
