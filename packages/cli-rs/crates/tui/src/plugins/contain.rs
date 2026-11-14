//! The client's side of containment (synthesis 4.5, phase P4c). Under a parent, the client keeps its run record: the
//! parent made it, and handed over in it what the client before this one left. The client:
//!
//! - holds the build a crash named, by target and digest, in `plugin-crashes.json` in the state directory, and every
//!   external plugin when the parent says safe mode, or when no parent guards it at all: their libraries are never
//!   opened ([`opencode_plugin::Registry::admit`]);
//! - restores the session and the draft of the last snapshot, and shows one notice;
//! - publishes, on every path that changes them, the session on screen and the composer's exact text;
//! - on a real terminal, starts the watchdog; when a call it painted the notice for returns, says so on that line.
//!
//! The parent's half is the CLI's `contain`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use opencode_plugin::Crashed;
use opencode_plugin::contain::{Artifact, Crash, Record, Snapshot};

use crate::prelude::*;

/// What the CLI tells the TUI.
#[derive(Clone, Default)]
pub struct Contain {
    /// The run record the parent made: the client runs under a parent.
    pub record: Option<Arc<Record>>,
    /// Start the watchdog: the client is on a real terminal.
    pub watch: bool,
    /// No parent guards this client, though one should: why external plugins do not run.
    pub unsupervised: Option<String>,
}

impl std::fmt::Debug for Contain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Contain")
            .field("record", &self.record.is_some())
            .field("watch", &self.watch)
            .field("unsupervised", &self.unsupervised)
            .finish()
    }
}

/// The file in the state directory that keeps the builds that crashed the client.
pub const FILE: &str = "plugin-crashes.json";

/// Applies containment before the plugins activate and before the first route mounts.
pub fn install(tui: &Rc<Tui>) {
    let contain = tui.startup.args.contain.clone();
    let monitor = tui.plugins.monitor().clone();
    let mut unsupervised = contain.unsupervised.clone();
    if let Some(record) = &contain.record {
        let _ = monitor.attach(record.clone());
        if contain.watch {
            record.set_terminal();
            if let Err(error) = monitor.watch(opencode_plugin::contain::watchdog::terminal()) {
                log::error!("plugin watchdog: {error}");
                unsupervised = Some(format!("the crash guard did not start ({error}); restart opencode-native"));
            }
        }
        let weak = tui.weak();
        monitor.set_on_notice(move |artifact, took| {
            if let Some(tui) = weak.upgrade() {
                responded(&tui, artifact, took);
            }
        });
    }
    if let Some(reason) = unsupervised {
        tui.plugins.set_unsupervised(reason);
    }
    let handoff = contain.record.as_ref().map(|record| record.handoff()).unwrap_or_default();
    let file = tui.state_dir().map(|dir| dir.join(FILE));
    let crash = handoff.crash.clone().unwrap_or_default();
    let quarantined = crash.artifact.as_ref().and_then(|artifact| quarantine(artifact, &crash));
    let crashed = match (&file, &quarantined) {
        (Some(file), Some(entry)) => update(file, |list| {
            list.retain(|known| known.target != entry.target);
            list.push(entry.clone());
        }),
        (Some(file), None) => read(file),
        (None, Some(entry)) => vec![entry.clone()],
        (None, None) => Vec::new(),
    };
    tui.plugins.set_crashed(crashed, move |ended| {
        if let Some(file) = &file {
            update(file, |list| list.retain(|known| known.target != ended.target || known.digest != ended.digest));
        }
    });
    if handoff.safe {
        tui.plugins.set_safe();
    }
    let snapshot = contain.record.as_ref().and_then(|record| record.snapshot());
    if let Some(snapshot) = &snapshot
        && !snapshot.draft.is_empty()
    {
        let mut prompt = opencode_local::jsonl::empty_prompt();
        prompt["text"] = Value::String(snapshot.draft.clone());
        let session = snapshot.session.clone().map(SessionID);
        tui.prompt.drafts.save(session.as_ref(), crate::prompt::draft::Draft { prompt, cursor: u32::MAX });
    }
    if let Some(crash) = handoff.crash {
        let dropped = snapshot.is_some_and(|snapshot| snapshot.dropped);
        tui.app.defer(bind!(tui, |tui, _| notice(&tui, &crash, handoff.safe, dropped)));
    }
}

/// The crash entry of an external build a crash named; `None` for a built-in, which is a host bug.
fn quarantine(artifact: &Artifact, crash: &Crash) -> Option<Crashed> {
    Some(Crashed {
        id: if artifact.id.is_empty() { artifact.target.clone()? } else { artifact.id.clone() },
        target: artifact.target.clone()?,
        digest: artifact.digest.clone()?,
        reason: reason(crash.call.as_deref().unwrap_or("a call"), crash.hang),
    })
}

