//! The DevTools bar (E.18a): `packages/tui/src/component/devtools-bar.tsx`, row T08.
//!
//! One row at the bottom: Server, UI, Theme, and Tools open a panel above their item, and Experiments opens the
//! experiments dialog. It shows when `debug.devtools` is on, or by default on the `local` channel
//! (`app.tsx:497`). Escape, Ctrl+C, or a click outside closes the panel. The bar is rebuilt on every change: it
//! is a handful of widgets.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use opencode_api::client::RequestOptions;
use opencode_api::events::{State, Status};
use opencode_api::generated::ExperimentalSessionLogInput;
use opencode_api::generated::ServerInfo;
use opencode_api::transport::SseResponse;
use opencode_local::cli_config::{Info, TurnTokens};
use opencode_ui::bind;
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::theme::{Theme, ThemeMode};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use serde_json::{Value, json};

use crate::app::Tui;
use crate::dialogs::settings::{self, set_path};
use crate::routes::Route;

pub const GRAPH_WIDTH: usize = 23;
const SAMPLE_INTERVAL: Duration = Duration::from_secs(2);
const SAMPLE_RETENTION: Duration = Duration::from_secs(30);
const STATUS_WINDOW: Duration = Duration::from_secs(6);
const PANEL_WIDTH: u32 = 42;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Panel {
    Server,
    Ui,
    Theme,
    Tools,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeStatus {
    Normal,
    Medium,
    High,
}

impl RuntimeStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

/// One process sample: CPU percent, resident memory in bytes, timer delay in ms.
#[derive(Clone, Copy, Debug)]
pub struct Sample {
    pub cpu: f64,
    pub memory: f64,
    pub delay: f64,
    pub time: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Indicator {
    Connected,
    Reconnecting,
    Disconnected,
}

/// `connectionIndicator`.
pub fn connection_indicator(status: Status, attempt: u32) -> (Indicator, &'static str) {
    match status {
        Status::Connected => (Indicator::Connected, "✓"),
        Status::Reconnecting if attempt >= 3 => (Indicator::Disconnected, "×"),
        _ => (Indicator::Reconnecting, "↻"),
    }
}

/// `runtimeStatus`: the highest delay in the last 6 s.
pub fn runtime_status(samples: &[Sample]) -> RuntimeStatus {
    let Some(latest) = samples.last().map(|sample| sample.time) else {
        return RuntimeStatus::Normal;
    };
    let delay = samples
        .iter()
        .filter(|sample| sample.time + STATUS_WINDOW > latest)
        .map(|sample| sample.delay)
        .fold(0.0, f64::max);
    if delay >= 100.0 {
        return RuntimeStatus::High;
    }
    if delay >= 20.0 {
        return RuntimeStatus::Medium;
    }
    RuntimeStatus::Normal
}

/// `statusIcon`.
pub fn status_icon(status: RuntimeStatus) -> &'static str {
    match status {
        RuntimeStatus::High => "●",
        RuntimeStatus::Medium => "⦿",
        RuntimeStatus::Normal => "○",
    }
}

/// `brailleGraph`: two values per cell, each a column of 1 to 4 dots scaled between the minimum and maximum.
pub fn braille_graph(values: &[f64], width: usize) -> String {
    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let range = values.iter().copied().fold(f64::NEG_INFINITY, f64::max) - min;
    let pad = (width * 2).saturating_sub(values.len());
    let points: Vec<Option<f64>> =
        std::iter::repeat_n(values.first().copied(), pad).chain(values.iter().copied().map(Some)).collect();
    let points = &points[points.len().saturating_sub(width * 2)..];
    const DOTS: [[u32; 4]; 2] = [[6, 2, 1, 0], [7, 5, 4, 3]];
    (0..width)
        .map(|index| {
            let bits = (0..2).fold(0u32, |bits, column| {
                let Some(Some(value)) = points.get(index * 2 + column) else {
                    return bits;
                };
                let scaled = if range == 0.0 { 0.0 } else { (value - min) / range };
                // `Math.round` rounds halves up.
                let height = 1 + (scaled * 3.0 + 0.5).floor() as usize;
                DOTS[column][..height.min(4)].iter().fold(bits, |bits, dot| bits | (1 << dot))
            });
            char::from_u32(0x2800 + bits).unwrap_or(' ')
        })
        .collect()
}

/// `debug.devtools`, else on for the `local` channel.
pub fn enabled(info: &Info) -> bool {
    info.debug
        .as_ref()
        .and_then(|debug| debug.devtools)
        .unwrap_or_else(|| opencode_local::channel::Channels::from_env().channel == "local")
}

struct Bar {
    tui: Weak<Tui>,
    root: View,
    panel: Cell<Option<Panel>>,
    state: RefCell<State>,
    server: RefCell<Option<Result<ServerInfo, String>>>,
    samples: RefCell<Vec<Sample>>,
    dumping: Cell<bool>,
    dump: RefCell<Option<Result<String, String>>>,
    focus: RefCell<Option<AnyWidget>>,
    first_draw: Cell<Option<f64>>,
    _layer: RefCell<Option<Disposer>>,
}

/// Adds the bar to the bottom of `parent` and keeps it in step with the config, the connection, and the UI
/// samples.
pub fn mount(tui: &Rc<Tui>, parent: &View) {
    let root = View::new(&tui.app).row().height(1).shrink(0.0);
    parent.add(&root);
    let bar = Rc::new(Bar {
        tui: tui.weak(),
        root,
        panel: Cell::new(None),
        state: RefCell::new(State { status: Status::Connecting, attempt: 0, error: None }),
        server: RefCell::new(None),
        samples: RefCell::new(Vec::new()),
        dumping: Cell::new(false),
        dump: RefCell::new(None),
        focus: RefCell::new(None),
        first_draw: Cell::new(None),
        _layer: RefCell::new(None),
    });
    install_escape(tui, &bar);
    install_connection(tui, &bar);
    install_samples(tui, &bar);
    bar.render(tui);
    // The config listener owns the bar, so it lives as long as the TUI; the bar holds the TUI weakly.
    tui.settings.on_change(move |tui| bar.render(tui));
}

fn install_escape(tui: &Rc<Tui>, bar: &Rc<Bar>) {
    let open = {
        let weak = Rc::downgrade(bar);
        Condition::when(move || weak.upgrade().is_some_and(|bar| bar.panel.get().is_some()))
    };
    let close = |key: &str| {
        TuiCommand::inline(
            key,
            bind!(bar, |bar, _, _| {
                let Some(tui) = bar.tui.upgrade() else { return };
                if tui.app.selected_text().is_some() {
                    tui.app.clear_selection();
                    return;
                }
                bar.close(&tui);
            }),
        )
    };
    let layer = KeymapLayer::new(vec![close("escape"), close("ctrl+c")]).enabled(open).priority(10);
    match tui.keymap.layer(layer) {
        Ok(disposer) => *bar._layer.borrow_mut() = Some(disposer),
        Err(error) => log::error!("devtools keymap layer: {error}"),
    }
}

/// Connection state from the event connection; server details once connected.
fn install_connection(tui: &Rc<Tui>, bar: &Rc<Bar>) {
    struct Changed(State);
    tui.app.on_message(bind!(bar, |bar, _, Changed(state): &Changed| {
        let Some(tui) = bar.tui.upgrade() else { return };
        let connected = state.status == Status::Connected;
        let was = bar.state.replace(state.clone()).status == Status::Connected;
        if connected && !was {
            bar.fetch_server(&tui);
        }
        bar.render(&tui);
    }));
    let Some(mut watch) = tui.connection_watch() else {
        return;
    };
    let proxy = tui.app.proxy();
    tui.app.runtime().spawn(async move {
        loop {
            let current = watch.borrow_and_update().clone();
            if proxy.send(Changed(current)).is_err() || watch.changed().await.is_err() {
                return;
            }
        }
    });
}

/// Takes a UI sample now and every 2 s: CPU, memory, and how late the sampling timer fired.
fn install_samples(tui: &Rc<Tui>, bar: &Rc<Bar>) {
    let last = Cell::new((tui.app.now(), cpu_time(), false));
    let sample = bind!(bar, |bar, now: Instant| {
        let (then, cpu_then, ready) = last.get();
        let cpu_now = cpu_time();
        let elapsed = now.saturating_duration_since(then);
        let delay = elapsed.saturating_sub(SAMPLE_INTERVAL).as_secs_f64() * 1000.0;
        let cpu = if ready && !elapsed.is_zero() {
            ((cpu_now - cpu_then) / elapsed.as_secs_f64() * 100.0).max(0.0)
        } else {
            0.0
        };
        last.set((now, cpu_now, true));
        let mut samples = bar.samples.borrow_mut();
        samples.push(Sample { cpu, memory: memory(), delay: if ready { delay } else { 0.0 }, time: now });
        samples.retain(|sample| sample.time + SAMPLE_RETENTION >= now);
        drop(samples);
        if let Some(tui) = bar.tui.upgrade()
            && bar.panel.get() == Some(Panel::Ui)
        {
            bar.render(&tui);
        }
    });
    sample(tui.app.now());
    tui.app.set_interval(SAMPLE_INTERVAL, move |cx| sample(cx.now()));
}

impl Bar {
    fn toggle(self: &Rc<Self>, tui: &Tui, panel: Panel) {
        if self.panel.get() == Some(panel) {
            return self.close(tui);
        }
        if self.panel.get().is_none() {
            *self.focus.borrow_mut() = tui.app.focused();
            tui.app.blur();
        }
        self.panel.set(Some(panel));
        self.render(tui);
    }

    fn close(self: &Rc<Self>, tui: &Tui) {
        self.panel.set(None);
        self.render(tui);
        if let Some(focus) = self.focus.borrow_mut().take()
            && focus.is_shown()
        {
            tui.app.focus(&focus);
        }
    }

    fn weak(self: &Rc<Self>) -> Weak<Self> {
        Rc::downgrade(self)
    }

    fn fetch_server(self: &Rc<Self>, tui: &Tui) {
        let client = tui.data.client().clone();
        let weak = self.weak();
        tui.app.spawn(
            async move { client.server_info(&RequestOptions::default()).await },
            bind!(weak, |bar, _, result| {
                let Some(tui) = bar.tui.upgrade() else { return };
                *bar.server.borrow_mut() = Some(result.map_err(|error| error.to_string()));
                bar.render(&tui);
            }),
        );
    }

    /// Rebuilds the bar.
    fn render(self: &Rc<Self>, tui: &Tui) {
        let info = tui.settings.info();
        let app = &tui.app;
        let theme = tui.page();
        self.root.clear();
        self.root.visible(enabled(&info));
        if !enabled(&info) {
            if self.panel.take().is_some() {
                tui.app.request_redraw();
            }
            return;
        }
        self.root.bg(theme.decrease(&theme.background.base, 1));
        let panel = self.panel.get();
        if panel.is_some() {
            let (width, height) = app.size();
            let weak = Rc::downgrade(self);
            let tui_weak = self.tui.clone();
            self.root.add(
                &View::new(app)
                    .absolute()
                    .z_index(2400)
                    .position(Edge::Left, 0)
                    .position(Edge::Bottom, 1)
                    .size(width, height.saturating_sub(1))
                    .on_mouse(move |_, event| {
                        if matches!(event.kind, MouseEventKind::Up(_))
                            && let (Some(bar), Some(tui)) = (weak.upgrade(), tui_weak.upgrade())
                        {
                            defer(&tui, move |tui| bar.close(tui));
                        }
                    }),
            );
        }
        let focused = theme.text.action.primary.focused;
        let state = self.state.borrow().clone();
        let (indicator, icon) = connection_indicator(state.status, state.attempt);

        // Server
        let server_open = panel == Some(Panel::Server);
        let item = self.item(tui, server_open, Some(Panel::Server));
        item.add(&Text::new(app, icon).fg(match (server_open, indicator) {
            (true, _) => focused,
            (_, Indicator::Connected) => theme.text.feedback.success.base,
            (_, Indicator::Disconnected) => theme.text.feedback.error.base,
            _ => theme.text.base,
        }));
        item.add(&Text::new(app, " Server").fg(match (server_open, indicator) {
            (true, _) => focused,
            (_, Indicator::Disconnected) => theme.text.feedback.error.base,
            _ => theme.text.muted,
        }));
        if server_open {
            item.add(&self.server_panel(tui, &theme, &state));
        }

        // UI
        let ui_open = panel == Some(Panel::Ui);
        let runtime = runtime_status(&self.samples.borrow());
        let color = if ui_open {
            focused
        } else if runtime == RuntimeStatus::High {
            theme.text.feedback.error.base
        } else {
            theme.text.muted
        };
        let item = self.item(tui, ui_open, Some(Panel::Ui));
        item.add(&Text::new(app, status_icon(runtime)).fg(color));
        item.add(&Text::new(app, " UI").fg(color));
        if ui_open {
            item.add(&self.ui_panel(tui, &theme, runtime));
        }

        // Theme
        let theme_open = panel == Some(Panel::Theme);
        let item = self.item(tui, theme_open, Some(Panel::Theme));
        item.add(&Text::new(app, "Theme").fg(if theme_open { focused } else { theme.text.muted }));
        if theme_open {
            item.add(&self.theme_panel(tui, &theme));
        }

        // Tools
        let tools_open = panel == Some(Panel::Tools);
        let item = self.item(tui, tools_open, Some(Panel::Tools));
        item.add(&Text::new(app, "Tools").fg(if tools_open { focused } else { theme.text.muted }));
        if tools_open {
            item.add(&self.tools_panel(tui, &theme, &info));
        }

        // Experiments
        let item = self.item(tui, false, None);
        item.add(&Text::new(app, "Experiments").fg(theme.text.muted));

        let rest = View::new(app).grow(1.0).basis(Length::Auto).min_width(0);
        if info.debug.as_ref().and_then(|debug| debug.timing).unwrap_or(false) {
            let ms = *self.first_draw.get().get_or_insert_with(process_age_ms);
            self.first_draw.set(Some(ms));
            rest.add(
                &View::new(app).row().justify(Justify::Center).child(
                    &Text::new(app, format!("Time to first draw: {ms:.2}ms")).fg(theme.text.muted).truncate(true),
                ),
            );
        }
        self.root.add(&rest);
        tui.app.request_redraw();
    }

    /// `BarItem`: one cell of padding, the hover and active backgrounds, and a click that does not end a
    /// selection. `panel` is what it toggles; `None` opens the experiments dialog.
    fn item(self: &Rc<Self>, tui: &Tui, active: bool, panel: Option<Panel>) -> View {
        let theme = tui.page();
        let item = View::new(&tui.app).row().height(1).padding_x(1);
        if active {
            item.z_index(2500).bg(theme.background.action.primary.focused);
        } else {
            // Restyled in place: a rebuild between press and release would drop the pressed widget.
            let hovered = theme.background.action.primary.hovered;
            let view = item.clone();
            item.on_hover(move |cx, on| {
                view.bg(if on { hovered } else { Color::TRANSPARENT });
                cx.app().request_redraw();
            });
        }
        let weak = Rc::downgrade(self);
        item.mouse_pointer(MousePointer::POINTER).on_mouse(move |cx, event| {
            if !matches!(event.kind, MouseEventKind::Up(_)) {
                return;
            }
            let Some(bar) = weak.upgrade() else { return };
            let Some(tui) = bar.tui.upgrade() else { return };
            if tui.app.selected_text().is_some() {
                return;
            }
            cx.stop_propagation();
            defer(&tui, move |tui| match panel {
                Some(panel) => bar.toggle(tui, panel),
                None => {
                    bar.close(tui);
                    crate::dialogs::experiments::show(tui);
                }
            });
        });
        self.root.add(&item);
        item
    }

    fn server_panel(&self, tui: &Tui, theme: &Theme, state: &State) -> View {
        let app = &tui.app;
        let panel = panel_box(app, theme, "Server");
        let status = match state.status {
            Status::Connected => "Connected",
            Status::Connecting => "connecting",
            Status::Reconnecting => "reconnecting",
        };
        panel.add(&row(app, theme, "Status", status));
        if state.attempt > 0 {
            panel.add(&row(app, theme, "Reconnect", &state.attempt.to_string()));
        }
        if let Some(error) = &state.error {
            panel.add(&row(app, theme, "Last error", error));
        }
        match self.server.borrow().as_ref() {
            Some(Ok(info)) => {
                panel.add(&row(app, theme, "Version", &info.version));
                panel.add(&row(app, theme, "PID", &info.pid.to_string()));
                let address = info.urls.first().map_or_else(|| "Unknown".to_owned(), |url| url_host(url));
                panel.add(&row(app, theme, "Address", &address));
            }
            Some(Err(_)) => {
                panel.add(&Text::new(app, "Server details unavailable").fg(theme.text.feedback.error.base));
            }
            None => {}
        }
        panel
    }

    fn ui_panel(self: &Rc<Self>, tui: &Tui, theme: &Theme, runtime: RuntimeStatus) -> View {
        let app = &tui.app;
        let panel = panel_box(app, theme, "UI");
        panel.add(&row(app, theme, "Status", runtime.as_str()));
        let samples = self.samples.borrow();
        let series = |pick: fn(&Sample) -> f64| samples.iter().map(pick).collect::<Vec<_>>();
        panel.add(&process_stat(app, theme, "Loop", &series(|s| s.delay), " ms", 1));
        panel.add(&process_stat(app, theme, "CPU", &series(|s| s.cpu), "%", 1));
        panel.add(&process_stat(app, theme, "Memory", &series(|s| s.memory / 1024.0 / 1024.0), " MB", 0));
        let overlay = tui.app.debug_overlay().is_some();
        panel.add(&self.action(
            tui,
            &format!("{} Debug overlay", if overlay { "[x]" } else { "[ ]" }),
            false,
            |bar, tui| {
                tui.app.toggle_debug_overlay();
                bar.render(tui);
            },
        ));
        panel
    }

    fn theme_panel(self: &Rc<Self>, tui: &Tui, theme: &Theme) -> View {
        let app = &tui.app;
        let panel = panel_box(app, theme, "Theme");
        let (name, mode, next, supported) = {
            let state = tui.theme.borrow();
            let next = if state.mode() == ThemeMode::Dark { ThemeMode::Light } else { ThemeMode::Dark };
            (state.selected().to_owned(), state.mode(), next, state.supports(next))
        };
        panel.add(&row(app, theme, "Name", &name));
        panel.add(&row(app, theme, "Mode", mode_name(mode)));
        if supported {
            panel.add(&self.action(tui, &format!("Switch to {}", mode_name(next)), false, move |bar, tui| {
                tui.theme.borrow_mut().set_mode(Some(next), true);
                tui.theme_changed();
                bar.render(tui);
            }));
        }
        panel
    }

    fn tools_panel(self: &Rc<Self>, tui: &Tui, theme: &Theme, info: &Info) -> View {
        let app = &tui.app;
        let panel = panel_box(app, theme, "Tools");
        let dumping = self.dumping.get();
        panel.add(&self.action(
            tui,
            if dumping { "Writing debug snapshot…" } else { "Write debug snapshot" },
            dumping,
            |bar, tui| bar.write_snapshot(tui),
        ));
        match self.dump.borrow().as_ref() {
            Some(Ok(path)) => {
                panel.add(&Text::new(app, path.clone()).fg(theme.text.muted).wrap(WrapMode::Word));
            }
            Some(Err(error)) => {
                panel.add(&Text::new(app, error.clone()).fg(theme.text.feedback.error.base).wrap(WrapMode::Word));
            }
            None => {}
        }
        let debug = info.debug.clone().unwrap_or_default();
        let timing = debug.timing.unwrap_or(false);
        let tokens = debug.turn_tokens.unwrap_or(TurnTokens::Enabled(false));
        let render = View::new(app).margin_edge(Edge::Top, 1);
        render.add(&Text::new(app, "Render").fg(theme.text.base).bold());
        let check = |on: bool| if on { "[x]" } else { "[ ]" };
        render.add(&self.action(tui, &format!("{} Time to first draw", check(timing)), false, move |_, tui| {
            settings::update(tui, move |draft| set_path(draft, &["debug", "timing"], Value::Bool(!timing)))
        }));
        let on = tokens != TurnTokens::Enabled(false);
        render.add(&self.action(tui, &format!("{} Turn token usage", check(on)), false, move |_, tui| {
            settings::update(tui, move |draft| set_path(draft, &["debug", "turn_tokens"], Value::Bool(!on)))
        }));
        if on {
            let verbose = tokens == TurnTokens::Verbose;
            render.add(&self.action(
                tui,
                &format!("{} Turn token usage (verbose)", check(verbose)),
                false,
                move |_, tui| {
                    let next = if verbose { json!(true) } else { json!("verbose") };
                    settings::update(tui, move |draft| set_path(draft, &["debug", "turn_tokens"], next))
                },
            ));
        }
        panel.add(&render);
        panel
    }

    /// `Action`: an action-colored line with a hover background; muted while disabled.
    fn action(self: &Rc<Self>, tui: &Tui, label: &str, disabled: bool, run: impl Fn(&Rc<Bar>, &Tui) + 'static) -> View {
        let theme = tui.page();
        let view = View::new(&tui.app);
        view.add(&Text::new(&tui.app, label).fg(if disabled {
            theme.text.muted
        } else {
            theme.text.action.primary.base
        }));
        if !disabled {
            let (high, target) = (theme.background.raised.high, view.clone());
            view.on_hover(move |cx, on| {
                target.bg(if on { high } else { Color::TRANSPARENT });
                cx.app().request_redraw();
            });
        }
        let weak = Rc::downgrade(self);
        let run = Rc::new(run);
        view.mouse_pointer(opencode_ui::click_pointer(!disabled)).on_mouse(move |cx, event| {
            if !matches!(event.kind, MouseEventKind::Up(_)) {
                return;
            }
            cx.stop_propagation();
            if disabled {
                return;
            }
            let (Some(bar), Some(tui)) = (weak.upgrade(), weak.upgrade().and_then(|bar| bar.tui.upgrade())) else {
                return;
            };
            let run = run.clone();
            defer(&tui, move |tui| run(&bar, tui));
        });
        view
    }

    /// Writes `opencode-debug-<uuid>.json` in the temporary directory, as `dump()` does.
    fn write_snapshot(self: &Rc<Self>, tui: &Tui) {
        self.dumping.set(true);
        *self.dump.borrow_mut() = None;
        self.render(tui);
        let session = match tui.route() {
            Route::Session { id } => Some(id),
            _ => None,
        };
        let state = self.state.borrow().clone();
        let details = match self.server.borrow().as_ref() {
            Some(Ok(info)) => Some((info.version.clone(), info.pid)),
            _ => None,
        };
        let backend = json!({
            "connected": state.status == Status::Connected,
            "version": details.as_ref().map(|(version, _)| version.clone()),
            "pid": details.as_ref().map(|(_, pid)| *pid),
            "error": state.error,
        });
        let session_json = session.as_ref().map(|id| {
            tui.data.read(|data| {
                let mut value =
                    data.session(id).and_then(|info| serde_json::to_value(info).ok()).unwrap_or_else(|| json!({}));
                if let Some(map) = value.as_object_mut() {
                    map.insert("id".into(), json!(id.0));
                    map.insert("status".into(), json!(format!("{:?}", data.status(id)).to_lowercase()));
                    map.insert(
                        "permissions".into(),
                        serde_json::to_value(data.permissions(id).unwrap_or_default()).unwrap_or_default(),
                    );
                }
                value
            })
        });
        let theme = {
            let state = tui.theme.borrow();
            json!({ "name": state.selected(), "mode": mode_name(state.mode()) })
        };
        let client = tui.data.client().clone();
        let weak = self.weak();
        tui.app.spawn(
            async move {
                let events = match &session {
                    Some(id) => session_events(&client, id).await,
                    None => Vec::new(),
                };
                let output = json!({
                    "backend": backend,
                    "session": session_json,
                    "events": events,
                    "mcp": { "servers": [], "resources": [] },
                    "plugins": { "ready": true, "list": [] },
                    "theme": theme,
                });
                tokio::task::spawn_blocking(move || write_private(&output))
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|result| result)
            },
            bind!(weak, |bar, _, result| {
                let Some(tui) = bar.tui.upgrade() else { return };
                bar.dumping.set(false);
                *bar.dump.borrow_mut() = Some(result);
                bar.render(&tui);
            }),
        );
    }
}

