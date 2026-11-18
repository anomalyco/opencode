//! Built-in manager for local and server plugins.

use opencode_api::client::Client;
use opencode_api::generated::{
    LocationQueryInput, PluginCheckInput, PluginInfo, PluginListInput, PluginSource, PluginSourcePackage, PluginState,
    PluginUpdateInput,
};
use opencode_api::js::locale_compare;
use opencode_plugin::abi::{
    self, Action, Command, Dialog, ErrorDetails, Gutter, Host, PanelSize, PluginEntry, PluginOrigin, PluginStatus,
    Read, RequestId, Select, SelectAction, SelectOption, Span, Toast, Variant,
};

use super::fetch::{data, fetch_of};

use crate::prelude::*;

pub const ID: &str = "opencode.plugins";
const LIST: &str = "plugins";
const ERROR: &str = "plugins.error";

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: ID, setup }
}

#[derive(Default)]
struct State {
    opened: Cell<u64>,
    erring: Cell<bool>,
    /// Accept only the newest server list or check response.
    asked: Cell<u64>,
    directory: RefCell<String>,
    server: RefCell<Option<Vec<PluginInfo>>>,
    checking: Cell<bool>,
    internal: Cell<bool>,
    /// Keys of the server plugins with an update in flight.
    updating: RefCell<Vec<String>>,
    requests: RefCell<HashMap<RequestId, Asked>>,
}

/// A server call in flight, with the open it belongs to and, for a read or a check, its place among them.
enum Asked {
    List(u64, u64),
    Check(u64, u64),
    Update(u64, String),
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let state = Rc::new(State::default());
    let command = Command::new("plugins.list").title("Plugins").group("System").slash("plugins").palette();
    let opened = state.clone();
    setup.command(command, move |host, _| {
        let state = &opened;
        state.opened.set(state.opened.get() + 1);
        *state.directory.borrow_mut() = host.info().location.directory;
        state.server.replace(None);
        state.checking.set(false);
        state.internal.set(false);
        state.updating.borrow_mut().clear();
        host.dialog(Dialog::Select(list(host, state, None)));
        state.fetch(host, Asked::List(state.opened.get(), state.next()));
    });
    // Ignore manager actions when the list is closed.
    let internal = state.clone();
    setup.command(hidden("opencode.plugins.internal"), move |host, _| {
        internal.internal.set(!internal.internal.get());
        internal.show(host);
    });
    let check = state.clone();
    setup.command(hidden("opencode.plugins.check"), move |host, _| {
        if host.dialog_open(LIST) && !check.checking.replace(true) {
            check.show(host);
            check.fetch(host, Asked::Check(check.opened.get(), check.next()));
        }
    });
    let update = state.clone();
    setup.command(hidden("opencode.plugins.update"), move |host, key| {
        let key = key.filter(|_| host.dialog_open(LIST));
        let row = key.and_then(|key| update.rows(host).into_iter().find(|row| row.key() == key));
        if let Some(row) = row.filter(|row| update.updatable(row)) {
            update.updating.borrow_mut().push(row.key());
            update.show(host);
            update.fetch(host, Asked::Update(update.opened.get(), row.key()));
        }
    });
    let detail = state.clone();
    setup.command(hidden("opencode.plugins.error"), move |host, key| {
        let key = key.filter(|_| host.dialog_open(LIST));
        let row = key.and_then(|key| detail.rows(host).into_iter().find(|row| row.key() == key));
        if let Some(row) = row.filter(Row::has_details) {
            detail.erring.set(true);
            host.dialog(Dialog::ErrorDetails(details(&row)));
        }
    });
    let back = state.clone();
    setup.command(hidden("opencode.plugins.back"), move |host, key| {
        if back.erring.replace(false) {
            host.dialog(Dialog::Select(list(host, &back, key.map(str::to_owned))));
        }
    });
    // Refresh server entries after approval because list subscriptions stop while the question is open.
    let asked = state.clone();
    setup.command(hidden("opencode.plugins.asked"), move |host, key| {
        if asked.opened.get() > 0 && !host.dialog_open(LIST) {
            host.dialog(Dialog::Select(list(host, &asked, key.map(str::to_owned))));
            asked.fetch(host, Asked::List(asked.opened.get(), asked.next()));
        }
    });
    let updated = state.clone();
    setup.on_event(&["plugin.updated"], move |host, _| {
        if host.dialog_open(LIST) || host.dialog_open(ERROR) {
            updated.fetch(host, Asked::List(updated.opened.get(), updated.next()));
        }
    });
    // The TUI rows follow the registry while the list shows; nothing opens it again.
    let heard = state.clone();
    setup.on_plugins(move |host| heard.show(host));
    setup.on_reply(move |host, id, reply| {
        let Some(asked) = state.requests.borrow_mut().remove(&id) else { return };
        state.answered(host, asked, reply);
    });
    Ok(())
}

