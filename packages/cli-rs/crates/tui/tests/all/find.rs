//! Find-in-session integration tests: experiment gating, slash/keybind entry, bounded transcript
//! window reveal, plain fences, prompt draft preservation, case/whitespace stability, and restyling.

use crate::support::{self, DIRECTORY, Harness, Seen, WAIT};

use std::sync::Arc;

use opencode_api::generated::V2Event;
use opencode_local::cli_config::{Info, Markdown as MarkdownMode, Session as SessionConfig, Tabs, TabsMode};
use opencode_tui::Deps;
use opencode_ui::markdown::{CodeBlockRenderers, MarkdownParser};
use opentui::style::Color;
use serde_json::{Value, json};

const SESSION: &str = "ses_find_test";

fn mount_session(width: u16, height: u16, messages: Vec<Value>, enabled: bool) -> Harness {
    let experimental = if enabled { json!({ "session-find": true }) } else { json!({}) };
    let mut info: Info = opencode_local::cli_config::decode_text(
        &json!({ "animations": false, "experimental": experimental }).to_string(),
    )
    .unwrap();
    info.tabs = Some(Tabs { mode: Some(TabsMode::Off), ..Tabs::default() });
    let fake = support::Fake::new(move |seen: &Seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_find_test") => (200, json!({ "data": support::session(SESSION, "Find") })),
        ("GET", "/api/session/ses_find_test/message") => {
            let mut rev = messages.clone();
            rev.reverse();
            (200, json!({ "data": rev, "cursor": {} }))
        }
        ("GET", "/api/session/ses_find_test/inbox") => (200, json!({ "data": [] })),
        _ => support::base(seen, DIRECTORY),
    });
    let deps =
        Deps { config: support::config(info), route: support::session_route(SESSION), ..support::deps(Arc::new(fake)) };
    support::mount(width, height, deps)
}

fn user_msg(id: &str, text: &str, created: u64) -> Value {
    json!({ "id": id, "type": "user", "text": text, "time": { "created": created } })
}

fn assistant_msg(id: &str, text: &str, created: u64) -> Value {
    json!({
        "id": id,
        "type": "assistant",
        "agent": "build",
        "model": { "providerID": "p", "id": "m" },
        "finish": "stop",
        "time": { "created": created, "completed": created + 1 },
        "content": [{ "type": "text", "text": text }],
    })
}

fn painted_runs(h: &Harness, bg: Color) -> Vec<String> {
    let capture = h.app.render();
    let mut runs = Vec::new();
    for y in 0..capture.height {
        let mut run = String::new();
        for x in 0..capture.width {
            let cell = capture.cell(x, y).unwrap();
            if cell.bg == bg {
                run.push_str(&cell.symbol);
            } else if !run.is_empty() {
                runs.push(std::mem::take(&mut run));
            }
        }
        if !run.is_empty() {
            runs.push(run);
        }
    }
    runs
}

#[test]
fn session_find_is_gated_by_experiment_and_opens_via_keybinds_and_slash() {
    let messages = vec![user_msg("m1", "alpha needle", 1)];
    // Off by default: <leader>f and super+f do nothing.
    let h = mount_session(100, 30, messages.clone(), false);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("alpha needle")));
    h.app.press("ctrl+x");
    h.app.press("f");
    h.app.render();
    assert!(!h.app.text().contains("Find in session..."));
    h.app.press("super+f");
    h.app.render();
    assert!(!h.app.text().contains("Find in session..."));

    // Enabled: super+f and /find both open Find.
    let h = mount_session(100, 30, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("alpha needle")));
    h.app.press("super+f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.press("escape");
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Find in session...")));

    // /find slash command opens Find.
    h.app.type_text("/find");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session")));
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
}

