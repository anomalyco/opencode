//! Release highlights (E.18b, rows DLG08 and T03): `opencode.highlights` (`/highlights`, `app.tsx:1033-1043`) and the
//! auto-open once after an update (`app.tsx:728-750`, `util/highlights.ts`).
//!
//! As in TS, only stable release builds embed highlights (`OPENCODE_RELEASE_HIGHLIGHTS` at build time, a JSON array
//! of `{ title, body }`); every other build has none, so the command is not registered. The auto-open runs once,
//! when the event connection first connects, into an idle home screen, and claims the version in the `highlights`
//! storage under its lock, so only one of several TUIs starting together shows it.

use std::rc::Rc;

use opencode_ui::bind;
use serde_json::{Value, json};

use crate::app::Tui;
use crate::dialogs::highlights::{self, Highlight};
use crate::routes::Route;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opentui::keymap::Disposer;

/// The current release's highlights and the version they belong to.
#[derive(Clone, Debug, Default)]
pub struct Release {
    pub version: String,
    pub items: Vec<Highlight>,
}

/// The highlights this build embeds; an invalid value reads as none, as in TS.
pub fn embedded() -> Vec<Highlight> {
    option_env!("OPENCODE_RELEASE_HIGHLIGHTS").and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default()
}

/// Registers `/highlights` when the build has highlights, and the auto-open. `continue_` is `--continue`.
pub fn install(tui: &Rc<Tui>, continue_: bool) {
    install_with(tui, Release { version: tui.startup.args.version.clone(), items: embedded() }, continue_);
}

/// [`install`] with the release given, for tests.
pub fn install_with(tui: &Rc<Tui>, release: Release, continue_: bool) {
    if !release.items.is_empty() {
        let (weak, shown) = (tui.weak(), release.clone());
        let command = TuiCommand::new(
            "opencode.highlights",
            bind!(weak, |tui, _, _| highlights::show(&tui, &shown.version, &shown.items)),
        )
        .bind(Bind::Off)
        .title("Show release highlights")
        .group("System")
        .palette()
        .slash(Slash { name: "highlights".to_owned(), aliases: Vec::new(), arguments: false });
        // The layer lives as long as the keymap, which the TUI owns.
        if let Err(error) = tui
            .keymap
            .layer(KeymapLayer {
                mode: Some(GLOBAL_MODE.to_owned()),
                commands: vec![command],
                ..KeymapLayer::default()
            })
            .map(Disposer::forget)
        {
            log::error!("highlights keymap layer: {error}");
        }
    }
    let Some(mut watch) = tui.connection_watch() else {
        return;
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move { watch.wait_for(|state| state.status == opencode_api::events::Status::Connected).await.is_ok() },
        move |_, connected| {
            if let (true, Some(tui)) = (connected, weak.upgrade()) {
                startup(&tui, &release, continue_);
            }
        },
    );
}

/// The auto-open, once the TUI is connected: only into an idle home screen with nothing asked for at startup.
pub fn startup(tui: &Tui, release: &Release, continue_: bool) {
    if !tui.settings.info().highlights.unwrap_or(true) {
        return;
    }
    let typed = tui.textarea.borrow().as_ref().is_some_and(|textarea| !textarea.text().is_empty());
    if tui.route() != Route::Home || tui.dialogs.is_open() || typed {
        return;
    }
    let args = &tui.startup.args;
    if args.prompt.is_some() || continue_ || args.session.is_some() || args.new_session_id.is_some() {
        return;
    }
    if ["OPENCODE_DRIVE", "OPENCODE_STORY", "OPENCODE_ROUTE"].iter().any(|name| std::env::var_os(name).is_some()) {
        return;
    }
    let Some(storage) = tui.storage() else { return };
    let input = Input {
        version: release.version.clone(),
        count: release.items.len(),
        history: tui.state_dir().is_some_and(|state| state.join("prompt-history.jsonl").exists()),
    };
    let (weak, release) = (tui.weak(), release.clone());
    tui.app.spawn(
        async move {
            tokio::task::spawn_blocking(move || claim(&storage, &input))
                .await
                .map_err(|error| error.to_string())
                .and_then(|result| result)
        },
        bind!(weak, |tui, _, result| {
            match result {
                Ok(true) if !tui.dialogs.is_open() => highlights::show(&tui, &release.version, &release.items),
                Ok(_) => {}
                Err(error) => tui.toasts.error(error),
            }
        }),
    );
}