fn hidden(name: &str) -> Command {
    Command::new(name)
}

fn command(name: &str, input: Option<String>) -> Action {
    Action::Command { name: name.to_owned(), input }
}

impl State {
    fn next(&self) -> u64 {
        self.asked.set(self.asked.get() + 1);
        self.asked.get()
    }

    /// Shows the list again while it is open: in place, with its filter and selection.
    fn show(&self, host: &dyn Host) {
        if host.dialog_open(LIST) {
            host.dialog(Dialog::Select(list(host, self, None)));
        }
    }

    fn fetch(&self, host: &dyn Host, asked: Asked) {
        let location = Some(LocationQueryInput { directory: Some(self.directory.borrow().clone()) });
        let call = match &asked {
            Asked::List(..) => Client::plugin_list_call(&PluginListInput { location }),
            Asked::Check(..) => {
                Client::plugin_check_call(&PluginCheckInput { location, ..PluginCheckInput::default() })
            }
            Asked::Update(_, key) => {
                let rows = self.rows(host);
                let Some(package) = rows.iter().find(|row| row.key() == *key).and_then(Row::package) else { return };
                Client::plugin_update_call(&PluginUpdateInput { location, targets: vec![package.target.clone()] })
            }
        };
        let call = call.expect("the plugin inputs encode");
        match host.try_fetch(fetch_of(call)) {
            Ok(id) => drop(self.requests.borrow_mut().insert(id, asked)),
            Err(error) => self.answered(host, asked, Err(error)),
        }
    }

    fn answered(&self, host: &dyn Host, asked: Asked, reply: Result<Value, String>) {
        let current = |open: u64| open == self.opened.get();
        let newest = |open: u64, asked: u64| current(open) && asked == self.asked.get();
        match asked {
            Asked::List(open, asked) => {
                if let (true, Ok(plugins)) = (newest(open, asked), data::<Vec<PluginInfo>>(reply)) {
                    self.server.replace(Some(plugins));
                }
            }
            Asked::Check(open, asked) => {
                let plugins = data::<Vec<PluginInfo>>(reply);
                if current(open) {
                    self.checking.set(false);
                }
                match plugins {
                    Ok(plugins) if newest(open, asked) => drop(self.server.replace(Some(plugins))),
                    Ok(_) => {}
                    Err(error) => host.toast(Toast::new(Variant::Error, error)),
                }
            }
            Asked::Update(open, key) => {
                if current(open) {
                    self.updating.borrow_mut().retain(|updating| *updating != key);
                }
                match reply {
                    Ok(_) if current(open) => self.fetch(host, Asked::List(open, self.next())),
                    Ok(_) => {}
                    Err(error) => host.toast(Toast::new(Variant::Error, error)),
                }
            }
        }
        self.show(host);
    }

    fn rows(&self, read: &dyn Read) -> Vec<Row> {
        // A held build sharing the manager's ID is a separate row.
        let running = |entry: &PluginEntry| entry.id == ID && entry.active;
        let mut local: Vec<Row> = read.plugins().into_iter().filter(|entry| !running(entry)).map(Row::Tui).collect();
        // A package without a server part runs nothing there; its TUI part has its own row.
        let directory = self.directory.borrow();
        let mut server: Vec<Row> = self
            .server
            .borrow()
            .iter()
            .flatten()
            .filter(|plugin| plugin.features.server == Some(true) || matches!(plugin.state, PluginState::Failed(_)))
            .map(|plugin| Row::Server { source: source(plugin, &directory), plugin: plugin.clone() })
            .collect();
        local.sort_by(|a, b| locale_compare(&a.label(), &b.label()));
        server.sort_by(|a, b| locale_compare(&a.label(), &b.label()));
        local.extend(server);
        local
    }

