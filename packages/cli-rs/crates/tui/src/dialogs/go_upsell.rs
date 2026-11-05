//! Go upsell (E.16): `component/dialog-go-upsell.tsx`, offered when the free allowance stops a turn, and its
//! OpenCode Console connect step; and when to offer it, remembered in storage `go-upsell`
//! (`routes/session/index.tsx:633-758`, row V24).

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    ConnectionInfo, IntegrationAttempt, IntegrationAttemptID, IntegrationAttemptStatus, IntegrationID,
    IntegrationMethod, IntegrationMethodID, IntegrationOauthCancelInput, IntegrationOauthConnectInput,
    IntegrationOauthStatusInput, LocationQueryInput, ModelInfoStatus,
};
use opencode_local::model_pref::Model;
use opencode_ui::bind;
use opencode_ui::dialog::{
    DIALOG_INSET, DialogCx, DialogOptions, FooterAction, FooterProps, HeaderProps, footer, header, layout_view,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::Condition;
use opentui::prelude::*;
use serde_json::{Value, json};

use crate::dialogs::model::Local;

pub const GO_URL: &str = "https://opencode.ai/go";
const ACTIONS: [&str; 3] = ["don't show again", "dismiss", "subscribe"];
const DAY_MS: f64 = 86_400_000.0;

/// The `go-upsell` record, in storage and in memory.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Seen {
    pub last_seen_at: Option<f64>,
    pub dont_show: bool,
}

impl Seen {
    fn from_value(value: &Value) -> Self {
        Self {
            last_seen_at: value.get("lastSeenAt").and_then(Value::as_f64),
            dont_show: value.get("dontShow").and_then(Value::as_bool).unwrap_or(false),
        }
    }
}

/// What the stored record decided (`updateGoUpsell`'s draft function).
#[derive(Debug, PartialEq)]
enum Claim {
    /// "Don't show again" was saved by another client.
    DontShow(Option<f64>),
    /// Another client offered it in the last day.
    Recent(Option<f64>),
    /// This client offers it now; `lastSeenAt` is written.
    Claimed,
}

// The draft function of `updateGoUpsell`, on the stored record.
fn claim(draft: &mut Value, now: f64) -> Claim {
    let stored = Seen::from_value(draft);
    if stored.dont_show {
        return Claim::DontShow(stored.last_seen_at);
    }
    if stored.last_seen_at.is_some_and(|at| at > 0.0 && now - at < DAY_MS) {
        return Claim::Recent(stored.last_seen_at);
    }
    if !draft.is_object() {
        *draft = json!({});
    }
    // `Date.now()` is a whole number of milliseconds.
    draft["lastSeenAt"] = json!(now as i64);
    Claim::Claimed
}

/// What a free-limit stop offers: run `on_subscribe` after a Go subscription, and `can_continue` says whether the
/// restored prompt is still the one to resend.
#[derive(Clone)]
pub struct Offer {
    pub reset: Option<String>,
    pub can_continue: Rc<dyn Fn() -> bool>,
    pub on_subscribe: Rc<dyn Fn()>,
}

/// Offers OpenCode Go at most once a day across clients, unless "don't show again" was chosen
/// (`routes/session/index.tsx:682-757`). The session route calls this when `provider.free-limit` stops a turn and
/// the prompt came back empty-handed.
pub fn offer(local: &Rc<Local>, offer: Offer, now: f64) {
    if local.dialogs.is_open() {
        return;
    }
    let memory = local.go_memory.borrow().clone();
    if memory.dont_show {
        return;
    }
    if memory.last_seen_at.is_some_and(|at| at > 0.0 && now - at < DAY_MS) {
        return;
    }
    let previous = memory.last_seen_at;
    local.go_memory.borrow_mut().last_seen_at = Some(now);
    let Some(storage) = local.storage.clone() else {
        open_if_allowed(local, offer);
        return;
    };
    local.app.spawn(
        async move {
            tokio::task::spawn_blocking(move || {
                let mut result = Claim::Claimed;
                let written = storage.update("go-upsell", &json!({}), |draft| result = claim(draft, now));
                // A failed write still offers it, as TS does.
                written.map_or(Claim::Claimed, |_| result)
            })
            .await
            .unwrap_or(Claim::Claimed)
        },
        bind!(local, |local, _, claimed| {
            match claimed {
                Claim::DontShow(at) => {
                    let mut memory = local.go_memory.borrow_mut();
                    memory.dont_show = true;
                    memory.last_seen_at = at.or(previous);
                }
                Claim::Recent(at) => local.go_memory.borrow_mut().last_seen_at = at,
                Claim::Claimed => open_if_allowed(&local, offer),
            }
        }),
    );
}

