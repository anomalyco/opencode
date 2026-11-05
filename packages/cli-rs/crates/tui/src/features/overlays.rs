//! App-wide overlays (E.1, rows T04 to T07):
//!
//! - the reconnecting overlay, shown 1 s into reconnecting or 5 s into the first connection
//!   (`app.tsx:1379-1403`, `component/reconnecting.tsx`);
//! - the data migration overlay, which polls the V1 migration status from 1 s after the first connection
//!   (`component/migration-overlay.tsx`; TS starts 1 s after mount);
//! - the startup loading screen waits for TS plugins to load (`component/startup-loading.tsx`). Built-in
//!   Rust plugins are ready at mount, so it never shows, as in TS when plugins load within 500 ms;
//! - the error boundary screen (`component/error-component.tsx`) has no Rust equivalent: a panic in the UI
//!   restores the terminal and ends the process (see the E.1 report).
//!
//! `app::mount` calls [`install`] once and [`connection_changed`] on every connection state.

use std::cell::{Cell, RefCell};
use std::rc::Weak;
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::events::{State, Status};
use opencode_ui::bind;
use opencode_ui::motion::Spinner;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use crate::app::Tui;

/// `MigrationOverlay` starts polling after this, then polls at the same interval.
const MIGRATION_POLL: Duration = Duration::from_millis(1000);

#[derive(Default)]
pub struct Overlays {
    reconnecting: RefCell<Option<View>>,
    timer: Cell<Option<TimerId>>,
    migration: RefCell<Option<View>>,
    connected: Cell<bool>,
    polling: Cell<bool>,
}

/// Whether the event connection is connected (`client.connection.status() === "connected"`).
pub fn connected(tui: &Tui) -> bool {
    tui.overlays.connected.get()
}

pub fn install(_tui: &Tui) {}

/// Shows or hides the reconnecting overlay after its grace period, and resyncs the location on a new
/// connection (`server.connected`).
pub fn connection_changed(tui: &Tui, state: &State) {
    let overlays = &tui.overlays;
    if let Some(timer) = overlays.timer.take() {
        tui.app.cancel_timer(timer);
    }
    let connected = state.status == Status::Connected;
    if connected && !overlays.connected.replace(true) {
        crate::features::location::reconnected(tui);
        // TS polls 1 s after mount whatever the connection; polling from the first connection keeps a
        // server that is still starting from showing "Data migration failed".
        if !overlays.polling.replace(true) {
            let weak = tui.weak();
            tui.app.set_timeout(MIGRATION_POLL, move |_| poll_migration(&weak));
        }
    }
    if connected {
        if let Some(view) = overlays.reconnecting.take() {
            view.detach();
            tui.app.request_redraw();
        }
        return;
    }
    overlays.connected.set(false);
    let delay =
        if state.status == Status::Reconnecting { Duration::from_millis(1000) } else { Duration::from_millis(5000) };
    overlays.timer.set(Some(tui.app.set_timeout(
        delay,
        bind!(tui, |tui, _| {
            tui.overlays.timer.set(None);
            if tui.overlays.reconnecting.borrow().is_some() {
                return;
            }
            let view = reconnecting(&tui);
            tui.app.root().add(&view);
            *tui.overlays.reconnecting.borrow_mut() = Some(view);
            tui.app.request_redraw();
        }),
    )));
}

/// `Reconnecting`: a dimmed screen with a centered panel.
fn reconnecting(tui: &Tui) -> View {
    let app = &tui.app;
    let theme = tui.page();
    let managed = tui.startup.args.managed;
    let spinner = Spinner::new(app)
        .color(theme.text.base)
        .label(if managed { "Restarting service…" } else { "Connection lost…" })
        .animations(opencode_ui::motion::enabled(tui.config().info.animations));
    let note = Text::new(
        app,
        if managed { "Your session will resume automatically." } else { "Reconnecting to the server automatically." },
    )
    .fg(theme.text.muted);
    let panel = View::new(app)
        .column()
        .width(48)
        .max_width(Length::percent(90.0))
        .bg(theme.background.raised.base)
        .padding_y(1)
        .padding_x(2)
        .gap(1)
        .child(&spinner)
        .child(&note);
    View::new(app)
        .absolute()
        .z_index(10_000)
        .position(Edge::Top, 0)
        .position(Edge::Right, 0)
        .position(Edge::Bottom, 0)
        .position(Edge::Left, 0)
        .bg(Color::rgba(0, 0, 0, 150))
        .align_items(Align::Center)
        .justify(Justify::Center)
        .child(&panel)
}