/// The manager's reason for a build that crashed or hung the client in `call`.
fn reason(call: &str, hang: bool) -> String {
    match hang {
        true => format!("hung the client in `{call}` and is disabled"),
        false => format!("crashed the client in `{call}` and is disabled"),
    }
}

/// The crash list, as the file holds it.
fn read(file: &Path) -> Vec<Crashed> {
    std::fs::read(file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// Changes the crash list under the state directory's lock, read and written in one step, so two clients that change
/// it at once both keep their change. Returns the list after the change.
fn update(file: &Path, change: impl FnOnce(&mut Vec<Crashed>)) -> Vec<Crashed> {
    let dir: PathBuf = file.parent().map(Path::to_path_buf).unwrap_or_default();
    let options = opencode_local::lock::Options::default();
    let updated = opencode_local::lock::with_lock(&dir, "plugin-crashes", &options, || {
        let mut list = read(file);
        change(&mut list);
        let text = serde_json::to_string_pretty(&list).unwrap_or_default();
        opencode_local::storage::write_text_atomic(file, &text).map(|()| list)
    });
    match updated {
        Ok(Ok(list)) => list,
        Ok(Err(error)) => {
            log::warn!("{}: {error}", file.display());
            read(file)
        }
        Err(error) => {
            log::warn!("{}: {error}", file.display());
            read(file)
        }
    }
}

/// The one notice of a restart.
fn notice(tui: &Rc<Tui>, crash: &Crash, safe: bool, dropped: bool) {
    let lost = if dropped { " The draft was too long to keep." } else { "" };
    let call = crash.call.as_deref().unwrap_or("a call");
    let options = match &crash.artifact {
        Some(artifact) if artifact.target.is_none() => ToastOptions::new(
            Variant::Error,
            format!(
                "It {} `{call}`: a bug in opencode-native.{lost}",
                if crash.hang { "hung in" } else { "crashed in" }
            ),
        )
        .title(format!("Built-in plugin failed: {}", artifact.id)),
        Some(artifact) => {
            let id =
                if artifact.id.is_empty() { artifact.target.clone().unwrap_or_default() } else { artifact.id.clone() };
            ToastOptions::new(Variant::Error, format!("It {}.{lost}", reason(call, crash.hang)))
                .title(format!("Plugin failed: {id}"))
                .action("Enable again", bind!(tui, |tui| enable(&tui, &id)))
        }
        None if safe => ToastOptions::new(
            Variant::Warning,
            format!("Every external plugin is off. Run /plugins to enable them one at a time.{lost}"),
        )
        .title("opencode-native crashed twice"),
        None => ToastOptions::new(Variant::Warning, format!("The crash named no plugin.{lost}"))
            .title("opencode-native restarted"),
    };
    tui.toasts.show(options);
}

/// Enables plugin `id` again, as the plugin manager does.
pub(crate) fn enable(tui: &Rc<Tui>, id: &str) {
    match tui.plugins.toggle(&super::host::host(tui), id, true) {
        Some(Err(error)) => tui.toasts.error(error),
        Some(Ok(())) => super::host::host(tui).remount(),
        None => {}
    }
}

/// A call whose hang notice the watchdog painted over row 1 returned: the line says so, over the notice, and goes, so
/// the row shows what the UI drew there.
fn responded(tui: &Rc<Tui>, artifact: &Artifact, took: Duration) {
    let theme = tui.page();
    let text = format!(" plugin {} responded after {:.1} s ", artifact.id, took.as_secs_f32());
    let line = View::new(&tui.app)
        .absolute()
        .z_index(10_000)
        .position(Edge::Top, 0)
        .position(Edge::Left, 0)
        .position(Edge::Right, 0)
        .height(1)
        .bg(theme.background.raised.high)
        .child(&Text::new(&tui.app, text).fg(theme.text.feedback.warning.base));
    tui.app.root().add(&line);
    tui.app.request_redraw();
    tui.app.set_timeout(Duration::from_secs(2), move |cx| {
        line.detach();
        cx.app().request_redraw();
    });
}

/// Publishes the session on screen and the composer's text, when either changed. Every path that changes them calls
/// it: typing, a restore or reset of the prompt (submit, clear, history, stash, the external editor) and navigation.
pub fn sync(tui: &Tui) {
    let Some(record) = tui.plugins.monitor().record() else { return };
    let snapshot = Snapshot {
        session: match tui.route() {
            Route::Session { id } => Some(id.0),
            _ => None,
        },
        draft: tui.textarea.borrow().as_ref().map(|textarea| textarea.text()).unwrap_or_default(),
        dropped: false,
    };
    let mut published = tui.plugins.published.borrow_mut();
    if published.as_ref() != Some(&snapshot) {
        record.publish(&snapshot);
        *published = Some(snapshot);
    }
}
