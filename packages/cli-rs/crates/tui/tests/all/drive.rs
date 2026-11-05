//! H.4: the real TUI on a headless app, driven over the `OPENCODE_DRIVE` endpoint by a client on another thread.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_api::client::Client;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_local::cli_config::{Info, Resolved};
use opentui::app::HeadlessOptions;
use opentui::prelude::*;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::{self, Message};

const DIRECTORY: &str = "/project";

fn routes() -> Vec<MemoryRoute> {
    let location = json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let agent = json!({
        "id": "build", "name": "build", "mode": "primary", "hidden": false, "permissions": [],
        "request": { "settings": {}, "headers": {}, "body": {} },
    });
    let model = json!({
        "id": "model", "modelID": "model", "providerID": "demo", "name": "Demo Model",
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
        "enabled": true, "limit": { "context": 1000, "output": 100 },
    });
    vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json(
            "GET",
            "/api/session",
            200,
            &json!({ "data": [], "cursor": {} }),
        ),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([agent]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([model]))),
    ]
}

struct Driver {
    socket: tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    id: u64,
}

impl Driver {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.id += 1;
        let request =
            json!({ "jsonrpc": "2.0", "id": self.id, "method": method, "params": params });
        self.socket
            .send(Message::text(request.to_string()))
            .unwrap();
        let response: Value =
            serde_json::from_str(&self.socket.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(response["id"], self.id);
        response
            .get("result")
            .cloned()
            .ok_or_else(|| response["error"]["message"].as_str().unwrap().to_owned())
    }

    fn wait_for(&mut self, text: &str) {
        let deadline = Instant::now() + Duration::from_secs(30);
        while self.call("ui.matches", json!({ "text": text })) != Ok(json!(true)) {
            assert!(Instant::now() < deadline, "{text:?} never showed");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn rows(frame: &Value) -> Vec<String> {
    frame["lines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|line| {
            line["spans"]
                .as_array()
                .unwrap()
                .iter()
                .map(|span| span["text"].as_str().unwrap())
                .collect()
        })
        .collect()
}

#[test]
fn a_driver_types_into_the_headless_tui_and_captures_it() {
    let options = AppOptions {
        exit_on_ctrl_c: false,
        suspend_on_ctrl_z: false,
        ..AppOptions::default()
    };
    let app = App::headless(HeadlessOptions {
        width: 100,
        height: 30,
        app: options,
    })
    .unwrap();
    let client =
        Client::with_transport("http://opencode.local", Arc::new(Memory::new(routes()))).unwrap();
    let deps = opencode_tui::Deps {
        client,
        directory: DIRECTORY.into(),
        config: Resolved::new(Info::default(), |_| None),
        roots: None,
        route: opencode_tui::Route::Home,
        continue_: false,
        events: false,
    };
    let tui = opencode_tui::mount_with(&app, deps, opencode_tui::Args::default());
    let server = opencode_tui::features::drive::start(
        &tui,
        SocketAddr::from(([127, 0, 0, 1], 0)),
        "0.0.0-test".into(),
    )
    .unwrap();
    let proxy = app.proxy();
    let url = server.url();
    let driver = std::thread::spawn(move || {
        let (socket, _) = tungstenite::connect(&url).unwrap();
        let mut driver = Driver { socket, id: 0 };
        let handshake = driver.call(
            "simulation.handshake",
            json!({
                "client": { "name": "test", "version": "1" }, "expectedRole": "ui", "offeredVersions": [1],
                "requiredCapabilities": ["ui.type", "ui.capture"], "optionalCapabilities": [],
            }),
        );
        driver.wait_for("Demo Model");
        let typed = driver.call("ui.type", json!({ "text": "hello drive" }));
        let matched = driver.call("ui.matches", json!({ "text": "hello drive" }));
        let resized = driver.call("ui.resize", json!({ "cols": 80, "rows": 20 }));
        let frame = driver.call("ui.capture", Value::Null).unwrap();
        let state = driver.call("ui.state", Value::Null);
        let _ = proxy.quit();
        (handshake, typed, matched, resized, frame, state)
    });
    app.clone().run().unwrap();
    let (handshake, typed, matched, resized, frame, state) = driver.join().unwrap();
    drop(tui);

    assert_eq!(
        handshake.unwrap()["server"],
        json!({ "name": "opencode", "version": "0.0.0-test" })
    );
    assert_eq!(
        typed.unwrap(),
        json!({ "focused": { "editor": true }, "elements": [] })
    );
    assert_eq!(matched, Ok(json!(true)));
    assert_eq!(resized.unwrap()["focused"]["editor"], true);
    assert_eq!(
        (frame["cols"].as_u64(), frame["rows"].as_u64()),
        (Some(80), Some(20))
    );
    let rows = rows(&frame);
    assert_eq!(rows.len(), 20);
    let prompt = rows
        .iter()
        .find(|row| row.contains("hello drive"))
        .unwrap_or_else(|| panic!("{}", rows.join("\n")));
    println!("{}", rows.join("\n"));
    assert!(prompt.contains("hello drive"));
    assert!(state.unwrap_err().starts_with("ui.state is not supported"));
}