fn open_if_allowed(local: &Rc<Local>, offer: Offer) {
    if !(offer.can_continue)() || local.dialogs.is_open() || local.go_memory.borrow().dont_show {
        return;
    }
    show(local, offer);
}

/// `DialogGoUpsell`: "Free limit reached" with "don't show again", "dismiss", and "subscribe".
pub fn show(local: &Rc<Local>, offer: Offer) {
    let weak = Rc::downgrade(local);
    local.dialogs.replace(
        move |cx| match weak.upgrade() {
            Some(local) => build(cx, &local, offer),
            None => View::new(&cx.app),
        },
        None,
        DialogOptions::default(),
    );
}

fn build(cx: &Rc<DialogCx>, local: &Rc<Local>, offer: Offer) -> View {
    let app = &cx.app;
    let theme = &cx.theme;
    let (width, height) = app.size();
    let narrow = width < 52;
    let short = height < 22;
    if short {
        cx.dialogs.set_centered(true);
    }
    // Text sits on a translucent panel, as it does over the rings the TS client animates behind it.
    let base = theme.background.base;
    let text_bg = Color::rgba(base.r, base.g, base.b, 186);
    let primary = theme.background.action.primary.focused;
    let selected = Rc::new(Cell::new(2usize));
    let buttons: Rc<RefCell<Vec<(View, Text)>>> = Rc::default();

    let paint = {
        let buttons = buttons.clone();
        let selected = selected.clone();
        let theme = theme.clone();
        Rc::new(move || {
            for (index, (button, label)) in buttons.borrow().iter().enumerate() {
                let active = selected.get() == index;
                button.bg(if active { primary } else { Color::TRANSPARENT });
                let fg = if active {
                    theme.text.action.primary.focused
                } else if ACTIONS[index] == "subscribe" {
                    theme.text.base
                } else {
                    theme.text.muted
                };
                label.fg(fg).bg(if active { Color::TRANSPARENT } else { text_bg });
                if active {
                    label.bold();
                } else {
                    label.attributes(Attributes::NONE);
                }
            }
        })
    };
    let run: Rc<dyn Fn(usize)> = {
        let offer = offer.clone();
        Rc::new(bind!(local, |local, index| {
            match ACTIONS[index] {
                "subscribe" => {
                    let _ = (local.open_url.borrow())(GO_URL);
                    connect(&local, offer.clone());
                }
                action => {
                    if action == "don't show again" {
                        dont_show_again(&local);
                    }
                    local.dialogs.clear();
                }
            }
        }))
    };
    let step = {
        let selected = selected.clone();
        let paint = paint.clone();
        Rc::new(move |by: i64| {
            let len = ACTIONS.len() as i64;
            selected.set(((selected.get() as i64 + by + len) % len) as usize);
            paint();
        })
    };
    let bind = |key: &str, title: &str, run: Rc<dyn Fn()>| {
        TuiCommand::inline(key, move |_, _| run()).title(title).group("Dialog")
    };
    let confirm: Rc<dyn Fn()> = {
        let run = run.clone();
        let selected = selected.clone();
        Rc::new(move || run(selected.get()))
    };
    let previous: Rc<dyn Fn()> = {
        let step = step.clone();
        Rc::new(move || step(-1))
    };
    let next: Rc<dyn Fn()> = {
        let step = step.clone();
        Rc::new(move || step(1))
    };
    cx.layer(KeymapLayer {
        commands: vec![
            bind("return", "Confirm Go option", confirm),
            bind("left", "Previous Go option", previous.clone()),
            bind("up", "Previous Go option", previous.clone()),
            bind("shift+tab", "Previous Go option", previous),
            bind("right", "Next Go option", next.clone()),
            bind("down", "Next Go option", next.clone()),
            bind("tab", "Next Go option", next),
        ],
        ..KeymapLayer::default()
    });

    let button = |index: usize| {
        let label = Text::new(app, ACTIONS[index]);
        let view = View::new(app).padding_x(2).child(&label);
        let hover = selected.clone();
        let paint_hover = paint.clone();
        let run = run.clone();
        view.on_hover(move |_, hovered| {
            if hovered {
                hover.set(index);
                paint_hover();
            }
        });
        view.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
            if matches!(event.kind, MouseEventKind::Up(_)) {
                run(index);
            }
        });
        buttons.borrow_mut().push((view.clone(), label));
        view
    };

    let inset = if narrow { 2 } else { 3 };
    let root = View::new(app).padding_x(inset).padding_edge(Edge::Bottom, if short { 0 } else { 1 }).gap(if short {
        0
    } else {
        1
    });
    let close = Text::new(app, "esc").fg(theme.text.muted).bg(text_bg);
    let dialogs = cx.dialogs.clone();
    close.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
        if matches!(event.kind, MouseEventKind::Up(_)) {
            dialogs.clear();
        }
    });
    root.add(
        &View::new(app)
            .row()
            .justify(Justify::SpaceBetween)
            .shrink(0.0)
            .child(&Text::new(app, "Free limit reached").bold().fg(theme.text.base).bg(text_bg))
            .child(&close),
    );
    let reset = offer.reset.as_ref().map_or(String::new(), |reset| format!(" Resets at {reset}."));
    let used = Text::new(app, format!("You've used today's free messages.{reset}"))
        .fg(theme.text.muted)
        .bg(text_bg)
        .wrap(WrapMode::Word);
    let pitch = Text::new(app, "OpenCode Go gives you reliable access to the best open-source models for $10/month.")
        .fg(theme.text.muted)
        .bg(text_bg)
        .wrap(WrapMode::Word);
    let link = Text::new(app, vec![GO_URL.fg(primary).link(GO_URL)]).bg(text_bg).wrap(WrapMode::None);
    let compact = short || height < if narrow { 26 } else { 22 };
    if compact {
        // TS's scrollbox takes its whole `maxHeight`, so the panel reaches the buttons at the bottom.
        let top = if short { 1 } else { height / 4 + 1 };
        let footer_rows = if narrow { ACTIONS.len() as u16 } else { 1 };
        let gaps = if short { 1 } else { 4 };
        let body = height.saturating_sub(top + footer_rows + gaps).max(2);
        let scroll = ScrollBox::new(app).scrollbars(false).height(u32::from(body)).shrink(1.0);
        scroll.add(&used);
        scroll.add(&pitch);
        scroll.add(&link);
        root.add(&scroll);
    } else {
        root.add(&View::new(app).child(&used).child(&pitch));
        root.add(
            &View::new(app)
                .height(7)
                .padding_edge(Edge::Bottom, 1)
                .align_items(Align::Center)
                .justify(Justify::End)
                .child(&link),
        );
    }
    if narrow {
        let column = View::new(app).align_items(Align::Start).shrink(0.0);
        for index in 0..ACTIONS.len() {
            column.add(&button(index));
        }
        root.add(&column);
    } else {
        root.add(
            &View::new(app)
                .row()
                .justify(Justify::SpaceBetween)
                .shrink(0.0)
                .child(&button(0))
                .child(&View::new(app).row().gap(1).child(&button(1)).child(&button(2))),
        );
    }
    paint();
    root
}

