//! The store-to-UI pump survives a full UI queue (reviews bigboi-1 and carbon-2 of the plugin fixes): a burst while
//! the UI thread is busy delays events, it never stops later ones.

use crate::support::{self, DIRECTORY};

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_tui::{Deps, Route};
use opentui::app::ProxyError;
use serde_json::{Value, json};

fn routes() -> Vec<MemoryRoute> {
    let location =
        json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([support::agent("build", "primary", false)]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([support::model("demo", "model", "Demo Model")]))),
    ]
}

fn append(id: &str, text: &str) -> Value {
    json!({
        "id": id, "created": 1, "type": "tui.prompt.append",
        "location": { "directory": DIRECTORY }, "data": { "text": text },
    })
}

fn changed(id: usize) -> Value {
    json!({
        "id": format!("evt_fs_{id}"), "created": 1, "type": "filesystem.changed",
        "location": { "directory": DIRECTORY }, "data": { "file": format!("src/{id}.rs"), "event": "change" },
    })
}

#[test]
fn a_burst_while_the_ui_is_busy_does_not_stop_later_events() {
    let memory = Arc::new(Memory::new(routes()));
    let h = support::mount(100, 30, Deps { route: Route::Home, events: true, ..support::deps(memory.clone()) });
    h.wait_for("Demo Model");
    memory.emit(&append("evt_before", "before"));
    h.wait("the first append", || h.text() == "before");

    // Someone listens to the burst, so it goes through the pump.
    let heard = Rc::new(Cell::new(0));
    let count = heard.clone();
    let _listening = opencode_tui::features::events::subscribe(&h.tui, ["filesystem.changed"], move |_, _| {
        count.set(count.get() + 1);
    });
    // The UI thread is busy: nothing drains its queue until it is full.
    let proxy = h.app.proxy();
    while proxy.post(|_| {}) != Err(ProxyError::Full) {}
    for id in 0..34 * 128 {
        memory.emit(&changed(id));
    }
    memory.emit(&append("evt_mid", "mid"));
    std::thread::sleep(Duration::from_millis(300));

    h.wait("the append sent while the queue was full", || h.text() == "beforemid");
    memory.emit(&append("evt_after", "after"));
    h.wait("the append after the queue drained", || h.text() == "beforemidafter");
    assert!(heard.get() > 0, "the burst reached its listener");
}

// Expected: an event type nobody listens to never reaches the UI thread.
#[test]
fn an_event_nobody_listens_to_stays_in_the_store() {
    let memory = Arc::new(Memory::new(routes()));
    let h = support::mount(100, 30, Deps { route: Route::Home, events: true, ..support::deps(memory.clone()) });
    h.wait_for("Demo Model");
    let heard = Rc::new(RefCell::new(Vec::new()));
    let record = heard.clone();
    let _listening = opencode_tui::features::events::subscribe(&h.tui, ["tui.prompt.append"], move |_, event| {
        record.borrow_mut().push(event.tag().to_owned());
    });
    memory.emit(&changed(0));
    memory.emit(&append("evt_after", "after"));
    h.wait("the append", || h.text() == "after");
    let heard = heard.borrow();
    assert!(heard.iter().any(|tag| tag == "tui.prompt.append") && !heard.iter().any(|tag| tag == "filesystem.changed"));
}