#[test]
fn bounded_transcript_window_finds_and_reveals_unmounted_matches_and_plain_fences() {
    // 80 filler messages ensure the earliest messages are well outside TAIL_ROWS (40) on initial open.
    let mut messages = vec![
        user_msg("msg_000", "Earliest hidden needle", 1),
        assistant_msg(
            "msg_001",
            "Concealed **foo**bar and plain fence:\n\n```\nplain needle here\n```\n\n```typescript\nconst x = 1\n```",
            2,
        ),
    ];
    for index in 0..80 {
        messages.push(user_msg(&format!("msg_{:03}", index + 2), &format!("Filler turn {index}"), index as u64 + 10));
    }
    messages.push(user_msg("msg_999", "Tail needle at bottom", 200));

    let h = mount_session(100, 30, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Tail needle at bottom")));
    assert!(!h.app.text().contains("Earliest hidden needle"));

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));

    h.app.type_text("needle");
    // Match 1 is in unmounted msg_000, match 2 in plain fence of unmounted msg_001, match 3 at the tail.
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 1 of 3") && screen.contains("Earliest hidden needle")
    }));
    let theme = h.tui.page();
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["needle"]);
    assert_eq!(painted_runs(&h, theme.find.background.r#match), vec!["needle"]);

    // Move to match 2 (inside plain code fence without an info string).
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 2 of 3") && screen.contains("plain needle here")
    }));
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["needle"]);

    // Move to match 3 (back down at the tail).
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 3 of 3") && screen.contains("Tail needle at bottom")
    }));
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["needle"]);

    // Escape clears highlights even after moving back up to the plain fence.
    h.app.press("escape");
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Find in session...")));
    assert!(painted_runs(&h, theme.find.background.current).is_empty());
    assert!(painted_runs(&h, theme.find.background.r#match).is_empty());

    // Concealed bold match in an unmounted row is still found and brought into view.
    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.type_text("foobar");
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 1 of 1") && screen.contains("Concealed foobar")
    }));
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["foobar"]);
}

#[test]
fn preserves_prompt_draft_keeps_match_on_case_or_whitespace_change_and_closes_on_permission() {
    let messages = vec![user_msg("m1", "First needle", 1), user_msg("m2", "Second NEEDLE", 2)];
    let h = mount_session(100, 30, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Second NEEDLE")));

    // Type a draft in the prompt before opening Find.
    h.app.type_text("keep this draft");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("keep this draft")));

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    assert!(!h.app.text().contains("keep this draft"));

    h.app.type_text("needle");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find · 1 of 2")));
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find · 2 of 2")));
    // Adding trailing whitespace keeps match 2 selected instead of resetting to 1.
    h.app.type_text(" ");
    h.app.render();
    assert!(h.app.text().contains("Find · 2 of 2"));

    // Escape closes Find and brings the prompt back with its draft intact.
    h.app.press("escape");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("keep this draft")));

    // Reopen Find, then emit a permission request: Find closes automatically.
    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    let event = json!({
        "id": "evt_perm",
        "created": 10,
        "type": "permission.asked",
        "data": {
            "id": "perm_1",
            "sessionID": SESSION,
            "action": "shell",
            "resources": ["ls"],
            "save": [],
        },
    });
    h.tui.data.apply(vec![serde_json::from_value::<V2Event>(event).unwrap()]);
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Find in session...")));
}

#[test]
fn narrow_terminal_hides_next_and_previous_hints_and_keeps_esc_close() {
    let messages = vec![user_msg("m1", "hello needle", 1)];
    let h = mount_session(46, 20, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("hello needle")));
    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    let screen = h.app.text();
    assert!(screen.contains("esc close"), "{screen}");
    assert!(!screen.contains("shift+enter previous"), "{screen}");
    assert!(!screen.contains("enter next"), "{screen}");
}