fn dont_show_again(local: &Rc<Local>) {
    local.go_memory.borrow_mut().dont_show = true;
    let Some(storage) = local.storage.clone() else {
        return;
    };
    local.app.runtime().spawn_blocking(move || {
        let result = storage.update("go-upsell", &json!({}), |draft| {
            if !draft.is_object() {
                *draft = json!({});
            }
            draft["dontShow"] = json!(true);
        });
        if let Err(error) = result {
            log::warn!("go-upsell: {error}");
        }
    });
}

/// `DialogGoUpsellConnect`: signs in to OpenCode Console with its device OAuth method, then switches to an
/// OpenCode Go model and resends the prompt.
fn connect(local: &Rc<Local>, offer: Offer) {
    let weak = Rc::downgrade(local);
    local.dialogs.replace(
        move |cx| match weak.upgrade() {
            Some(local) => build_connect(cx, &local, offer),
            None => View::new(&cx.app),
        },
        None,
        DialogOptions::default(),
    );
}

struct Connect {
    local: Rc<Local>,
    offer: Offer,
    title: Text,
    body: View,
    footer: View,
    cx: Rc<DialogCx>,
    // For the footer actions, which outlive a render.
    me: Weak<Connect>,
    attempt: RefCell<Option<IntegrationAttempt>>,
    started: Cell<bool>,
    settled: Cell<bool>,
    closed: Cell<bool>,
    timer: Cell<Option<TimerId>>,
}

