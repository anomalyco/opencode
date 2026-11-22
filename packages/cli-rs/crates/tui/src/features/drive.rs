//! Headless simulation endpoint.

use crate::app::{Launch, Tui};
use opencode_drive::Manifest;
use opentui::app::HeadlessOptions;
use opentui::{App, AppOptions};
use std::net::SocketAddr;
use std::rc::Rc;

pub fn manifest() -> Option<opentui::Result<Manifest>> {
    opencode_drive::manifest::resolve(|name| std::env::var(name).ok())
        .map(|manifest| manifest.map_err(opentui::Error::other))
}

/// Serve the headless TUI at the manifest viewport, defaulting to 100 by 40, until it quits.
pub fn run(manifest: Manifest, options: AppOptions, launch: Launch) -> opentui::Result<()> {
    let (width, height) = manifest.viewport.unwrap_or((100, 40));
    let app = App::headless(HeadlessOptions {
        width,
        height,
        // Nothing draws over stderr without a terminal, and the driver reads the endpoint line from it.
        app: AppOptions { capture_stderr: false, ..options },
    })?;
    let version = launch.args.version.clone();
    crate::app::run_on(app, launch, |tui| {
        let server = start(tui, manifest.ui_addr(), version)?;
        eprintln!("opencode drive ui websocket: {}", server.url());
        Ok(())
    })
}

pub fn start(tui: &Rc<Tui>, addr: SocketAddr, version: String) -> std::io::Result<opencode_drive::Server> {
    opencode_drive::start(&tui.app, addr, version)
}