/// `HighlightsInput`.
#[derive(Clone, Debug)]
pub struct Input {
    pub version: String,
    /// Highlights embedded in this build.
    pub count: usize,
    /// The user has used the TUI before, so a first run with no state is still an update.
    pub history: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    /// Open the dialog and record the version.
    Show,
    /// Mark the version seen silently.
    Record,
    /// Leave the state untouched.
    None,
}

/// `decide`: only stable versions count.
pub fn decide(input: &Input, seen: Option<&str>) -> Decision {
    let Some(current) = stable(&input.version) else {
        return Decision::None;
    };
    let seen = seen.and_then(stable);
    match seen {
        None if !input.history => return Decision::Record,
        Some(seen) if current <= seen => return Decision::None,
        _ => {}
    }
    if input.count > 0 { Decision::Show } else { Decision::Record }
}

/// `claim`: the decision inside the locked `highlights` update; whether this TUI shows the dialog.
pub fn claim(storage: &opencode_local::storage::Storage, input: &Input) -> Result<bool, String> {
    let initial = json!({});
    let seen = |value: &Value| value.get("seen").and_then(Value::as_str).map(str::to_owned);
    let state = storage.load("highlights", &initial).map_err(|error| error.to_string())?;
    if decide(input, seen(&state).as_deref()) == Decision::None {
        return Ok(false);
    }
    let mut action = Decision::None;
    storage
        .update("highlights", &initial, |draft| {
            action = decide(input, seen(draft).as_deref());
            if action != Decision::None
                && let Some(object) = draft.as_object_mut()
            {
                object.insert("seen".to_owned(), Value::from(input.version.clone()));
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(action == Decision::Show)
}

/// `major.minor.patch` of a stable version, compared part by part.
fn stable(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.split('.');
    let mut out = [0; 3];
    for part in &mut out {
        let text = parts.next()?;
        if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        *part = text.parse().ok()?;
    }
    parts.next().is_none().then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(version: &str, count: usize, history: bool) -> Input {
        Input { version: version.to_owned(), count, history }
    }

    /// The cases of `packages/tui/test/highlights.test.ts`, and an unstable or broken seen version.
    #[test]
    fn decide_matches_typescript() {
        let base = || input("2.0.27", 5, true);
        let with = |change: fn(&mut Input)| {
            let mut input = base();
            change(&mut input);
            input
        };
        let cases: Vec<(Input, Option<&str>, Decision)> = vec![
            (base(), None, Decision::Show),
            (with(|input| input.history = false), None, Decision::Record),
            (with(|input| input.count = 0), None, Decision::Record),
            (base(), Some("2.0.26"), Decision::Show),
            (with(|input| input.history = false), Some("1.99.99"), Decision::Show),
            (with(|input| input.count = 0), Some("2.0.26"), Decision::Record),
            (base(), Some("2.0.27"), Decision::None),
            (base(), Some("2.0.28"), Decision::None),
            (with(|input| input.version = "2.0.30".into()), Some("2.1.0"), Decision::None),
            (with(|input| input.version = "0.0.0-dev-123".into()), None, Decision::None),
            (with(|input| input.version = "local".into()), None, Decision::None),
            (with(|input| input.history = false), Some("2.0.0-next"), Decision::Record),
            (base(), Some("garbage"), Decision::Show),
        ];
        for (input, seen, expected) in cases {
            assert_eq!(decide(&input, seen), expected, "{input:?} {seen:?}");
        }
    }

    /// "only one of several concurrent TUIs claims the highlights".
    #[test]
    fn one_of_several_concurrent_tuis_claims_the_highlights() {
        let state = tempfile::tempdir().unwrap();
        let claims: Vec<bool> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    let storage = opencode_local::storage::Storage::new(state.path(), "latest").unwrap();
                    scope.spawn(move || claim(&storage, &input("2.0.27", 5, true)).unwrap())
                })
                .collect();
            handles.into_iter().map(|handle| handle.join().unwrap()).collect()
        });
        assert_eq!(claims.iter().filter(|claimed| **claimed).count(), 1);
        let file = state.path().join("latest/tui/highlights.json");
        let written: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        assert_eq!(written, json!({ "seen": "2.0.27" }));
        let storage = opencode_local::storage::Storage::new(state.path(), "latest").unwrap();
        assert!(!claim(&storage, &input("2.0.27", 5, true)).unwrap());
    }
}