fn build_connect(cx: &Rc<DialogCx>, local: &Rc<Local>, offer: Offer) -> View {
    let app = &cx.app;
    let title = Text::new(app, "Connect an integration").fg(cx.theme.text.base);
    let head = header(cx, HeaderProps { title_view: Some(title.as_any()), ..HeaderProps::default() });
    let body = View::new(app).gap(1);
    let footer_slot = View::new(app);
    let state = Rc::new_cyclic(|me| Connect {
        local: local.clone(),
        offer,
        title,
        body: body.clone(),
        footer: footer_slot.clone(),
        cx: cx.clone(),
        me: me.clone(),
        attempt: RefCell::new(None),
        started: Cell::new(false),
        settled: Cell::new(false),
        closed: Cell::new(false),
        timer: Cell::new(None),
    });
    state.render();
    let open = {
        let state = Rc::downgrade(&state);
        bind!(state, |state, _: Option<&str>, _: Option<&KeyEvent>| state.open())
    };
    let copy = {
        let state = Rc::downgrade(&state);
        bind!(state, |state, _: Option<&str>, _: Option<&KeyEvent>| state.copy())
    };
    let enabled = {
        let state = Rc::downgrade(&state);
        Condition::when(move || state.upgrade().is_some_and(|state| state.attempt.borrow().is_some()))
    };
    cx.layer(KeymapLayer {
        enabled,
        commands: vec![
            TuiCommand::inline("return", open).title("Open authorization URL").group("Dialog"),
            TuiCommand::inline("c", copy).title("Copy authorization details").group("Dialog"),
        ],
        ..KeymapLayer::default()
    });
    // Closing cancels a pending attempt.
    let closing = state.clone();
    cx.on_close(opentui::keymap::Disposer::new(move || closing.close()));
    state.start();
    layout_view(cx, &head, &body, Some(&footer_slot), DIALOG_INSET, 1)
}

impl Connect {
    fn location(&self) -> Option<LocationQueryInput> {
        self.local.location()
    }

