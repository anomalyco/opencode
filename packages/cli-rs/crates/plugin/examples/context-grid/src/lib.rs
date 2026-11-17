//! A port of `@khaosoigai/oc-context-grid` 0.3.2 (`dist/index.js`): how full the session's context window is, as a
//! grid of squares colored by an estimate of what filled it (system, user, assistant, tools, other), in the sidebar
//! and on a page of its own, `/contextgrid`, which escape leaves for the session it was opened from.
//!
//! Options: `sidebar: false` leaves the sidebar's grid out. TS's slash alias `/ctx` has no port: a command has one
//! slash name (the JS host drops it too).

mod context;

use std::cell::RefCell;
use std::rc::Rc;

use context::{GLYPH_FREE, GLYPH_FULL, Key};
use opencode_plugin_abi::interact::{Bind, Event, Handled, Layer, LayerScope};
use opencode_plugin_abi::types::SessionMessageInfo;
use opencode_plugin_abi::{Command, Host, Layout, Node, Placement, Read, Render, Route, Setup, Span, plugin, v2};

const ROUTE: &str = "contextgrid";
const MODE: &str = "oc-context-grid";

fn setup(setup: &mut Setup) -> Result<(), String> {
    let options: serde_json::Value =
        setup.options().and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default();
    if options.get("sidebar") != Some(&serde_json::Value::Bool(false)) {
        setup.slot(Placement::append("sidebar.content"), |read, input, changed| {
            let Some(session) = input.session_id.as_deref() else { return Render::Hide };
            if !(changed.all || changed.session(session) || changed.list(session) || !changed.locations.is_empty()) {
                return Render::Keep;
            }
            Render::Show(mini(read, session))
        });
    }
    // The session the page was opened from: what it shows, and where escape goes back to.
    let origin: Rc<RefCell<Option<String>>> = Rc::default();
    let opened = origin.clone();
    let open = Command::new("oc-context-grid.open")
        .title("Context Grid")
        .group("Plugin")
        .description("Show context usage as a grid of squares")
        .palette()
        .slash(ROUTE);
    setup.command(open, move |host, _| {
        *opened.borrow_mut() = match host.route() {
            Route::Session { id } => Some(id),
            _ => None,
        };
        host.open_route(ROUTE);
    });
    let shown = origin.clone();
    let page = v2::Surface::new(ROUTE, v2::Place::Route(ROUTE.to_owned()), move |view| {
        full(view.read, shown.borrow().as_deref())
    })
    .mounts()
    // TS pushes its keyboard mode while the page shows.
    .on(|host, event| {
        if let Event::Mount { mounted, .. } = event {
            host.set_mode(mounted.then_some(MODE));
        }
        Handled::Pass
    });
    setup.surface(page);
    let close = Layer::default()
        .scope(LayerScope::Global)
        .mode(MODE)
        .keys([Bind::new("escape", "close").title("Close context grid")]);
    setup.layer(close, move |host, _| {
        back(host, origin.borrow().clone());
        Handled::Consume
    });
    Ok(())
}

/// Leaves the page for the session it was opened from, else home.
fn back(host: &dyn Host, origin: Option<String>) {
    host.navigate(origin.map_or(Route::Home, |id| Route::Session { id }));
}

/// TS `getContextData` for `session`, from what the host has loaded.
fn data(read: &dyn Read, session: &str) -> Option<context::Context> {
    let mut messages: Vec<SessionMessageInfo> = Vec::new();
    read.messages(session, &mut |list| messages = list.to_vec());
    let info = read.session(session).map(|session| session.info);
    context::context(&messages, info.as_ref(), &read.models(None).unwrap_or_default())
}

/// TS `MiniGrid`: the sidebar's grid of 30 squares.
fn mini(read: &dyn Read, session: &str) -> Node {
    let mut rows = vec![Node::text([Span::new("Context grid").bold()]).fg("text.base")];
    match data(read, session) {
        None => rows.push(Node::text([Span::new("no usage yet")]).fg("text.muted")),
        Some(data) => {
            let percent = data.percent.unwrap_or(0.0);
            let summary =
                format!("{}/{} tokens ({percent}%)", context::tokens(data.tokens), context::tokens(data.limit));
            rows.push(Node::text([Span::new(summary)]).fg("text.muted"));
            rows.extend(squares(&data, 30).into_iter().map(Node::text));
        }
    }
    Node::column(rows)
}

/// TS `Grid`: rows of ten squares, each its glyph and a space in its category's color.
fn squares(data: &context::Context, total: usize) -> Vec<Vec<Span>> {
    let grid = if data.limit > 0.0 { context::grid(&data.segments, data.limit, total) } else { Vec::new() };
    grid.chunks(10)
        .map(|row| row.iter().map(|(key, glyph)| Span::new(format!("{glyph} ")).fg(key.color())).collect())
        .collect()
}

/// TS `FullView`: the page, with its grid of 100 squares and the estimate by category.
fn full(read: &dyn Read, session: Option<&str>) -> v2::Node {
    let mut rows = vec![v2::Node::text([Span::new("Context Usage").bold()]).fg("text.base")];
    match session.and_then(|session| data(read, session)) {
        None => {
            let empty =
                if session.is_some() { "No usage yet — send a message first." } else { "No session selected." };
            rows.push(v2::Node::text([Span::new(empty)]).fg("text.muted"));
        }
        Some(data) => {
            let summary = format!(
                "{} · {}/{} tokens ({}%) · {} spent",
                data.model,
                context::tokens(data.tokens),
                context::tokens(data.limit),
                data.percent.unwrap_or(0.0),
                context::cost(data.cost)
            );
            rows.push(v2::Node::text([Span::new(summary)]).fg("text.muted"));
            let grid: Vec<v2::Node> = squares(&data, 100).into_iter().map(v2::Node::text).collect();
            let mut legend = vec![v2::Node::text([Span::new("Estimated usage by category")]).fg("text.muted")];
            legend.extend(data.segments.iter().map(|(key, tokens)| {
                v2::Node::text([
                    Span::new(format!("{GLYPH_FULL} ")).fg(key.color()),
                    Span::new(format!("{}: ", key.label())).fg("text.base"),
                    Span::new(format!(
                        "{} tokens ({}%)",
                        context::tokens(*tokens),
                        context::percent_of(*tokens, data.limit)
                    ))
                    .fg("text.muted"),
                ])
            }));
            let free = if data.limit > 0.0 { (data.limit - data.tokens).max(0.0) } else { 0.0 };
            if free > 0.0 {
                legend.push(v2::Node::text([
                    Span::new(format!("{GLYPH_FREE} ")).fg(Key::Free.color()),
                    Span::new("Free space: ").fg("text.base"),
                    Span::new(format!("{} ({}%)", context::tokens(free), context::percent_of(free, data.limit)))
                        .fg("text.muted"),
                ]));
            }
            rows.push(
                v2::Node::row(vec![
                    v2::Node::column(grid).layout(Layout::default().shrink(false)),
                    v2::Node::column(legend),
                ])
                .gap(2),
            );
        }
    }
    rows.push(v2::Node::text([Span::new("esc close")]).fg("text.muted"));
    v2::Node::column(rows).padding(1, 1).gap(1)
}

plugin!(id = "oc-context-grid", setup);