#[test]
fn table_find_highlights_keep_the_theme_border_color_across_restyle() {
    let table = "| key | value |\n| --- | --- |\n| needle | alpha |\n| beta | needle |";
    let h = mount_session(100, 30, vec![assistant_msg("m1", table, 1)], true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("┌") && h.app.text().contains("needle")));
    let corner_fg = |h: &Harness| h.app.render().cells.iter().find(|cell| cell.symbol == "┌").expect("table corner").fg;
    let initial = h.tui.page();
    assert_eq!(corner_fg(&h), initial.border.base);

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.type_text("needle");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find · 1 of 2")));
    assert_eq!(corner_fg(&h), initial.border.base);
    assert_eq!(painted_runs(&h, initial.find.background.current), vec!["needle"]);
    assert_eq!(painted_runs(&h, initial.find.background.r#match), vec!["needle"]);

    assert!(h.tui.theme.borrow_mut().set("tokyonight"));
    h.tui.theme_changed();
    h.app.render();
    let switched = h.tui.page();
    assert_ne!(switched.border.base, initial.border.base);
    assert_eq!(corner_fg(&h), switched.border.base);
    assert_eq!(painted_runs(&h, switched.find.background.current), vec!["needle"]);
    assert_eq!(painted_runs(&h, switched.find.background.r#match), vec!["needle"]);
}

fn mount_session_with(width: u16, height: u16, messages: Vec<Value>, markdown_mode: MarkdownMode) -> Harness {
    let mut info: Info = opencode_local::cli_config::decode_text(
        &json!({ "animations": false, "experimental": { "session-find": true } }).to_string(),
    )
    .unwrap();
    info.tabs = Some(Tabs { mode: Some(TabsMode::Off), ..Tabs::default() });
    info.session = Some(SessionConfig { markdown: Some(markdown_mode), ..SessionConfig::default() });
    let fake = support::Fake::new(move |seen: &Seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_find_test") => (200, json!({ "data": support::session(SESSION, "Find") })),
        ("GET", "/api/session/ses_find_test/message") => {
            let mut rev = messages.clone();
            rev.reverse();
            (200, json!({ "data": rev, "cursor": {} }))
        }
        ("GET", "/api/session/ses_find_test/inbox") => (200, json!({ "data": [] })),
        _ => support::base(seen, DIRECTORY),
    });
    let deps =
        Deps { config: support::config(info), route: support::session_route(SESSION), ..support::deps(Arc::new(fake)) };
    support::mount(width, height, deps)
}

/// Reads the `Find · N of M` (or `No matches`) totals from the rendered Find bar.
fn find_counter(screen: &str) -> Option<(usize, usize)> {
    let line = screen.lines().find(|line| line.contains("Find · "))?;
    let rest = line.split("Find · ").nth(1)?.trim();
    if rest.starts_with("No matches") {
        return Some((0, 0));
    }
    let mut words = rest.split_whitespace();
    let current: usize = words.next()?.parse().ok()?;
    if words.next()? != "of" {
        return None;
    }
    let total: usize = words.next()?.parse().ok()?;
    Some((current, total))
}

/// Counts matches using `MarkdownParser` alone (no widgets, no layout). Returns `None` when a
/// custom-rendered code block matches `query` (requiring a real mount to know whether it draws).
fn parser_count(
    h: &Harness,
    source: &str,
    query: &str,
    conceal: bool,
    renderers: &CodeBlockRenderers,
) -> Option<usize> {
    let pattern = opencode_tui::routes::session::find::find_pattern(query);
    let mut parser = MarkdownParser::new(h.app.app()).unwrap();
    let syntax = opencode_ui::code::syntax_theme(&h.tui.page());
    let parsed = parser.parse(h.app.app(), source.trim(), renderers, conceal, &syntax, |spans, icx| {
        opencode_tui::features::session_links::transform_readonly(&h.tui, spans, icx)
    });
    let mut total = 0usize;
    for block in &parsed.blocks {
        let count = opencode_tui::routes::session::find::find_ranges(block.text(), pattern.as_ref()).len();
        if block.is_claimed_code() && count > 0 {
            return None;
        }
        total += count;
    }
    Some(total)
}

#[test]
fn unmounted_and_mounted_find_counts_match_across_markdown_corpus() {
    let u4a: Value = serde_json::from_str(include_str!("../../../../parity/fixtures/U.4a/corpus.json")).unwrap();
    let u4c: Value = serde_json::from_str(include_str!("../../../../parity/fixtures/U.4c/corpus.json")).unwrap();
    let p3_msg: Value = serde_json::from_str(include_str!("../../../../parity/fixtures/P.3/message.json")).unwrap();
    let p3_corpus: Value = serde_json::from_str(include_str!("../../../../parity/fixtures/P.3/corpus.json")).unwrap();

    // Take a sample of P.3 mermaid diagrams wrapped as fenced blocks.
    let p3_sample: String = p3_corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .take(6)
        .map(|case| format!("```mermaid\n{}\n```", case["source"].as_str().unwrap()))
        .collect::<Vec<_>>()
        .join("\n\n");

    let corpus: Vec<(&str, String, &str)> = vec![
        ("setext-h1", "Setext **needle** heading\n========================\n\nBody needle.".into(), "needle"),
        ("setext-h2", "Subheading needle\n-----------------\n\nAfter.".into(), "needle"),
        ("nested-and-lazy-list", "- first needle\n  - nested **nee**dle\n  - [x] task needle\n- lazy start\nlazy needle continuation\n\n  1. ordered needle".into(), "needle"),
        ("reference-links", "See [label needle][ref], [ref2][], and [shortcut].\n\n[ref]: https://needle.example.com/hidden\n[ref2]: https://needle.example.com/hidden2\n[shortcut]: https://needle.example.com/hidden3".into(), "needle"),
        ("autolinks", "Visit <https://needle.example.com> and <needle@example.com> and https://needle.example.org.".into(), "needle"),
        ("inline-html", "Before <span>needle</span> and <a href=\"https://needle.test\">link</a> and foo<br>needle.".into(), "needle"),
        ("block-html", "<div>\nneedle in html block\n</div>\n\nParagraph needle.".into(), "needle"),
        ("table", "| col | needle |\n| --- | --- |\n| **nee**dle | `needle` |".into(), "needle"),
        ("named-fence-info-hidden", "```needle\nconst x = 1\n```\n\n```ts\nconst needle = 2\n```".into(), "needle"),
        ("plain-fences", "```\nplain needle\n```\n\n~~~\ntilde needle\n~~~".into(), "needle"),
        ("nested-plain-fence", "- item needle\n\n  ```\n  nested plain needle\n  ```\n\n> ```\n> quoted plain needle\n> ```".into(), "needle"),
        ("indented-code-top", "Intro needle.\n\n    const a = needle;\n    const b = `needle`;".into(), "needle"),
        ("indented-code-in-list", "- list item\n\n      indented in list needle\n      second line".into(), "needle"),
        ("indented-code-in-quote", "> quote intro\n>\n>     quoted indented needle".into(), "needle"),
        ("inline-and-display-math", "Formula $x + 1$ and needle.\n\n$$\n\\frac{a}{b}\n$$\n\nAfter needle.".into(), "needle"),
        ("invalid-latex-fallback", "```latex\n\\undefined_cmd_needle\n```".into(), "needle"),
        ("invalid-mermaid-fallback", "```mermaid\nnot a valid mermaid needle\n```".into(), "needle"),
        ("p3-message", p3_msg["message"].as_str().unwrap().to_owned(), "Idea"),
        ("p3-corpus-diagrams", format!("{p3_sample}\n\nOutside Flowchart"), "Flowchart"),
        ("u4a-prose", u4a["prose"].as_str().unwrap().to_owned(), "Session"),
        ("u4a-prose-url", u4a["prose"].as_str().unwrap().to_owned(), "opencode.ai"),
        ("u4a-fences", u4a["fences"].as_str().unwrap().to_owned(), "return"),
        ("u4c-table", u4c["table"].as_str().unwrap().to_owned(), "code"),
    ];

    for (mode_name, mode, conceal) in
        [("rendered", MarkdownMode::Rendered, true), ("source", MarkdownMode::Source, false)]
    {
        for (name, doc, query) in &corpus {
            // Place the document at msg_000 behind 50 filler messages so it starts UNMOUNTED.
            let mut messages = vec![assistant_msg("msg_000", doc, 1)];
            for index in 0..50 {
                messages.push(user_msg(&format!("fill_{index:03}"), &format!("Filler {index}"), index as u64 + 10));
            }
            let h = mount_session_with(100, 30, messages, mode);
            assert!(h.app.wait_until(WAIT, || h.app.text().contains("Filler 49")), "{mode_name}/{name}");
            let renderers = opencode_tui::plugins::host::code_blocks(&h.tui);
            let static_count = parser_count(&h, doc, query, conceal, &renderers);

            h.app.press("ctrl+x");
            h.app.press("f");
            assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
            h.app.type_text(query);
            assert!(
                h.app.wait_until(WAIT, || find_counter(&h.app.text()).is_some()),
                "{mode_name}/{name}: find counter never appeared:\n{}",
                h.app.text()
            );
            h.app.render();
            h.app.render();
            let (_, unmounted_session_total) = find_counter(&h.app.text()).unwrap();
            if let Some(expected) = static_count {
                assert_eq!(
                    expected,
                    unmounted_session_total,
                    "{mode_name}/{name} (query={query:?}): parser count ({expected}) != session total ({unmounted_session_total})\ndoc:\n{doc}\nscreen:\n{}",
                    h.app.text()
                );
            }

            // Compare against a session where the same document is mounted directly at the tail.
            let direct = mount_session_with(100, 30, vec![assistant_msg("msg_000", doc, 1)], mode);
            assert!(direct.app.wait_until(WAIT, || direct.app.text().contains("Build")), "{mode_name}/{name}");
            direct.app.press("ctrl+x");
            direct.app.press("f");
            assert!(direct.app.wait_until(WAIT, || direct.app.text().contains("Find in session...")));
            direct.app.type_text(query);
            assert!(
                direct.app.wait_until(WAIT, || find_counter(&direct.app.text()).is_some()),
                "{mode_name}/{name}: direct find counter never appeared:\n{}",
                direct.app.text()
            );
            direct.app.render();
            direct.app.render();
            let (_, mounted_total) = find_counter(&direct.app.text()).unwrap();
            assert_eq!(
                unmounted_session_total,
                mounted_total,
                "{mode_name}/{name} (query={query:?}): unmounted count ({unmounted_session_total}) != mounted total ({mounted_total})\ndoc:\n{doc}\nscreen:\n{}",
                direct.app.text()
            );
        }
    }
}

#[test]
fn long_session_find_navigation_keeps_count_stable_and_visits_every_match_once() {
    // 110 messages with diverse Markdown constructs at the head, middle, and tail — well beyond
    // the bounded transcript window (TAIL_ROWS = 40, MARGIN = 60).
    let mut messages = vec![
        user_msg("m_000", "U000: alpha needle", 1),
        assistant_msg(
            "m_001",
            "Setext M001 needle\n==================\n\n- lazy item\nlazy M001 needle\n\nSee [ref M001 needle][r]\n\n[r]: https://needle.example.com",
            2,
        ),
        assistant_msg(
            "m_002",
            "Inline <span>M002 needle</span> and <https://needle.example.org>\n\n    indented M002 needle",
            3,
        ),
    ];
    for index in 0..50 {
        messages.push(user_msg(&format!("f1_{index:03}"), &format!("Early filler {index}"), 10 + index as u64));
    }
    messages.push(assistant_msg(
        "m_mid",
        "Middle **nee**dle prose\n\n```\nplain mid needle\n```\n\n| k | v |\n| --- | --- |\n| x | table mid needle |",
        100,
    ));
    messages.push(json!({
        "id": "m_cmp",
        "type": "compaction",
        "status": "completed",
        "reason": "manual",
        "summary": "Compaction mid needle summary",
        "time": { "created": 101 }
    }));
    for index in 0..50 {
        messages.push(user_msg(&format!("f2_{index:03}"), &format!("Late filler {index}"), 110 + index as u64));
    }
    messages.push(assistant_msg(
        "m_tail_md",
        "```mermaid\nflowchart LR\n  A[needle] --> B[end]\n```\n\nTail prose needle",
        200,
    ));
    messages.push(user_msg("m_tail_u", "Last tail needle", 201));

    // Expected exact occurrences in transcript order (TestApp has OSC 8 hyperlinks off, so the
    // reference link renders its URL in parentheses: "ref M001 needle (https://needle.example.com)"):
    // m_000: 1 (U000)
    // m_001: 4 (setext, lazy list, ref link label, ref link URL shown when hyperlinks are off)
    // m_002: 3 (inline html, autolink, indented code)
    // m_mid: 3 (concealed bold, plain fence, table cell)
    // m_cmp: 1 (compaction summary)
    // m_tail_md: 1 (mermaid diagram claimed -> 0; tail prose -> 1)
    // m_tail_u: 1 (user prompt)
    // Total = 14.
    let expected_total = 14usize;
    let expected_markers: [&str; 14] = [
        "U000: alpha",
        "Setext M001",
        "lazy M001",
        "ref M001",
        "needle.example.com",
        "M002 needle",
        "needle.example.org",
        "indented M002",
        "Middle needle prose",
        "plain mid",
        "table mid",
        "Compaction mid",
        "Tail prose",
        "Last tail",
    ];

    let h = mount_session_with(100, 30, messages, MarkdownMode::Rendered);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Last tail needle")));
    assert!(!h.app.text().contains("U000: alpha"));

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.type_text("needle");

    let theme = h.tui.page();
    // Step forwards through all 13 matches and wrap back to 1.
    for step in 0..=expected_total {
        let idx = step % expected_total;
        let expected_label = format!("Find · {} of {expected_total}", idx + 1);
        let marker = expected_markers[idx];
        assert!(
            h.app.wait_until(WAIT, || {
                let screen = h.app.text();
                screen.contains(&expected_label) && screen.contains(marker)
            }),
            "forward step {step}: expected {expected_label:?} with {marker:?}:\n{}",
            h.app.text()
        );
        assert_eq!(
            find_counter(&h.app.text()),
            Some((idx + 1, expected_total)),
            "count drifted at forward step {step}"
        );
        assert_eq!(
            painted_runs(&h, theme.find.background.current),
            vec!["needle"],
            "missing current highlight at forward step {step} ({marker})"
        );
        if step < expected_total {
            h.app.press("enter");
        }
    }

    // Step backwards through all 13 matches (starting at 1 -> wraps to 13 -> 12 -> ... -> 1).
    for back in 0..expected_total {
        h.app.press("up");
        let idx = expected_total - 1 - back;
        let expected_label = format!("Find · {} of {expected_total}", idx + 1);
        let marker = expected_markers[idx];
        assert!(
            h.app.wait_until(WAIT, || {
                let screen = h.app.text();
                screen.contains(&expected_label) && screen.contains(marker)
            }),
            "backward step {back}: expected {expected_label:?} with {marker:?}:\n{}",
            h.app.text()
        );
        assert_eq!(
            find_counter(&h.app.text()),
            Some((idx + 1, expected_total)),
            "count drifted at backward step {back}"
        );
        assert_eq!(
            painted_runs(&h, theme.find.background.current),
            vec!["needle"],
            "missing current highlight at backward step {back} ({marker})"
        );
    }
}

#[test]
fn consecutive_identical_unmounted_messages_and_session_links_match_mounted_count() {
    let linked_id = "ses_linkedlinkedlinkedlinkedli";
    let doc = format!("Same **needle** body linking {linked_id}");
    let mut messages = vec![assistant_msg("m_0", &doc, 1), assistant_msg("m_1", &doc, 2)];
    for index in 0..50 {
        messages.push(user_msg(&format!("fill_{index:03}"), &format!("Filler {index}"), index as u64 + 10));
    }
    let mut info: Info = opencode_local::cli_config::decode_text(
        &json!({ "animations": false, "experimental": { "session-find": true } }).to_string(),
    )
    .unwrap();
    info.tabs = Some(Tabs { mode: Some(TabsMode::Off), ..Tabs::default() });
    let fake = support::Fake::new(move |seen: &Seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_find_test") => (200, json!({ "data": support::session(SESSION, "Find") })),
        ("GET", "/api/session/ses_linkedlinkedlinkedlinkedli") => {
            (200, json!({ "data": support::session(linked_id, "Linked needle title") }))
        }
        ("GET", "/api/session/ses_find_test/message") => {
            let mut rev = messages.clone();
            rev.reverse();
            (200, json!({ "data": rev, "cursor": {} }))
        }
        ("GET", "/api/session/ses_find_test/inbox") => (200, json!({ "data": [] })),
        _ => support::base(seen, DIRECTORY),
    });
    let deps =
        Deps { config: support::config(info), route: support::session_route(SESSION), ..support::deps(Arc::new(fake)) };
    let h = support::mount(100, 30, deps);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Filler 49")));
    // Sync the linked session into the store before opening Find so session_links resolves it.
    drop(h.tui.data.session_sync(&opencode_api::generated::SessionID(linked_id.into()), false));
    assert!(h.app.wait_until(WAIT, || {
        h.tui.data.read(|state| state.session(&opencode_api::generated::SessionID(linked_id.into())).is_some())
    }));

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.type_text("needle");
    // Each of the two identical messages has 2 matches: "needle" in bold prose + "@Linked needle title".
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find · 1 of 4")));
    for step in 0..4 {
        assert_eq!(find_counter(&h.app.text()), Some((step + 1, 4)));
        h.app.press("enter");
        h.app.render();
    }
    assert_eq!(find_counter(&h.app.text()), Some((1, 4)));
}

#[test]
fn plugin_fence_find_never_makes_throwaway_calls_and_keeps_counts_stable() {
    use std::sync::Mutex;

    use opencode_plugin_abi::{Fenced, Plugin, Setup, Span as AbiSpan};

    #[derive(Default)]
    struct Log {
        renders: Vec<(String, u64, String)>,
        gone: Vec<u64>,
        drawn_once: std::collections::HashSet<u64>,
    }

    static LOG: std::sync::OnceLock<Mutex<Log>> = std::sync::OnceLock::new();
    let log = LOG.get_or_init(|| Mutex::new(Log::default()));
    *log.lock().unwrap() = Log::default();

    fn setup(setup: &mut Setup) -> Result<(), String> {
        let log = LOG.get().unwrap();
        setup.on_fence_gone(move |key| {
            log.lock().unwrap().gone.push(key);
        });
        setup.code_block("drawfence", move |_, fence| {
            log.lock().unwrap().renders.push((fence.language.clone(), fence.key, fence.code.clone()));
            Fenced::Lines { lines: vec![vec![AbiSpan::new("DRAWN-WIDGET")]], fg: None, drag: false }
        });
        setup.code_block("codefence", move |_, fence| {
            log.lock().unwrap().renders.push((fence.language.clone(), fence.key, fence.code.clone()));
            Fenced::Code
        });
        setup.code_block("keepfence", move |_, fence| {
            log.lock().unwrap().renders.push((fence.language.clone(), fence.key, fence.code.clone()));
            Fenced::Keep
        });
        setup.code_block("stickyfence", move |_, fence| {
            let mut guard = log.lock().unwrap();
            guard.renders.push((fence.language.clone(), fence.key, fence.code.clone()));
            if guard.drawn_once.insert(fence.key) {
                Fenced::Lines { lines: vec![vec![AbiSpan::new("STICKY-WIDGET")]], fg: None, drag: false }
            } else {
                Fenced::Keep
            }
        });
        Ok(())
    }

    // Four unmounted messages with matching fences at the head, separated by 70 filler rows from
    // an unmounted non-matching drawfence (`m_skip`, whose text has no letter of "needle" and sits
    // outside every mount window), then 70 more filler rows, then one tail prompt:
    // m_draw: prose before + drawfence (draws -> 0 matches) + prose after -> 2 matches.
    // m_sticky: stickyfence (draws once, then Fenced::Keep) + rust code fence -> 1 match (forces full repaint on step).
    // m_code: prose before + codefence (Fenced::Code -> 1 match) + prose after -> 3 matches.
    // m_keep: prose before + keepfence (Fenced::Keep with no previous -> code -> 1 match) + prose after -> 3 matches.
    // m_skip: drawfence with "xyzzy" -> never matches any prefix of "needle" and never mounts -> 0 plugin calls!
    // m_tail: "Tail prompt needle" -> 1 match.
    // Total = 2 + 1 + 3 + 3 + 1 = 10.
    let mut messages = vec![
        assistant_msg("m_draw", "Before draw needle\n\n```drawfence\ndrawn hidden needle\n```\n\nAfter draw needle", 1),
        assistant_msg(
            "m_sticky",
            "```stickyfence\nsticky hidden needle\n```\n\n```rust\nlet sticky_rust = \"needle\";\n```",
            2,
        ),
        assistant_msg(
            "m_code",
            "Before code needle\n\n```codefence\nfallback code needle\n```\n\nAfter code needle",
            3,
        ),
        assistant_msg(
            "m_keep",
            "Before keep needle\n\n```keepfence\nkeep fallback needle\n```\n\nAfter keep needle",
            4,
        ),
    ];
    for index in 0..70 {
        messages.push(user_msg(&format!("pf1_{index:03}"), &format!("Gap A {index}"), 10 + index as u64));
    }
    messages.push(assistant_msg("m_skip", "```drawfence\nxyzzy\n```", 100));
    for index in 0..70 {
        messages.push(user_msg(&format!("pf2_{index:03}"), &format!("Gap B {index}"), 110 + index as u64));
    }
    messages.push(user_msg("m_tail", "Tail prompt needle", 300));

    let mut info: Info = opencode_local::cli_config::decode_text(
        &json!({ "animations": false, "experimental": { "session-find": true } }).to_string(),
    )
    .unwrap();
    info.tabs = Some(Tabs { mode: Some(TabsMode::Off), ..Tabs::default() });
    let fake = support::Fake::new(move |seen: &Seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_find_test") => (200, json!({ "data": support::session(SESSION, "Find") })),
        ("GET", "/api/session/ses_find_test/message") => {
            let mut rev = messages.clone();
            rev.reverse();
            (200, json!({ "data": rev, "cursor": {} }))
        }
        ("GET", "/api/session/ses_find_test/inbox") => (200, json!({ "data": [] })),
        _ => support::base(seen, DIRECTORY),
    });
    let deps = Deps {
        config: support::config(info),
        route: support::session_route(SESSION),
        builtins: vec![Plugin { id: "test.fences", setup }.into()],
        ..support::deps(Arc::new(fake))
    };
    let h = support::mount(100, 30, deps);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Tail prompt needle")));
    assert!(log.lock().unwrap().renders.is_empty(), "unmounted fences should not render before Find");

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.type_text("needle");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find · 1 of 10")), "{}", h.app.text());

    // Verify no throwaway key 0 and no call for the non-matching unmounted fence (`m_skip`).
    {
        let recorded = log.lock().unwrap();
        assert!(recorded.renders.iter().all(|(_, key, _)| *key > 0), "saw throwaway key 0: {:?}", recorded.renders);
        assert!(recorded.gone.iter().all(|&key| key > 0), "saw fence-gone(0): {:?}", recorded.gone);
        assert!(
            !recorded.renders.iter().any(|(_, _, code)| code.contains("xyzzy")),
            "non-matching unmounted fence should never be rendered: {:?}",
            recorded.renders
        );
        let draw_keys: Vec<u64> =
            recorded.renders.iter().filter(|(lang, _, _)| lang == "drawfence").map(|(_, key, _)| *key).collect();
        assert_eq!(draw_keys.len(), 1, "drawfence should render once with one real key: {draw_keys:?}");
        assert!(recorded.gone.is_empty(), "no fence-gone while Find keeps drawn fence mounted: {:?}", recorded.gone);
    }

    // Step forwards through all 10 matches and wrap back to 1: total stays 10 at every single step.
    let markers = [
        "Before draw needle",
        "After draw needle",
        "sticky_rust",
        "Before code needle",
        "fallback code needle",
        "After code needle",
        "Before keep needle",
        "keep fallback needle",
        "After keep needle",
        "Tail prompt needle",
    ];
    let theme = h.tui.page();
    for step in 0..=markers.len() {
        let idx = step % markers.len();
        let label = format!("Find · {} of 10", idx + 1);
        let marker = markers[idx];
        assert!(
            h.app.wait_until(WAIT, || {
                let screen = h.app.text();
                screen.contains(&label) && screen.contains(marker)
            }),
            "forward step {step}: expected {label:?} with {marker:?}:\n{}",
            h.app.text()
        );
        assert_eq!(find_counter(&h.app.text()), Some((idx + 1, 10)));
        assert_eq!(painted_runs(&h, theme.find.background.current), vec!["needle"]);
        if step < markers.len() {
            h.app.press("enter");
        }
    }

    // Step backwards across all 10 matches: total stays 10.
    for back in 0..markers.len() {
        h.app.press("up");
        let idx = markers.len() - 1 - back;
        let label = format!("Find · {} of 10", idx + 1);
        let marker = markers[idx];
        assert!(
            h.app.wait_until(WAIT, || {
                let screen = h.app.text();
                screen.contains(&label) && screen.contains(marker)
            }),
            "backward step {back}: expected {label:?} with {marker:?}:\n{}",
            h.app.text()
        );
        assert_eq!(find_counter(&h.app.text()), Some((idx + 1, 10)));
    }

    // Move back to the tail (match 10) so m_draw and m_sticky are off-window, then close Find: their real keys go.
    h.app.press("up");
    assert!(
        h.app.wait_until(WAIT, || h.app.text().contains("Find · 10 of 10") && h.app.text().contains("Tail prompt"))
    );
    h.app.press("escape");
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Find ·")));
    h.app.render();
    let recorded = log.lock().unwrap();
    let drawn_keys: std::collections::HashSet<u64> = recorded
        .renders
        .iter()
        .filter(|(lang, _, _)| lang == "drawfence" || lang == "stickyfence")
        .map(|(_, key, _)| *key)
        .collect();
    assert_eq!(drawn_keys.len(), 2, "expected one real key each for drawfence and stickyfence: {drawn_keys:?}");
    assert!(drawn_keys.iter().all(|&key| key > 0));
    for key in &drawn_keys {
        assert!(
            recorded.gone.contains(key),
            "closing Find should release off-window drawn fence key {key} (drawn={drawn_keys:?}, gone={:?})",
            recorded.gone
        );
    }
    assert!(recorded.gone.iter().all(|&key| key > 0), "never fence-gone(0): {:?}", recorded.gone);
}
