//! The sidebar footer (E.14, row F08, `feature-plugins/sidebar/footer.tsx`): the "Getting started" card while
//! no provider is connected and it was not dismissed (from 22 rows), then the location as `directory:branch`,
//! which brightens under the pointer and opens the working directory menu (E.20) on a click.

use std::cell::Cell;
use std::rc::Rc;

use opencode_api::generated::SessionID;
use opencode_plugin::{Definition, Placement, slot};
use opencode_store::{Catalog, Location};
use opencode_ui::bind;
use opentui::prelude::*;
use serde_json::json;

use crate::app::Tui;
use crate::routes::session::sidebar::{Section, on_click, sync_catalogs};

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.sidebar.footer", |cx| {
        let onboarding = Rc::new(Onboarding::load(cx.host(), cx.storage_key("getting-started")));
        cx.slot(Placement::append(slot::SIDEBAR_FOOTER), move |tui, input| {
            let session = SessionID(input.session_id.clone().unwrap_or_default());
            let (model, render) = (onboarding.clone(), onboarding.clone());
            // The card follows the terminal height and the stored dismissal, so any change reads the model again.
            Box::new(Section::new(
                tui,
                None,
                move |tui, _| Some(read(tui, &session, &model)),
                move |tui, footer| view(tui, footer, &render),
            ))
        });
    })
}

#[derive(PartialEq)]
struct Footer {
    card: bool,
    directory: String,
    branch: Option<String>,
}

fn read(tui: &Tui, session: &SessionID, onboarding: &Onboarding) -> Footer {
    sync_catalogs(tui, session, &[Catalog::Integration, Catalog::Vcs]);
    let (directory, connected, branch) = tui.data.read(|state| {
        let location = state
            .session(session)
            .map(|info| Location::from(&info.location))
            .unwrap_or_else(|| state.default_location().clone());
        let data = state.location(Some(&location));
        let connected = data
            .and_then(|data| data.integration.as_ref())
            .map(|list| list.iter().any(|item| !item.connections.is_empty()));
        let branch = data.and_then(|data| data.vcs.as_ref()).and_then(|vcs| vcs.branch.current.clone());
        (location.directory, connected, branch)
    });
    let card = tui.app.size().1 >= 22 && connected == Some(false) && !onboarding.dismissed.get();
    Footer { card, directory, branch }
}

fn view(tui: &Tui, footer: &Footer, onboarding: &Rc<Onboarding>) -> View {
    let root = View::new(&tui.app).gap(1);
    if footer.card {
        root.add(&card(tui, onboarding));
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let directory = opencode_ui::path::abbreviate_home(&footer.directory, &home);
    let value = match &footer.branch {
        Some(branch) => format!("{directory}:{branch}"),
        None => directory,
    };
    root.add(&path(tui, &footer.directory, &value));
    root
}

/// The stored `getting-started` state (`{ dismissed: false }`).
struct Onboarding {
    key: String,
    dismissed: Cell<bool>,
}

impl Onboarding {
    fn load(tui: &Tui, key: String) -> Self {
        let dismissed = tui
            .storage()
            .and_then(|storage| storage.load(&key, &json!({ "dismissed": false })).ok())
            .and_then(|value| value.get("dismissed").and_then(serde_json::Value::as_bool))
            .unwrap_or(false);
        Self { key, dismissed: Cell::new(dismissed) }
    }

    fn dismiss(&self, tui: &Tui) {
        self.dismissed.set(true);
        tui.resync();
        let Some(storage) = tui.storage() else { return };
        let key = self.key.clone();
        tui.app.runtime().spawn_blocking(move || {
            let result = storage.update(&key, &json!({ "dismissed": false }), |value| {
                value["dismissed"] = json!(true);
            });
            if let Err(error) = result {
                log::error!("Failed to dismiss sidebar onboarding: {error}");
            }
        });
    }
}

/// `SidebarOnboarding`.
fn card(tui: &Tui, onboarding: &Rc<Onboarding>) -> View {
    let theme = tui.page();
    let app = &tui.app;
    let close = Text::new(app, "✕").fg(theme.text.muted);
    let state = onboarding.clone();
    on_click(&close, false, bind!(tui, |tui| state.dismiss(&tui)));
    let connect = View::new(app)
        .row()
        .gap(1)
        .justify(Justify::SpaceBetween)
        .child(&Text::new(app, "Connect provider").fg(theme.text.base))
        .child(&Text::new(app, "/connect").fg(theme.text.muted));
    on_click(
        &connect,
        false,
        bind!(tui, |tui| {
            tui.keymap.dispatch("provider.connect", None);
        }),
    );
    let muted = |text: &str| Text::new(app, text).fg(theme.text.muted).wrap(WrapMode::Word);
    let body = View::new(app)
        .column()
        .grow(1.0)
        .gap(1)
        .child(
            &View::new(app)
                .row()
                .justify(Justify::SpaceBetween)
                .child(&Text::new(app, "Getting started").fg(theme.text.base).bold())
                .child(&close),
        )
        .child(&muted("OpenCode includes free models so you can start immediately."))
        .child(&muted("Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc"))
        .child(&connect);
    View::new(app)
        .row()
        .bg(theme.background.raised.high)
        .padding_y(1)
        .padding_x(2)
        .gap(1)
        .child(&Text::new(app, "⬖").fg(theme.text.base).shrink(0.0))
        .child(&body)
}

/// `FilePath` of the location at most 38 columns wide.
fn path(tui: &Tui, directory: &str, value: &str) -> View {
    let theme = tui.page();
    let text = Text::new(&tui.app, crate::dialogs::open::truncate_file_path(value, 38))
        .fg(theme.text.muted)
        .wrap(WrapMode::None)
        .truncate(true);
    let hover = text.clone();
    let (base, muted) = (theme.text.base, theme.text.muted);
    text.on_hover(move |cx, hovered| {
        hover.fg(if hovered { base } else { muted });
        cx.app().request_redraw();
    });
    let directory = directory.to_owned();
    on_click(&text, false, bind!(tui, |tui| crate::dialogs::working_directory::show(&tui, &directory)));
    View::new(&tui.app).child(&text)
}
