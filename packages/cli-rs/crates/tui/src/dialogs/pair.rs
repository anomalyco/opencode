//! Pair dialog (E.18b): `packages/tui/src/component/dialog-pair.tsx`, `server.pair` (`/pair`, `/web`).
//!
//! It reads `GET /api/info` and asks `POST /api/pair` for a one-time code, then shows a connect link for each
//! server URL, one for this device on `localhost`, and a QR code of the first link (`renderUnicodeCompact`).
//! Opening the dialog creates a pairing code on the server, so tests prove it against a test transport only.

use opencode_api::generated::{PairingCode, ServerInfo};
use opencode_ui::bind;
use opencode_ui::dialog::{DialogCx, DialogOptions, DialogSize, HeaderProps, header, layout};
use opencode_ui::keymap::{Bind, KeymapLayer, Slash, TuiCommand};
use opentui::prelude::*;
use std::rc::Rc;

use crate::app::Tui;

/// Registers `server.pair` ("Pair device", `/pair` and `/web`) as `app.tsx:1074-1081` does.
pub fn install(tui: &Rc<Tui>) {
    let command = TuiCommand::new("server.pair", bind!(tui, |tui, _, _| show(&tui)))
        .bind(Bind::Off)
        .title("Pair device")
        .group("System")
        .palette()
        .slash(Slash::new("pair").aliases(["web"]));
    tui.keymap.install(
        "pair",
        [
            KeymapLayer::global(vec![command]),
            // `appBindingCommands`: the configured keybind (`none` by default).
            KeymapLayer::default().bindings(["server.pair"]),
        ],
    );
}

/// `DialogPair`, large and centered, in place of any open dialog.
pub fn show(tui: &Tui) {
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            cx.dialogs.set_centered(true);
            let body = View::new(&cx.app);
            body.add(&Text::new(&cx.app, "Loading server information…").fg(cx.theme.text.muted));
            if let Some(tui) = weak.upgrade() {
                load(&tui, cx, &body);
            }
            layout(cx, &header(cx, HeaderProps::new("Pair")), &body, None)
        },
        None,
        DialogOptions::new(DialogSize::Large),
    );
}

/// What the links come from.
pub struct Pairing {
    pub links: Vec<String>,
    pub localhost: Option<String>,
    pub minutes: i64,
    pub loopback: bool,
}

/// The links of `pairing.code` on each of the server's URLs.
pub fn pairing(server: &ServerInfo, pairing: &PairingCode) -> Pairing {
    let link =
        |base: &url::Url| base.join(&format!("/auth/connect/{}", pairing.code)).map(String::from).unwrap_or_default();
    let urls: Vec<url::Url> = server.urls.iter().filter_map(|url| url::Url::parse(url).ok()).collect();
    let localhost = server
        .urls
        .first()
        .and_then(|url| url::Url::parse(url).ok())
        .and_then(|mut local| local.set_host(Some("localhost")).ok().map(|()| local))
        .map(|local| link(&local));
    Pairing {
        links: urls.iter().map(link).collect(),
        localhost,
        minutes: (pairing.expires_in as f64 / 60.0).round() as i64,
        loopback: urls.iter().any(|url| matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))),
    }
}

fn load(tui: &Tui, cx: &Rc<DialogCx>, body: &View) {
    let client = tui.data.client().clone();
    let (cx, body) = (Rc::downgrade(cx), body.clone());
    tui.app.spawn(
        async move {
            let (server, code) = futures_util::future::join(client.server_info(), client.server_pair()).await;
            Ok::<_, opencode_api::error::Error>(pairing(&server?, &code?))
        },
        bind!(cx, |cx, _, result| {
            body.clear();
            match result {
                Ok(value) => {
                    body.add(&content(&cx, &value));
                }
                Err(error) => {
                    let theme = &cx.theme;
                    body.add(
                        &Text::new(&cx.app, "Could not load server information")
                            .fg(theme.text.feedback.error.base)
                            .bold(),
                    );
                    body.add(&Text::new(&cx.app, error.to_string()).fg(theme.text.muted));
                    body.add(&Text::new(&cx.app, "Close and reopen Pair to try again.").fg(theme.text.muted));
                }
            }
            cx.app.request_redraw();
        }),
    );
}

/// The links and the QR code: side by side from 96 columns, else stacked; in a scroll box below 36 rows.
fn content(cx: &DialogCx, value: &Pairing) -> View {
    let app = &cx.app;
    let theme = &cx.theme;
    let (width, height) = app.size();
    let horizontal = width >= 96;
    let link = |url: &str| Text::new(app, vec![url.to_owned().fg(theme.text.base).link(url)]);

    let side = View::new(app).shrink(0.0).gap(1);
    if horizontal {
        side.width(29);
    } else {
        side.width(Length::Percent(100.0));
    }
    side.add(
        &Text::new(app, format!("Open a link to connect. Links work once and expire in {} minutes.", value.minutes))
            .fg(theme.text.muted)
            .wrap(WrapMode::Word),
    );
    if let Some(url) = &value.localhost {
        side.add(&View::new(app).child(&Text::new(app, "This device").fg(theme.text.muted)).child(&link(url)));
    }
    let links = View::new(app).child(&Text::new(app, "Links").fg(theme.text.muted));
    for url in &value.links {
        links.add(&link(url));
    }
    side.add(&links);
    if value.loopback {
        side.add(
            &Text::new(app, "Run `opencode service set hostname 0.0.0.0` to access the service remotely.")
                .fg(theme.text.muted)
                .wrap(WrapMode::Word),
        );
    }

    let code = View::new(app).shrink(0.0);
    if horizontal {
        code.grow(1.0).align_items(Align::End);
    } else {
        code.width(Length::Percent(100.0)).align_items(Align::Center);
    }
    if let Some(url) = value.links.first() {
        code.add(&Text::new(app, opencode_ui::qr::render_unicode_compact(url, 1)).fg(theme.text.base));
    }

    let row = View::new(app).gap(2).child(&side).child(&code);
    if horizontal {
        row.row().align_items(Align::Start);
    } else {
        row.align_items(Align::Center);
    }
    if height >= 36 {
        return row;
    }
    let scroll =
        ScrollBox::new(app).scrollbars(false).height((8.max(i32::from(height) - i32::from(height) / 4 - 6)) as u32);
    scroll.add(&row);
    View::new(app).child(&scroll)
}
