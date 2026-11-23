//! Mini's performance scenario, run with the TUI's by `bun run perf` in `packages/cli-rs`: the long session replayed
//! into mini's scrollback. It shares the counting allocator and the measured region with the TUI's scenarios
//! (`crates/tui/tests/all/perf.rs`).

#[allow(dead_code, reason = "the TUI's tests use the rest")]
#[path = "../../tui/tests/all/support/heap.rs"]
mod heap;
#[path = "../../tui/tests/all/support/probe.rs"]
mod probe;

use opencode_api::generated::SessionMessageInfo;
use opentui::prelude::*;
use opentui::remote::{RemoteOptions, RemoteTerminal};
use opentui::split::{Scrollback, SplitFooter};
use serde::Deserialize;

use crate::replay::Transcript;
use crate::scrollback::Writer;
use crate::theme::{self, ThemeInput};
use probe::{LONG, PARTS, Probe, TURNS, long_messages};

#[global_allocator]
static HEAP: heap::Counting = heap::Counting;

/// Hydrates the long session into mini's transcript and writes every commit to a split footer's scrollback.
#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn mini_replay() {
    let messages: Vec<SessionMessageInfo> =
        long_messages(TURNS, PARTS).iter().map(|value| SessionMessageInfo::deserialize(value).unwrap()).collect();
    let (terminal, _link) =
        RemoteTerminal::new(RemoteOptions { width: 120, height: 40, ..RemoteOptions::default() }, || {})
            .expect("a remote terminal");
    let mut options = AppOptions { palette_size: 0, light_theme: None, ..AppOptions::default() };
    options.host.split_footer = Some(6);
    let app = App::remote(terminal, options).expect("a remote app");
    let footer = SplitFooter::of(app.session()).expect("a split footer");
    let theme = theme::resolve(&ThemeInput {
        name: None,
        mode: Some(opentui::theme::ThemeMode::Dark),
        palette: None,
        directories: Vec::new(),
        mono: false,
    });
    let mut writer = Writer::new(footer, Scrollback::new(&app).unwrap(), theme, false, true);
    let probe = Probe::start();
    let mut transcript = Transcript::new(LONG, true, true, true, None);
    let output = transcript.hydrate(&messages, false);
    let commits = output.commits.len() as u64;
    for commit in output.commits {
        writer.append(commit).unwrap();
    }
    writer.complete(true).unwrap();
    probe.finish("mini_replay", commits);
    assert!(commits > 1000, "{commits} commits");
}
