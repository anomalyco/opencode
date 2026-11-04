//! Pair dialog (E.18b): `packages/tui/src/component/dialog-pair.tsx`, `server.pair` (`/pair`, `/web`).
//!
//! It reads `GET /api/info` and asks `POST /api/pair` for a one-time code, then shows a connect link for each
//! server URL, one for this device on `localhost`, and a QR code of the first link (`renderUnicodeCompact`).
//! Opening the dialog creates a pairing code on the server, so tests prove it against a test transport only.

use std::rc::Rc;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{PairingCode, ServerInfo};
use opencode_ui::dialog::{DialogCx, DialogOptions, DialogSize, HeaderProps, header, layout};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opentui::keymap::Disposer;
use opentui::prelude::*;
use qrcode::bits::Bits;
use qrcode::{EcLevel, QrCode, Version};

use crate::app::Tui;

/// Registers `server.pair` ("Pair device", `/pair` and `/web`) as `app.tsx:1074-1081` does.
pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let command = TuiCommand::new("server.pair", move |_, _| {
        if let Some(tui) = weak.upgrade() {
            show(&tui);
        }
    })
    .bind(Bind::Off)
    .title("Pair device")
    .group("System")
    .palette()
    .slash(Slash {
        name: "pair".to_owned(),
        aliases: vec!["web".to_owned()],
        arguments: false,
    });
    let layers = [
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands: vec![command],
            ..KeymapLayer::default()
        },
        // `appBindingCommands`: the configured keybind (`none` by default).
        KeymapLayer {
            bindings: vec!["server.pair".to_owned()],
            ..KeymapLayer::default()
        },
    ];
    for layer in layers {
        // The layers live as long as the keymap, which the TUI owns.
        if let Err(error) = tui.keymap.layer(layer).map(Disposer::forget) {
            log::error!("pair keymap layer: {error}");
        }
    }
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
            layout(
                cx,
                &header(
                    cx,
                    HeaderProps {
                        title: "Pair".to_owned(),
                        ..HeaderProps::default()
                    },
                ),
                &body,
                None,
            )
        },
        None,
        DialogOptions {
            size: DialogSize::Large,
            ..DialogOptions::default()
        },
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
    let link = |base: &url::Url| {
        base.join(&format!("/auth/connect/{}", pairing.code))
            .map(String::from)
            .unwrap_or_default()
    };
    let urls: Vec<url::Url> = server
        .urls
        .iter()
        .filter_map(|url| url::Url::parse(url).ok())
        .collect();
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
        loopback: urls
            .iter()
            .any(|url| matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))),
    }
}

fn load(tui: &Tui, cx: &Rc<DialogCx>, body: &View) {
    let client = tui.data.client().clone();
    let (cx, body) = (Rc::downgrade(cx), body.clone());
    tui.app.spawn(
        async move {
            let options = RequestOptions::default();
            let (server, code) = futures_util::future::join(
                client.server_info(&options),
                client.server_pair(&options),
            )
            .await;
            Ok::<_, opencode_api::error::Error>(pairing(&server?, &code?))
        },
        move |_, result| {
            let Some(cx) = cx.upgrade() else { return };
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
                    body.add(
                        &Text::new(&cx.app, "Close and reopen Pair to try again.")
                            .fg(theme.text.muted),
                    );
                }
            }
            cx.app.request_redraw();
        },
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
        &Text::new(
            app,
            format!(
                "Open a link to connect. Links work once and expire in {} minutes.",
                value.minutes
            ),
        )
        .fg(theme.text.muted)
        .wrap(WrapMode::Word),
    );
    if let Some(url) = &value.localhost {
        side.add(
            &View::new(app)
                .child(&Text::new(app, "This device").fg(theme.text.muted))
                .child(&link(url)),
        );
    }
    let links = View::new(app).child(&Text::new(app, "Links").fg(theme.text.muted));
    for url in &value.links {
        links.add(&link(url));
    }
    side.add(&links);
    if value.loopback {
        side.add(
            &Text::new(
                app,
                "Run `opencode service set hostname 0.0.0.0` to access the service remotely.",
            )
            .fg(theme.text.muted)
            .wrap(WrapMode::Word),
        );
    }

    let code = View::new(app).shrink(0.0);
    if horizontal {
        code.grow(1.0).align_items(Align::End);
    } else {
        code.width(Length::Percent(100.0))
            .align_items(Align::Center);
    }
    if let Some(url) = value.links.first() {
        code.add(&Text::new(app, render_qr(url)).fg(theme.text.base));
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
    let scroll = ScrollBox::new(app)
        .scrollbars(false)
        .height((8.max(i32::from(height) - i32::from(height) / 4 - 6)) as u32);
    scroll.add(&row);
    View::new(app).child(&scroll)
}

/// `renderUnicodeCompact(text, { border: 1 })`: byte mode at level L in the smallest version, two modules per
/// cell with half blocks. Light modules draw as blocks and dark ones as the background.
pub fn render_qr(text: &str) -> String {
    let Some(code) = (1..=40).find_map(|version| {
        let mut bits = Bits::new(Version::Normal(version));
        bits.push_byte_data(text.as_bytes()).ok()?;
        bits.push_terminator(EcLevel::L).ok()?;
        QrCode::with_bits(bits, EcLevel::L).ok()
    }) else {
        return String::new();
    };
    let width = code.width();
    let colors = code.to_colors();
    // With the quiet zone of one module; `true` is dark.
    let size = width + 2;
    let dark = |x: usize, y: usize| {
        (1..=width).contains(&x)
            && (1..=width).contains(&y)
            && colors[(y - 1) * width + (x - 1)] == qrcode::Color::Dark
    };
    (0..size.div_ceil(2))
        .map(|line| {
            (0..size)
                .map(|x| {
                    let top = dark(x, line * 2);
                    // The symbol has an odd number of rows, so the last line's missing bottom half shows the
                    // terminal background.
                    let bottom = line * 2 + 1 >= size || dark(x, line * 2 + 1);
                    match (top, bottom) {
                        (true, true) => ' ',
                        (true, false) => '\u{2584}',
                        (false, true) => '\u{2580}',
                        (false, false) => '\u{2588}',
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