    fn updating(&self, row: &Row) -> bool {
        self.updating.borrow().contains(&row.key())
            || row.package().is_some_and(|package| package.updating == Some(true))
    }

    fn updatable(&self, row: &Row) -> bool {
        row.outdated() && !self.updating(row)
    }
}

fn list(read: &dyn Read, state: &State, focus: Option<String>) -> Select {
    let rows = state.rows(read);
    let visible: Vec<&Row> =
        rows.iter().filter(|row| state.internal.get() || !row.internal() || row.status() == "failed").collect();
    let except = |applies: &dyn Fn(&Row) -> bool| -> Vec<String> {
        visible.iter().filter(|row| !applies(row)).map(|row| row.key()).collect()
    };
    let checking = state.checking.get();
    let error = command("opencode.plugins.error", None);
    // Keep the host's toggle distinct from plugin-supplied update and error actions.
    let mut actions = vec![SelectAction {
        title: if checking { "checking for updates" } else { "check for updates" }.to_owned(),
        key: Some("ctrl+r".to_owned()),
        action: command("opencode.plugins.check", None),
        hidden: Vec::new(),
        primary: None,
        rowless: true,
        command: Some("dialog.plugins.check".to_owned()),
        disabled: checking,
        // Keep the select mounted while waiting for the server's package list.
        hidden_all: !rows.iter().any(|row| row.package().is_some()),
    }];
    actions.extend([
        SelectAction {
            title: "view error".to_owned(),
            key: Some("space".to_owned()),
            action: error.clone(),
            hidden: except(&|row| row.toggle().is_some() && row.has_details()),
            primary: None,
            rowless: false,
            command: Some("dialog.plugins.error".to_owned()),
            disabled: false,
            hidden_all: false,
        },
        SelectAction {
            title: "update".to_owned(),
            key: Some("ctrl+u".to_owned()),
            action: command("opencode.plugins.update", None),
            hidden: except(&|row| state.updatable(row)),
            primary: None,
            rowless: false,
            command: Some("dialog.plugins.update".to_owned()),
            disabled: false,
            hidden_all: false,
        },
        SelectAction {
            title: "view error".to_owned(),
            key: Some("enter".to_owned()),
            action: error.clone(),
            hidden: except(&|row| row.toggle().is_none() && row.has_details()),
            primary: None,
            rowless: false,
            command: None,
            disabled: false,
            hidden_all: false,
        },
        SelectAction {
            title: format!("{} internal", if state.internal.get() { "hide" } else { "show" }),
            key: Some("ctrl+a".to_owned()),
            action: command("opencode.plugins.internal", None),
            hidden: Vec::new(),
            primary: Some(false),
            rowless: true,
            command: None,
            disabled: false,
            hidden_all: false,
        },
    ]);
    Select::new("Plugins", visible.iter().map(|row| option(row, state)).collect(), error)
        .key(LIST)
        .size(PanelSize::Large)
        .maybe(focus, Select::focus)
        .actions(actions)
}

fn option(row: &Row, state: &State) -> SelectOption {
    let updating = state.updating(row);
    let failed = row.status() == "failed";
    let color = if failed {
        "text.feedback.error.base"
    } else if row.status() == "pending" {
        "text.feedback.warning.base"
    } else if row.outdated() {
        "text.feedback.info.base"
    } else {
        "text.muted"
    };
    SelectOption::new(row.label(), row.key())
        .category(if matches!(row, Row::Tui(_)) { "TUI" } else { "Server" })
        .search_text(row.source())
        .maybe(if updating { Some("updating".to_owned()) } else { row.footer() }, SelectOption::footer)
        .footer_color(color)
        .maybe(
            match (updating, failed) {
                (true, _) => Some(Gutter::Spinner),
                (false, true) => Some(Gutter::Span(Span::new("x").fg("text.feedback.error.base"))),
                (false, false) => None,
            },
            SelectOption::gutter,
        )
        .maybe(row.toggle(), SelectOption::toggle)
        // The host asks about a held build; once its question closes, the list comes back on the row as it is then.
        .maybe(row.held().then(|| command("opencode.plugins.asked", None)), SelectOption::action)
}