/// Runs `run` after the current event, since bar handlers run inside widgets a render replaces.
fn defer(tui: &Tui, run: impl FnOnce(&Tui) + 'static) {
    tui.app.defer(bind!(tui, |tui, _| run(&tui)));
}

/// The last 100 durable events of the session's log; nothing when the log is unavailable.
async fn session_events(client: &opencode_api::client::Client, id: &opencode_api::generated::SessionID) -> Vec<Value> {
    use futures_util::StreamExt;
    let input = ExperimentalSessionLogInput { session_id: id.clone(), after: None, follow: Some(false) };
    let Ok(response) = client.experimental_session_log(&input, &RequestOptions::default()).await else {
        return Vec::new();
    };
    let events: Vec<Value> = SseResponse::<Value>::new(response.response)
        .events(|| {})
        .filter_map(|item| async move { item.ok() })
        .filter(|event| {
            let synced = event.get("type").and_then(Value::as_str) == Some("log.synced");
            async move { !synced }
        })
        .collect()
        .await;
    let skip = events.len().saturating_sub(100);
    events.into_iter().skip(skip).collect()
}

/// Creates a new 0600 file in the temporary directory (`open(file, "wx", 0o600)`).
fn write_private(output: &Value) -> Result<String, String> {
    use std::io::Write;
    let path = std::env::temp_dir().join(format!("opencode-debug-{}.json", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let text = serde_json::to_string_pretty(output).map_err(|error| error.to_string())? + "\n";
    options.open(&path).and_then(|mut file| file.write_all(text.as_bytes())).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// `PanelBox` with its `PanelTitle`: above the item, 42 cells wide, on the raised background.
fn panel_box(app: &App, theme: &Theme, title: &str) -> View {
    View::new(app)
        .absolute()
        .z_index(2600)
        .position(Edge::Bottom, 1)
        .position(Edge::Left, -1)
        .width(PANEL_WIDTH)
        .padding_x(2)
        .padding_y(1)
        .bg(theme.background.raised.base)
        .column()
        .on_mouse(|cx, event| {
            if matches!(event.kind, MouseEventKind::Up(_)) && cx.app().selected_text().is_none() {
                cx.stop_propagation();
            }
        })
        .child(&Text::new(app, title).fg(theme.text.base).bold().margin_edge(Edge::Bottom, 1))
}

/// `Row`: the label on the left, the value on the right.
fn row(app: &App, theme: &Theme, label: &str, value: &str) -> View {
    View::new(app)
        .row()
        .child(&Text::new(app, label).fg(theme.text.muted))
        .child(&View::new(app).grow(1.0).basis(Length::Auto))
        .child(&Text::new(app, value).fg(theme.text.base))
}

/// `ProcessStat`: the label, a braille graph, and the latest value.
fn process_stat(app: &App, theme: &Theme, label: &str, values: &[f64], unit: &str, decimals: usize) -> View {
    let color = if values.is_empty() { theme.text.muted } else { theme.text.base };
    let value = values.last().map_or_else(|| "--".to_owned(), |value| format!("{value:.decimals$}{unit}"));
    View::new(app)
        .row()
        .child(&View::new(app).width(7).child(&Text::new(app, label).fg(theme.text.muted)))
        .child(
            &View::new(app)
                .grow(1.0)
                .basis(Length::Auto)
                .child(&Text::new(app, braille_graph(values, GRAPH_WIDTH)).fg(color)),
        )
        .child(&View::new(app).width(8).align_items(Align::End).child(&Text::new(app, value).fg(color)))
}

fn mode_name(mode: ThemeMode) -> &'static str {
    match mode {
        ThemeMode::Dark => "dark",
        ThemeMode::Light => "light",
    }
}

/// `new URL(url).host`: the host and any port other than the scheme's default.
fn url_host(url: &str) -> String {
    let (scheme, rest) = url.split_once("://").unwrap_or(("", url));
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit_once('@').map_or(host, |(_, host)| host);
    let default = match scheme {
        "http" | "ws" => Some(":80"),
        "https" | "wss" => Some(":443"),
        _ => None,
    };
    default.and_then(|port| host.strip_suffix(port)).unwrap_or(host).to_lowercase()
}

/// CPU time of this process in seconds, from `/proc/self/schedstat` on Linux; 0 elsewhere.
fn cpu_time() -> f64 {
    std::fs::read_to_string("/proc/self/schedstat")
        .ok()
        .and_then(|text| text.split_whitespace().next()?.parse::<f64>().ok())
        .map_or(0.0, |nanoseconds| nanoseconds / 1e9)
}

/// Resident memory in bytes, from `VmRSS` in `/proc/self/status` on Linux; 0 elsewhere.
fn memory() -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|text| {
            let line = text.lines().find(|line| line.starts_with("VmRSS:"))?;
            line.split_whitespace().nth(1)?.parse::<f64>().ok()
        })
        .map_or(0.0, |kilobytes| kilobytes * 1024.0)
}

