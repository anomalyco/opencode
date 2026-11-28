# MS1: find-in-session mounts off-window parts with matching third-party plugin fences

TypeScript: Find-in-session mounts every loaded row in the transcript (`ensureAllRows`, `routes/session/index.tsx`)
while Find is open, so every Markdown block and every plugin code-block renderer is live on screen for the duration of
the search.

Rust:
- The transcript keeps its bounded window (`MS1-bounded-transcript-window.md`). For ordinary prose, tables, code
  blocks, and built-in client fences, unmounted rows stay unmounted and are counted through OpenTUI's widget-free
  `MarkdownParser`.
- **Built-in Mermaid and LaTeX stay static:** Mermaid (`opencode.merman`) and LaTeX (`opencode.latex`, `latex` /
  `math`) are drawn by the client and register pure draw predicates (`Setup::code_block_draws` /
  `CodeBlockKind::Drawn`), so Find classifies their completed blocks statically without mounting off-window rows or
  calling any renderer.
- **What mounts:** only off-window parts containing a fence claimed by a third-party plugin (`CodeBlockKind::Dynamic`)
  whose source text matches the active Find query are mounted for real in `Transcript::find_pinned`
  (`crates/tui/src/routes/session/messages/list.rs`). They are kept off the scroll box (preserving scroll geometry),
  adopted into `rows` if the window moves over them, and never capped while the query matches.
- **When it ends:** any pinned part whose plugin-claimed fence stops matching after a query edit unmounts immediately
  and fires `fence-gone`. When the query clears, Find closes, the session switches, or the transcript drops,
  `clear_find_pinned` drops every pinned row and fires `fence-gone`, returning mounted rows and live plugin keys to
  their pre-Find state (`tests/all/find.rs`, `find_unmounts_plugin_fences_on_query_change_and_close_and_keeps_builtins_static`).

**Cost.** Measured by `perf::find_plugin_fences` (`crates/tui/tests/all/perf.rs`, 5-run median): on a 250-turn
session (500 messages) where every assistant reply contains a third-party plugin-claimed fence and a one-letter query
(`"a"`) matches all 250 blocks:
- **Peak memory while active:** `5061 KiB` Rust heap peak; `20.5 MiB` process-wide `malloc_peak` (Rust heap plus
  OpenTUI's native nodes and text buffers, ~84 KiB per mounted part).
- **After closing Find:** `703 KiB` Rust heap kept; `5472 KiB` process-wide `malloc_kept` (glibc arena pages held
  until idle `release.rs` runs); all extra plugin keys released via `fence-gone`.
- **Work:** `70,547` allocations (`8371 KiB`), `201 M` instructions, `20 ms` wall (`19 ms` CPU).

**Reason.** Exact `"N of M"` match counts require the third-party plugin's real render decision (a custom widget
contributes 0 code matches; `Fenced::Code` or `Fenced::Keep` without a plugin-owned previous widget falls back to
code) without throwaway `key: 0` probes and without shifting totals as rows scroll into view. Because TypeScript
mounts every loaded row while Find is open and built-in Mermaid/LaTeX stay static, Rust's temporary mount set is
strictly a subset of TypeScript's and ends as soon as the query no longer matches or Find closes.