    fn render(&self) {
        let app = &self.cx.app;
        let theme = &self.cx.theme;
        self.body.clear();
        self.footer.clear();
        let attempt = self.attempt.borrow().clone();
        if let Some(attempt) = &attempt {
            let details = View::new(app).gap(1).child(
                &Text::new(app, vec![attempt.url.as_str().fg(theme.markdown.link).link(attempt.url.clone())])
                    .wrap(WrapMode::Word),
            );
            if !attempt.instructions.is_empty() {
                details.add(&Text::new(app, attempt.instructions.clone()).fg(theme.text.muted));
            }
            self.body.add(&details);
        }
        let action = |title: &str, key: &str, run: fn(&Connect)| {
            let me = self.me.clone();
            FooterAction::new(title).key(key).on_trigger(bind!(me, |state| run(&state)))
        };
        let primary = match &attempt {
            Some(attempt) => vec![
                action(
                    if oauth_code(&attempt.instructions).is_some() { "copy code" } else { "copy link" },
                    "c",
                    Connect::copy,
                ),
                action("open link", "enter", Connect::open),
            ],
            None => Vec::new(),
        };
        self.footer.add(&footer(&self.cx, FooterProps { primary, ..FooterProps::default() }));
        self.body.add(
            &Text::new(app, if attempt.is_some() { "Waiting for authorization…" } else { "Starting authorization…" })
                .fg(theme.text.muted),
        );
        app.request_redraw();
    }

    // The `opencode` integration and its device OAuth method, once the integrations have loaded.
    fn method(&self) -> Option<(String, Vec<Value>)> {
        let integration = self.local.integrations()?.into_iter().find(|item| item.id.0 == "opencode")?;
        integration.methods.into_iter().find_map(|method| match method {
            // The fields as JSON: only `type`, `key`, and `default` matter for the answer.
            IntegrationMethod::Oauth(method) if method.id.0 == "device" => Some((
                method.label,
                method.form.unwrap_or_default().iter().filter_map(|field| serde_json::to_value(field).ok()).collect(),
            )),
            _ => None,
        })
    }

    // The first credential connection has no error status.
    fn valid(&self) -> bool {
        let Some(integration) =
            self.local.integrations().and_then(|list| list.into_iter().find(|item| item.id.0 == "opencode"))
        else {
            return false;
        };
        integration
            .connections
            .iter()
            .find_map(|connection| match connection {
                ConnectionInfo::Credential(credential) => Some(credential.status.is_none()),
                _ => None,
            })
            .unwrap_or(false)
    }

    fn start(self: &Rc<Self>) {
        if self.started.get() || self.closed.get() {
            return;
        }
        let Some((label, form)) = self.method() else {
            // Wait for the integrations, which the dialog asks for again.
            self.cx.on_close(self.local.subscribe(bind!(self, |state| state.start())));
            if self.local.integrations().is_none() {
                self.local.load_integrations();
            }
            return;
        };
        self.started.set(true);
        self.title.set_text(label);
        if self.valid() {
            let weak = Rc::downgrade(self);
            self.sync(false, move |outcome| {
                if outcome.is_none()
                    && let Some(state) = weak.upgrade()
                    && !state.closed.get()
                {
                    state.start_oauth(&form);
                }
            });
            return;
        }
        self.start_oauth(&form);
    }

    fn start_oauth(self: &Rc<Self>, form: &[Value]) {
        let answer: serde_json::Map<String, Value> = form
            .iter()
            .filter(|field| field["type"] != "external" && !field["default"].is_null())
            .filter_map(|field| Some((field["key"].as_str()?.to_owned(), field["default"].clone())))
            .collect();
        let input = IntegrationOauthConnectInput {
            integration_id: IntegrationID("opencode".into()),
            location: self.location(),
            method_id: IntegrationMethodID("device".into()),
            answer: (!answer.is_empty()).then(|| serde_json::from_value(Value::Object(answer)).ok()).flatten(),
            label: None,
        };
        let client = self.local.client.clone();
        self.local.app.spawn(
            async move { client.integration_oauth_connect(&input, &RequestOptions::default()).await },
            bind!(self, |state, _, result| {
                match result {
                    Ok(output) if state.closed.get() => state.cancel(output.data.attempt_id),
                    Ok(output) => {
                        *state.attempt.borrow_mut() = Some(output.data.clone());
                        state.render();
                        state.poll(output.data.attempt_id);
                    }
                    Err(error) if !state.closed.get() => state.fail(error.to_string()),
                    Err(_) => {}
                }
            }),
        );
    }

