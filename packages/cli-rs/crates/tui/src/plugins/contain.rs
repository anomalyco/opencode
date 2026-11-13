//! The client's side of containment (synthesis 4.5, phase P4c). Under a parent, the client keeps a run record of its
//! plugin calls, its session and its draft, with the watchdog over it. After a crash, the client the parent starts
//! again keeps the plugin the record named disabled (`--skip-plugin`, and `plugin-crashes.json` in the state
//! directory after that), restores the draft and shows one notice. The parent's half is the CLI's `contain`.

use std::path::PathBuf;

use opencode_plugin::Crashed;
use opencode_plugin::contain::Left;

use crate::prelude::*;

/// What the parent tells a client it starts.
#[derive(Clone, Debug, Default)]
pub struct Contain {
    /// Keep the run record here, with the watchdog over it: the client runs under a parent.
    pub record: Option<PathBuf>,
    /// `--skip-plugin`: the plugins a crash named, or `*` for every external plugin.
    pub skip: Vec<String>,
    /// What the client before this one left in its record.
    pub resume: Option<Left>,
}

/// The file in the state directory that keeps the plugins that crashed the client.
const FILE: &str = "plugin-crashes.json";

/// Applies `contain` before the plugins activate and before the first route mounts.
pub fn install(tui: &Rc<Tui>) {
    let contain = tui.startup.args.contain.clone();
    if let Some(path) = &contain.record {
        let monitor = tui.plugins.monitor();
        match monitor.attach_record(path) {
            Ok(_) => monitor.watch(opencode_plugin::contain::watchdog::terminal()),
            Err(error) => log::error!("plugin run record {}: {error}", path.display()),
        }
    }
    let file = tui.state_dir().map(|dir| dir.join(FILE));
    let mut crashed: Vec<Crashed> = file
        .as_ref()
        .and_then(|file| std::fs::read(file).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let builtins: Vec<String> = tui
        .plugins
        .entries()
        .into_iter()
        .filter(|entry| entry.source == opencode_plugin::Source::Builtin)
        .map(|entry| entry.id)
        .collect();
    let left = contain.resume.clone().unwrap_or_default();
    // A built-in that crashed is a host bug: it is not disabled.
    for id in contain.skip.iter().filter(|id| *id != "*" && !builtins.contains(id)) {
        if !crashed.iter().any(|known| known.id == *id) {
            let reason = match (&left.plugin, &left.call) {
                (Some(plugin), Some(call)) if plugin == id => reason(call, left.hang),
                _ => "crashed the client and is disabled".to_owned(),
            };
            crashed.push(Crashed { id: id.clone(), reason, digest: None });
        }
    }
    if let Some(file) = file.as_ref().filter(|_| !contain.skip.is_empty()) {
        save(file, &crashed);
    }
    tui.plugins.set_crashed(crashed, move |crashed| {
        if let Some(file) = &file {
            save(file, crashed);
        }
    });
    let safe = contain.skip.iter().any(|id| id == "*");
    if safe {
        tui.plugins.set_safe();
    }
    let Some(left) = contain.resume else { return };
    if let Some(draft) = left.draft.clone() {
        let mut prompt = opencode_local::jsonl::empty_prompt();
        prompt["text"] = Value::String(draft);
        let session = left.session.clone().map(SessionID);
        tui.prompt.drafts.save(session.as_ref(), crate::prompt::draft::Draft { prompt, cursor: u32::MAX });
    }
    tui.app.defer(bind!(tui, |tui, _| notice(&tui, &left, safe, &builtins)));
}

/// The manager's reason for a plugin that crashed or hung the client in `call`.
fn reason(call: &str, hang: bool) -> String {
    match hang {
        true => format!("hung the client in `{call}` and is disabled"),
        false => format!("crashed the client in `{call}` and is disabled"),
    }
}

/// The one notice of a restart.
fn notice(tui: &Rc<Tui>, left: &Left, safe: bool, builtins: &[String]) {
    let options = match (&left.plugin, &left.call) {
        (Some(id), Some(call)) if builtins.contains(id) => ToastOptions::new(
            Variant::Error,
            format!("It {} `{call}`: a bug in opencode-native.", if left.hang { "hung in" } else { "crashed in" }),
        )
        .title(format!("Built-in plugin failed: {id}")),
        (Some(id), Some(call)) => {
            let id = id.clone();
            ToastOptions::new(Variant::Error, format!("It {}.", reason(call, left.hang)))
                .title(format!("Plugin failed: {id}"))
                .action("Enable again", bind!(tui, |tui| enable(&tui, &id)))
        }
        _ if safe => ToastOptions::new(
            Variant::Warning,
            "Every external plugin is off. Run /plugins to enable them one at a time.",
        )
        .title("opencode-native crashed twice"),
        _ => ToastOptions::new(Variant::Warning, "The crash named no plugin.").title("opencode-native restarted"),
    };
    tui.toasts.show(options);
}

/// Enables plugin `id` again, as the plugin manager does.
pub(crate) fn enable(tui: &Rc<Tui>, id: &str) {
    match tui.plugins.toggle(&super::host::host(tui), id, true) {
        Some(Err(error)) => tui.toasts.error(error),
        Some(Ok(())) => tui.navigate(tui.route()),
        None => {}
    }
}

fn save(file: &std::path::Path, crashed: &[Crashed]) {
    let temp = file.with_extension("json.tmp");
    let written = serde_json::to_vec_pretty(crashed)
        .map_err(std::io::Error::other)
        .and_then(|bytes| std::fs::write(&temp, bytes))
        .and_then(|()| std::fs::rename(&temp, file));
    if let Err(error) = written {
        log::warn!("{}: {error}", file.display());
    }
}

/// The record follows the route: the session a restart opens, and no draft until the new route's prompt writes one.
pub fn navigated(tui: &Tui, route: &Route) {
    if let Some(record) = tui.plugins.monitor().record() {
        record.set_session(match route {
            Route::Session { id } => Some(id.0.as_str()),
            _ => None,
        });
        record.set_draft("");
    }
}

/// The composer's text changed.
pub fn drafted(tui: &Tui, text: &str) {
    if let Some(record) = tui.plugins.monitor().record() {
        record.set_draft(text);
    }
}
