//! The `OPENCODE_DRIVE` UI endpoint (H.4): with the variable set, the TUI runs headless and a simulation driver
//! controls it over the endpoint, as `app.tsx:276-279` hands the renderer to `Drive.create`.

use crate::app::{Launch, Tui};
use opencode_drive::Manifest;
use opentui::app::HeadlessOptions;
use opentui::{App, AppOptions};
use std::net::SocketAddr;
use std::rc::Rc;

/// The manifest `OPENCODE_DRIVE` names, or `None` when it is unset.
pub fn manifest() -> Option<opentui::Result<Manifest>> {
    opencode_drive::manifest::resolve(|name| std::env::var(name).ok())
        .map(|manifest| manifest.map_err(opentui::Error::other))
}

/// Runs the TUI on a headless app at the manifest's viewport (100 by 40 without one, as `renderer.ts` sizes it) and
/// serves the endpoint until the TUI quits.
pub fn run(manifest: Manifest, options: AppOptions, launch: Launch) -> opentui::Result<()> {
    let (width, height) = manifest.viewport.unwrap_or((100, 40));
    let app = App::headless(HeadlessOptions {
        width,
        height,
        // Nothing draws over stderr without a terminal, and the driver reads the endpoint line from it.
        app: AppOptions {
            capture_stderr: false,
            ..options
        },
    })?;
    let version = Some(launch.args.version.clone())
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| "unknown".into());
    crate::app::run_on(app, launch, |tui| {
        let server = start(tui, manifest.ui_addr(), version)?;
        eprintln!("opencode drive ui websocket: {}", server.url());
        Ok(())
    })
}

/// Serves the endpoint at `addr` for a TUI mounted on a headless app.
pub fn start(
    tui: &Rc<Tui>,
    addr: SocketAddr,
    version: String,
) -> std::io::Result<opencode_drive::Server> {
    let textarea = tui.textarea.clone();
    let editor = Box::new(move |app: &App| {
        let focused = app.focused();
        textarea
            .borrow()
            .as_ref()
            .is_some_and(|textarea| focused.is_some_and(|widget| widget.is(textarea)))
    });
    opencode_drive::start(&tui.app, addr, opencode_drive::Options { version, editor })
}