    fn poll(self: &Rc<Self>, attempt: IntegrationAttemptID) {
        let input = IntegrationOauthStatusInput {
            integration_id: IntegrationID("opencode".into()),
            attempt_id: attempt.clone(),
            location: self.location(),
        };
        let client = self.local.client.clone();
        let weak = Rc::downgrade(self);
        self.local.app.spawn(
            async move { client.integration_oauth_status(&input, &RequestOptions::default()).await },
            bind!(weak, |state, cx, result| {
                if state.closed.get() {
                    return;
                }
                let status = match result {
                    Ok(output) => output.data,
                    Err(error) => {
                        state.settled.set(true);
                        state.fail(error.to_string());
                        return;
                    }
                };
                match status {
                    IntegrationAttemptStatus::Pending(_) => {
                        state.timer.set(Some(
                            cx.set_timeout(Duration::from_millis(500), bind!(state, |state, _| state.poll(attempt))),
                        ));
                    }
                    IntegrationAttemptStatus::Complete(_) => {
                        state.settled.set(true);
                        let weak = Rc::downgrade(&state);
                        state.sync(true, move |outcome| {
                            if outcome.is_none()
                                && let Some(state) = weak.upgrade()
                                && !state.closed.get()
                            {
                                state.local.dialogs.clear();
                            }
                        });
                    }
                    IntegrationAttemptStatus::Failed(failed) => {
                        state.settled.set(true);
                        state.fail(failed.message);
                    }
                    _ => {
                        state.settled.set(true);
                        state.fail("Authorization expired".into());
                    }
                }
            }),
        );
    }

    // Reloads the integrations, models, and providers. `done` gets `Some(true)` after finishing, `Some(false)`
    // when closed or failed, and `None` when the connection is not valid yet.
    fn sync(self: &Rc<Self>, announce: bool, done: impl FnOnce(Option<bool>) + 'static) {
        let client = self.local.client.clone();
        let location = self.location();
        self.local.app.spawn(
            async move {
                let options = RequestOptions::default();
                let integrations = client
                    .integration_list(
                        &opencode_api::generated::IntegrationListInput { location: location.clone() },
                        &options,
                    )
                    .await?;
                let models = client
                    .model_list(
                        &opencode_api::generated::ModelListInput { location: location.clone(), types: None },
                        &options,
                    )
                    .await?;
                let providers =
                    client.provider_list(&opencode_api::generated::ProviderListInput { location }, &options).await?;
                Ok::<_, opencode_api::error::Error>((integrations.data, models.data, providers.data))
            },
            bind!(self, |state, _, result| {
                if state.closed.get() || state.local.dialogs.is_empty() {
                    return done(Some(false));
                }
                match result {
                    Ok((integrations, models, providers)) => {
                        state.local.set_catalog(integrations, models, providers);
                    }
                    Err(error) => {
                        state.fail(error.to_string());
                        return done(Some(false));
                    }
                }
                if !state.valid() {
                    return done(None);
                }
                if announce {
                    let name = state
                        .local
                        .integrations()
                        .and_then(|list| list.into_iter().find(|item| item.id.0 == "opencode"))
                        .map_or("OpenCode Console".to_owned(), |item| item.name);
                    state.local.toasts.show(ToastOptions::new(Variant::Success, format!("Connected {name}")));
                }
                state.finish();
                done(Some(true));
            }),
        );
    }

    fn finish(&self) {
        let local = &self.local;
        if !(self.offer.can_continue)() {
            local.dialogs.clear();
            return;
        }
        let go = local
            .models()
            .into_iter()
            .find(|item| item.provider_id.0 == "opencode-go" && !matches!(item.status, ModelInfoStatus::Deprecated));
        match go {
            Some(go) => {
                local.set(&Model::new(&go.provider_id.0, &go.id), true);
                local.dialogs.clear();
                (self.offer.on_subscribe)();
            }
            None => crate::dialogs::model::show(local, None),
        }
    }

