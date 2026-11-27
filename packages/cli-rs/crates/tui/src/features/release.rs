//! Gives the system back the memory freed rows leave in the allocator (`opencode_util::memory::release`, glibc only).
//!
//! Rows the transcript drops free their memory into glibc's heap, which keeps the pages while anything above them
//! lives: after a long scroll, most of what the rows held stays resident. A release runs once the drops stop: when at
//! least [`ROWS`] rows dropped since the last one, [`QUIET`] after the last drop, and at most once per [`EVERY`].
//! One takes under 20 ms, on idle, never in a frame that answers a key.

use std::cell::Cell;
use std::time::{Duration, Instant};

use opentui::App;

/// Rows dropped since the last release that make the next one worth it: a few windows' worth of row changes.
const ROWS: usize = 100;
/// How long the drops must stop before a release runs, so that it never lands in a scroll.
const QUIET: Duration = Duration::from_secs(2);
/// The least time between two releases.
const EVERY: Duration = Duration::from_secs(30);

thread_local! {
    /// The UI thread's releases: rows dropped since the last, its time, the pending one's generation, and a count.
    static STATE: Cell<State> = const { Cell::new(State { rows: 0, last: None, pending: 0, runs: 0 }) };
}

#[derive(Clone, Copy)]
struct State {
    rows: usize,
    last: Option<Instant>,
    /// Bumped by each schedule; a timer whose generation is older stands down.
    pending: u64,
    runs: u64,
}

/// Counts `rows` the transcript dropped, and once they add up to [`ROWS`], schedules a release for when the drops stop.
pub fn dropped(app: &App, rows: usize) {
    if rows == 0 {
        return;
    }
    let mut state = STATE.get();
    state.rows += rows;
    if state.rows < ROWS {
        STATE.set(state);
        return;
    }
    let since = state.last.map_or(EVERY, |last| app.now().saturating_duration_since(last));
    state.pending += 1;
    let generation = state.pending;
    STATE.set(state);
    app.set_timeout(QUIET.max(EVERY.saturating_sub(since)), move |cx| {
        let mut state = STATE.get();
        if state.pending != generation {
            return;
        }
        (state.rows, state.last, state.runs) = (0, Some(cx.app().now()), state.runs + 1);
        STATE.set(state);
        opencode_util::memory::release();
    });
}

/// How many releases ran on this thread.
pub fn runs() -> u64 {
    STATE.get().runs
}