fn details(row: &Row) -> ErrorDetails {
    let runtime = if matches!(row, Row::Tui(_)) { "tui" } else { "server" };
    let source = row.source();
    let (title, status, error) = match row.slow().filter(|_| !row.has_error()) {
        Some(report) => ("TUI plugin is slow".to_owned(), "slow", report.to_owned()),
        None => (
            format!("{} plugin error", if runtime == "tui" { "TUI" } else { "Server" }),
            "failed",
            row.server_error().unwrap_or_else(|| "Unknown plugin error".to_owned()),
        ),
    };
    ErrorDetails {
        title,
        error,
        context: Some(format!("Plugin: {}\nStatus: {status}\nRuntime: {runtime}\nSource: {source}", row.label())),
        source: Some(source),
        back: Some(command("opencode.plugins.back", Some(row.key()))),
        reference: match row {
            Row::Server { plugin: PluginInfo { state: PluginState::Failed(failed), .. }, .. } => failed.r#ref.clone(),
            _ => None,
        },
        key: Some(ERROR.to_owned()),
        plugin: match row {
            Row::Tui(entry) => Some(entry.key.clone()),
            Row::Server { .. } => None,
        },
    }
}

enum Row {
    Tui(PluginEntry),
    Server { source: String, plugin: PluginInfo },
}

impl Row {
    fn key(&self) -> String {
        match self {
            Row::Tui(entry) => format!("tui:{}", entry.key),
            Row::Server { plugin, source } => format!("server:{}", plugin.id.as_ref().map_or(source, |id| &id.0)),
        }
    }

    fn internal(&self) -> bool {
        match self {
            Row::Tui(entry) => entry.origin == PluginOrigin::Builtin,
            Row::Server { plugin, .. } => matches!(plugin.source, PluginSource::Builtin(_)),
        }
    }

    /// Whether the user still needs to approve this build or has declined it.
    fn held(&self) -> bool {
        matches!(self, Row::Tui(entry) if matches!(entry.status, PluginStatus::Pending | PluginStatus::Declined))
    }

    fn toggle(&self) -> Option<String> {
        match self {
            Row::Tui(entry) if entry.origin != PluginOrigin::Configured || self.held() => Some(entry.key.clone()),
            _ => None,
        }
    }

    fn label(&self) -> String {
        match self {
            // Nothing of a held plugin is opened, so it has no ID: its directory names it.
            Row::Tui(entry) if self.held() => entry
                .target
                .as_deref()
                .and_then(|target| std::path::Path::new(target).file_name())
                .map_or_else(|| entry.id.clone(), |name| name.to_string_lossy().into_owned()),
            Row::Tui(entry) => entry.id.clone(),
            Row::Server { plugin, source } => plugin.id.as_ref().map_or_else(|| source.clone(), |id| id.0.clone()),
        }
    }

    fn source(&self) -> String {
        match self {
            Row::Tui(entry) => entry.target.clone().unwrap_or_else(|| entry.id.clone()),
            Row::Server { source, .. } => source.clone(),
        }
    }

    fn status(&self) -> &str {
        match self {
            Row::Server { plugin, .. } => plugin.state.tag(),
            Row::Tui(entry) => match entry.status {
                PluginStatus::Active => "active",
                PluginStatus::Inactive => "inactive",
                PluginStatus::Skipped => "skipped",
                PluginStatus::Failed => "failed",
                PluginStatus::Pending => "pending",
                PluginStatus::Declined => "declined",
            },
        }
    }

    fn local(&self) -> bool {
        match self {
            Row::Server { plugin, .. } => matches!(plugin.source, PluginSource::Local(_)),
            // On Windows a drive-less rooted path is absolute for the plugin manager.
            Row::Tui(entry) => entry.target.as_deref().is_some_and(|target| {
                target.starts_with("file://")
                    || target.starts_with("./")
                    || target.starts_with("../")
                    || std::path::Path::new(target).has_root()
            }),
        }
    }

    fn package(&self) -> Option<&PluginSourcePackage> {
        match self {
            Row::Server { plugin: PluginInfo { source: PluginSource::Package(package), .. }, .. } => Some(package),
            _ => None,
        }
    }