/// Milliseconds since the process started (`performance.now()` at the first draw), from `/proc` on Linux.
fn process_age_ms() -> f64 {
    // `starttime` is in clock ticks; Linux fixes the user-visible tick rate (`USER_HZ`) at 100.
    const TICKS: f64 = 100.0;
    let age = || -> Option<f64> {
        let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
        // `starttime` is field 22, the 20th after the parenthesized command.
        let start: f64 = stat.rsplit_once(')')?.1.split_whitespace().nth(19)?.parse().ok()?;
        let uptime: f64 = std::fs::read_to_string("/proc/uptime").ok()?.split_whitespace().next()?.parse().ok()?;
        Some((uptime - start / TICKS) * 1000.0)
    };
    age().unwrap_or(0.0).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn braille_graph_matches_typescript() {
        // Expected strings from `brailleGraph` in `devtools-bar.tsx`.
        assert_eq!(braille_graph(&[], 4), "⠀⠀⠀⠀");
        assert_eq!(braille_graph(&[5.0], 3), "⣀⣀⣀");
        assert_eq!(braille_graph(&[0.0, 1.0, 2.0, 3.0], 2), "⣠⣾");
        assert_eq!(braille_graph(&[3.0, 0.0], 2), "⣿⣇");
    }

    #[test]
    fn status_helpers_match_typescript() {
        let at = Instant::now();
        let sample =
            |delay: f64, seconds: u64| Sample { cpu: 0.0, memory: 0.0, delay, time: at + Duration::from_secs(seconds) };
        assert_eq!(runtime_status(&[]), RuntimeStatus::Normal);
        assert_eq!(runtime_status(&[sample(20.0, 0)]), RuntimeStatus::Medium);
        assert_eq!(runtime_status(&[sample(150.0, 0), sample(1.0, 6)]), RuntimeStatus::Normal);
        assert_eq!(runtime_status(&[sample(150.0, 1), sample(1.0, 6)]), RuntimeStatus::High);
        assert_eq!(status_icon(RuntimeStatus::Medium), "⦿");
        assert_eq!(connection_indicator(Status::Connected, 0).1, "✓");
        assert_eq!(connection_indicator(Status::Reconnecting, 2).1, "↻");
        assert_eq!(connection_indicator(Status::Reconnecting, 3).1, "×");
        assert_eq!(connection_indicator(Status::Connecting, 9).1, "↻");
    }

    #[test]
    fn url_host_matches_the_url_api() {
        assert_eq!(url_host("http://127.0.0.1:4096/"), "127.0.0.1:4096");
        assert_eq!(url_host("http://localhost:80/x"), "localhost");
        assert_eq!(url_host("https://Example.com:443"), "example.com");
    }
}