/// One `v1.status` read; a running migration shows its progress, and polling stops once it completed.
fn poll_migration(weak: &Weak<Tui>) {
    let Some(tui) = weak.upgrade() else { return };
    let client = tui.data.client().clone();
    let weak = weak.clone();
    tui.app.spawn(
        async move {
            client
                .experimental_migration_v1_status(&RequestOptions::default())
                .await
                .map(|status| serde_json::to_value(status).unwrap_or_default())
        },
        bind!(weak, |tui, cx, result| {
            let status = match result {
                Ok(status) => status,
                Err(error) => return migration_failed(&tui, error.to_string()),
            };
            let progress = (status["status"] == "running").then(|| progress(&status["progress"]));
            set_migration(&tui, progress);
            match status["status"].as_str() {
                Some("completed") => {}
                Some("error") => {
                    let message = status["error"].as_str().unwrap_or("Unknown error").to_owned();
                    migration_failed(&tui, message);
                }
                _ => {
                    let weak = weak.clone();
                    cx.app().set_timeout(MIGRATION_POLL, move |_| poll_migration(&weak));
                }
            }
        }),
    );
}

fn migration_failed(tui: &Tui, message: String) {
    set_migration(tui, None);
    tui.toasts.show(
        ToastOptions::new(Variant::Error, message)
            .title("Data migration failed")
            .duration(Duration::from_millis(10_000)),
    );
}

/// `label` and ` n` or ` n/m`.
fn progress(value: &serde_json::Value) -> String {
    let label = value["label"].as_str().unwrap_or_default();
    match (value["numerator"].as_i64(), value["denominator"].as_i64()) {
        (None, _) => label.to_owned(),
        (Some(numerator), None) => format!("{label} {numerator}"),
        (Some(numerator), Some(denominator)) => format!("{label} {numerator}/{denominator}"),
    }
}

/// The migration panel in the top right corner, or none.
fn set_migration(tui: &Tui, progress: Option<String>) {
    if let Some(view) = tui.overlays.migration.take() {
        view.detach();
    }
    let Some(progress) = progress else {
        tui.app.request_redraw();
        return;
    };
    let app = &tui.app;
    let theme = tui.page();
    let spinner = Spinner::new(app)
        .color(theme.text.feedback.info.base)
        .label(progress)
        .animations(opencode_ui::motion::enabled(tui.config().info.animations));
    let view = View::new(app)
        .absolute()
        .z_index(10_000)
        .position(Edge::Top, 1)
        .position(Edge::Right, 2)
        .row()
        .bg(theme.background.raised.high)
        .border(BorderStyle::Heavy)
        .border_sides(Sides::LEFT)
        .border_color(theme.text.feedback.info.base)
        .padding_x(2)
        .padding_y(1)
        .child(&spinner);
    tui.app.root().add(&view);
    *tui.overlays.migration.borrow_mut() = Some(view);
    tui.app.request_redraw();
}

#[cfg(test)]
mod tests {
    #[test]
    fn formats_migration_progress() {
        use serde_json::json;
        let progress = |value| super::progress(&value);
        assert_eq!(progress(json!({ "label": "Sessions" })), "Sessions");
        assert_eq!(progress(json!({ "label": "Sessions", "numerator": 3 })), "Sessions 3");
        assert_eq!(progress(json!({ "label": "Sessions", "numerator": 3, "denominator": 9 })), "Sessions 3/9");
    }
}