    fn outdated(&self) -> bool {
        self.package().is_some_and(|package| package.outdated == Some(true))
    }

    fn has_error(&self) -> bool {
        match self {
            Row::Server { .. } => self.server_error().is_some(),
            Row::Tui(entry) => matches!(entry.status, PluginStatus::Failed | PluginStatus::Skipped),
        }
    }

    fn server_error(&self) -> Option<String> {
        match self {
            Row::Server { plugin: PluginInfo { state: PluginState::Failed(failed), .. }, .. } => {
                Some(failed.error.clone())
            }
            _ => None,
        }
    }

    fn footer(&self) -> Option<String> {
        let mut details = Vec::new();
        if self.status() != "active" {
            details.push(self.status().to_owned());
        }
        if self.local() {
            details.push("local".to_owned());
        }
        if let Some(version) = self.package().and_then(|package| package.version.as_deref()) {
            details.push(display_version(version));
        }
        if self.outdated() {
            details.push("update available".to_owned());
        }
        if let Some(report) = self.slow() {
            details.push(slow_summary(report));
        }
        (!details.is_empty()).then(|| details.join(", "))
    }

    fn slow(&self) -> Option<&str> {
        match self {
            Row::Tui(PluginEntry { slow: Some(slow), .. }) => Some(slow),
            _ => None,
        }
    }

    fn has_details(&self) -> bool {
        self.has_error() || self.slow().is_some()
    }
}

/// Summarize the worst call or backlog in the footer; show the full report in details.
fn slow_summary(report: &str) -> String {
    let Some(kinds) = report.strip_prefix("slow (p50/p99/worst): ") else { return "slow: backlog".to_owned() };
    let worst = |kind: &str| -> Option<(String, f64)> {
        let [name, times, "ms"] = kind.split_whitespace().collect::<Vec<_>>()[..] else { return None };
        Some((name.to_owned(), times.rsplit('/').next()?.parse().ok()?))
    };
    let costliest = kinds.split(';').next().unwrap_or_default().split(", ").filter_map(worst);
    match costliest.max_by(|a, b| a.1.total_cmp(&b.1)) {
        Some((kind, ms)) => format!("slow: {kind} {ms:.1} ms"),
        None => "slow".to_owned(),
    }
}

fn source(plugin: &PluginInfo, directory: &str) -> String {
    match &plugin.source {
        PluginSource::Package(package) => package.target.clone(),
        PluginSource::Local(local) => opencode_ui::path::format(
            &local.path,
            Some(directory),
            &std::env::current_dir().unwrap_or_default(),
            std::env::home_dir().as_deref(),
        ),
        other => other.tag().to_owned(),
    }
}

/// A commit hash shows as its first 7 characters.
fn display_version(version: &str) -> String {
    let hash = matches!(version.len(), 40 | 64) && version.chars().all(|c| c.is_ascii_hexdigit());
    if hash { version[..7].to_owned() } else { version.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slow_row_says_what_costs_and_shows_the_report() {
        let report = "slow (p50/p99/worst): view 0.0/0.0/0.1 ms, run-command 0.0/0.0/0.0 ms, draw 1.9/2.0/2.4 ms, \
                      host 0.0/0.1/0.1 ms; setup 3.0 ms";
        let row = |slow: Option<&str>| {
            Row::Tui(PluginEntry {
                key: "k".to_owned(),
                id: "live.stress".to_owned(),
                target: Some("/plugins/stress".to_owned()),
                origin: PluginOrigin::External,
                status: PluginStatus::Active,
                active: true,
                slow: slow.map(str::to_owned),
            })
        };
        let slow = row(Some(report));
        assert_eq!(slow.footer().as_deref(), Some("local, slow: draw 2.4 ms"));
        assert!(slow.has_details() && !slow.has_error());
        let shown = details(&slow);
        assert_eq!((shown.title.as_str(), shown.error.as_str()), ("TUI plugin is slow", report));
        assert!(shown.context.unwrap().contains("Status: slow"));
        let backlog = row(Some("backlog: full at the end of 13 of the last 16 frames, 9 sends refused"));
        assert_eq!(backlog.footer().as_deref(), Some("local, slow: backlog"));
        assert!(!row(None).has_details());
    }
}