    fn fail(&self, message: String) {
        self.local.toasts.show(ToastOptions::new(Variant::Error, message));
        self.local.dialogs.clear();
    }

    fn cancel(&self, attempt: IntegrationAttemptID) {
        let input = IntegrationOauthCancelInput {
            integration_id: IntegrationID("opencode".into()),
            attempt_id: attempt,
            location: self.location(),
        };
        let client = self.local.client.clone();
        self.local
            .app
            .spawn(async move { client.integration_oauth_cancel(&input, &RequestOptions::default()).await }, |_, _| {});
    }

    fn close(&self) {
        self.closed.set(true);
        if let Some(timer) = self.timer.take() {
            self.local.app.cancel_timer(timer);
        }
        if self.settled.get() {
            return;
        }
        if let Some(attempt) = self.attempt.borrow().clone() {
            self.cancel(attempt.attempt_id);
        }
    }

    fn open(&self) {
        let Some(attempt) = self.attempt.borrow().clone() else {
            return;
        };
        if (self.local.open_url.borrow())(&attempt.url).is_err() {
            self.local.toasts.show(ToastOptions::new(
                Variant::Error,
                "Could not open the browser. Copy the URL and continue manually.",
            ));
        }
    }

    fn copy(&self) {
        let Some(attempt) = self.attempt.borrow().clone() else {
            return;
        };
        let value = oauth_code(&attempt.instructions).unwrap_or(attempt.url);
        if self.local.app.copy_to_clipboard(&value) {
            self.local.toasts.show(ToastOptions::new(Variant::Info, "Copied to clipboard"));
            return;
        }
        self.local.toasts.error("Could not copy to the clipboard");
    }
}

// `/[A-Z0-9]{4}-[A-Z0-9]{4,5}/`.
fn oauth_code(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let code = |c: &char| c.is_ascii_uppercase() || c.is_ascii_digit();
    (0..chars.len()).find_map(|start| {
        let head = chars.get(start..start + 4)?;
        if !head.iter().all(code) || chars.get(start + 4) != Some(&'-') {
            return None;
        }
        let tail = chars[start + 5..].iter().take(5).take_while(|c| code(c)).count();
        (tail >= 4).then(|| chars[start..start + 5 + tail].iter().collect())
    })
}

/// Opens a URL in the user's browser (`@opencode/util/open`).
pub fn open_url(url: &str) -> Result<(), String> {
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_once_a_day_unless_turned_off() {
        let now = 10.0 * DAY_MS;
        let mut empty = json!({});
        assert_eq!(claim(&mut empty, now), Claim::Claimed);
        assert_eq!(empty, json!({ "lastSeenAt": now as i64 }));
        let mut recent = json!({ "lastSeenAt": now - 1000.0 });
        assert_eq!(claim(&mut recent, now), Claim::Recent(Some(now - 1000.0)));
        let mut old = json!({ "lastSeenAt": now - DAY_MS, "other": 1 });
        assert_eq!(claim(&mut old, now), Claim::Claimed);
        assert_eq!(old, json!({ "lastSeenAt": now as i64, "other": 1 }));
        let mut off = json!({ "dontShow": true, "lastSeenAt": 5.0 });
        assert_eq!(claim(&mut off, now), Claim::DontShow(Some(5.0)));
    }

    #[test]
    fn finds_the_device_code() {
        assert_eq!(oauth_code("Enter code ABCD-1234 at the page").as_deref(), Some("ABCD-1234"));
        assert_eq!(oauth_code("code WXYZ-12345!").as_deref(), Some("WXYZ-12345"));
        assert_eq!(oauth_code("abcd-1234"), None);
        assert_eq!(oauth_code("ABCD-123"), None);
    }
}
