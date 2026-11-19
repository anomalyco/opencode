//! Exercise JavaScript Markdown renderers across the pipe: placeholder, adoption, fallback, quotas, and teardown.

use std::cell::Cell;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::claim::mounted;
use opencode_plugin::pipe::{Config, Tamper};
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

use crate::plugin_pipe::{EXAMPLES, Pipe, config, copy};
use crate::support;

const SESSION: &str = "ses_f";
const ID: &str = "example.fences";

struct Fences {
    pipe: Pipe,
    seq: Cell<u64>,
}

impl Fences {
    fn open(config: Config, options: Option<Value>) -> Self {
        Self::open_with(config, options, false)
    }

    fn open_with(config: Config, options: Option<Value>, other: bool) -> Self {
        let root = opencode_util::temp::tempdir().unwrap();
        let config_dir = root.path().join("config");
        let dir = config_dir.join("plugins").join("fences");
        copy(&Path::new(EXAMPLES).join("fences"), &dir);
        if other {
            let second = config_dir.join("plugins").join("other");
            copy(&Path::new(EXAMPLES).join("fences"), &second);
            let source = std::fs::read_to_string(second.join("tui.ts")).unwrap();
            let source = source
                .replace("id: \"example.fences\"", "id: \"example.other\"")
                .replace("registerCodeBlockRenderer(\"probe\"", "registerCodeBlockRenderer(\"other\"");
            std::fs::write(second.join("tui.ts"), source).unwrap();
        }
        let session = support::merge(support::session(SESSION, "Fences"), json!({ "agent": "build" }));
        let messages = json!([
            {
                "id": "msg_2", "type": "assistant", "agent": "build",
                "model": { "providerID": "provider", "id": "model" }, "time": { "created": 1500 }, "content": [],
            },
            { "id": "msg_1", "type": "user", "text": "Show fences", "time": { "created": 1000 } },
        ]);
        let fake = support::Fake::new(move |seen| match seen.path.as_str() {
            "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            "/api/session/ses_f" => (200, json!({ "data": session })),
            "/api/session/ses_f/message" => (200, json!({ "data": messages, "cursor": {} })),
            "/api/session/ses_f/permission" | "/api/session/ses_f/inbox" => (200, json!({ "data": [] })),
            _ => support::not_found(),
        });
        let mut info = json!({ "animations": false });
        if let Some(options) = options {
            info["plugins"] = json!([{ "package": dir.to_string_lossy(), "options": options }]);
        }
        let info = support::decode(&info.to_string());
        let deps = Deps {
            config: support::config(info),
            route: support::session_route(SESSION),
            ..support::deps(Arc::new(fake))
        };
        let harness = support::mount(100, 60, deps);
        let external = External { config_dir, cwd: root.path().to_path_buf(), dev: Vec::new() };
        external_with(&harness.tui, external, Some(config));
        let pipe = Pipe { harness, root };
        pipe.active(ID);
        if other {
            pipe.active("example.other");
        }
        pipe.harness.wait_for("Show fences");
        pipe.settle();
        Self { pipe, seq: Cell::new(0) }
    }

    fn emit(&self, kind: &str, data: Value) {
        let seq = self.seq.get() + 1;
        self.seq.set(seq);
        let ids = json!({ "sessionID": SESSION, "assistantMessageID": "msg_2" });
        let tui = &self.pipe.harness.tui;
        tui.data.apply(&[support::event(SESSION, kind, seq, support::merge(ids, data))]);
        assert!(self.pipe.harness.app.wait_until(support::WAIT, || tui.synced()), "the views never took the event");
    }

    fn answer(&self, text: &str) {
        self.emit("session.text.started", json!({ "ordinal": 0 }));
        self.more(text);
    }

    fn more(&self, text: &str) {
        self.emit("session.text.delta", json!({ "ordinal": 0, "delta": text }));
    }

    fn now(&self) -> String {
        let app = &self.pipe.harness.app;
        app.advance(Duration::from_millis(1));
        app.render();
        app.text()
    }

    /// The screen once the JS host settled.
    fn settled(&self) -> String {
        self.pipe.settle();
        self.now()
    }

    fn toasts(&self) -> Vec<String> {
        let tui = &self.pipe.harness.tui;
        let mut toasts = Vec::new();
        while let Some(toast) = tui.toasts.current() {
            toasts.push(toast.message.clone());
            tui.toasts.dismiss();
        }
        toasts
    }

    fn status(&self) -> Option<opencode_plugin::Status> {
        self.pipe.status(ID)
    }

    /// Whether the JS host holds a tree in flight once it handled everything sent so far: a ping, waited for 5 s at
    /// most, which [`Pipe::settle`] would wait on for good.
    fn in_flight(&self) -> Option<bool> {
        let scripts = self.pipe.scripts();
        let seq = scripts.ping();
        // A wait for the JS host moves no clock (compat-harness).
        self.pipe.harness.app.wait_until(Duration::from_secs(5), || {
            crate::plugin_pipe::still(&self.pipe.harness.app);
            scripts.ponged(seq).is_some()
        });
        scripts.ponged(seq)
    }
}

fn drawn() -> usize {
    mounted().iter().filter(|shown| shown.shows).count()
}

/// Waits, drawing frames, until the tree a `Tamper::Hold` holds has come: it may come after the frames a row waits for,
/// and a replay before it delivers nothing, which leaves the tree held for good (pipe-flakes).
fn hold_came(fences: &Fences) {
    fences.pipe.harness.wait("the tree is held", || {
        fences.now();
        fences.pipe.scripts().kept()
    });
}

#[test]
fn a_js_fence_claim_draws_its_box_after_the_frame() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, None);
    // The JS host's tree waits, however fast it answers: the frames before it comes.
    fences.pipe.scripts().tamper(Tamper::Hold);
    fences.answer("```probe\nlet a = 1;\n");
    let app = &fences.pipe.harness.app;
    app.wait_until(Duration::from_millis(300), || {
        fences.now();
        false
    });
    hold_came(&fences);
    let first = fences.now();
    assert!(first.contains("let a = 1;") && !first.contains("| probe"), "the first frame waited:\n{first}");
    assert_eq!(drawn(), 0, "{:?}", mounted());
    fences.pipe.scripts().replay();
    let screen = fences.settled();
    assert!(screen.contains("| probe") && screen.contains("let a = 1;"), "no box:\n{screen}");
    for delta in ["let b = 2;\n", "```\n\nAfter.\n"] {
        fences.more(delta);
        let screen = fences.now();
        assert!(screen.contains("| probe"), "the box went as the fence streamed:\n{screen}");
    }
    let screen = fences.settled();
    assert!(screen.contains("let b = 2;") && screen.contains("After.") && !screen.contains("```"), "{screen}");
    assert_eq!(drawn(), 1, "{:?}", mounted());
    assert_eq!(fences.status(), Some(opencode_plugin::Status::Active));
}

#[test]
fn a_renderer_that_throws_falls_back_its_part_alone() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, None);
    fences.answer("```nope\ndeclined here\n```\n\n```asks\nasked here\n```\n\n```probe\nboxed here\n```\n\n");
    fences.more("```boom\nthrown here\n");
    let screen = fences.settled();
    for code in ["thrown here", "declined here", "asked here", "boxed here", "| probe"] {
        assert!(screen.contains(code), "{code:?} does not show:\n{screen}");
    }
    assert_eq!(fences.toasts(), ["example.fences crashed in code block boom: boom"]);
    fences.more("more thrown\n```\n\nAfter.\n");
    let screen = fences.settled();
    assert!(screen.contains("more thrown") && screen.contains("After."), "{screen}");
    assert_eq!(fences.toasts(), Vec::<String>::new());
    assert_eq!(fences.status(), Some(opencode_plugin::Status::Active));
    assert_eq!(drawn(), 2, "{:?}", mounted());
}

#[test]
fn what_a_renderer_asks_for_as_it_draws_is_dropped() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, None);
    fences.answer("```asks\nasked here\n```\n\nAfter.\n");
    let screen = fences.settled();
    assert!(screen.contains("asked here"), "{screen}");
    assert_eq!(fences.toasts(), Vec::<String>::new());
    assert_eq!(drawn(), 1, "{:?}", mounted());
}

#[test]
fn three_hundred_fences_mounted_at_once_all_fill_in() {
    let Some(mut config) = config() else { return };
    // A queue to the JS host that takes a few parts at a time: the answer's 300 parts back it up.
    config.limits.queued = 4 << 10;
    let fences = Fences::open(config, None);
    let before = opencode_plugin::pipe::crossed();
    let text: String = (0..300).map(|index| format!("```probe\nfence {index}\n```\n\n")).collect();
    fences.answer(&text);
    fences.settled();
    let shown = mounted();
    assert_eq!((shown.len(), drawn()), (300, 300), "{shown:?}");
    let after = opencode_plugin::pipe::crossed();
    assert!(after.deferred_parts > before.deferred_parts, "no part waited for the queue");
    assert_eq!(after.refused_sends, before.refused_sends, "the queue refused a part");
}

#[test]
fn a_part_another_plugin_held_back_is_offered_once_the_queue_drained() {
    let Some(mut config) = config() else { return };
    config.limits.queued = 4 << 10;
    let fences = Fences::open_with(config, None, true);
    let before = opencode_plugin::pipe::crossed();
    let text: String = (0..300).map(|index| format!("```probe\nfence {index}\n```\n\n")).collect();
    fences.answer(&format!("{text}```other\nlast\n```\n\nAfter.\n"));
    fences.settled();
    let other: Vec<_> = mounted().into_iter().filter(|shown| shown.id.surface == "other").collect();
    assert!(other.len() == 1 && other[0].shows, "the other plugin's part never drew: {other:?}");
    assert!(opencode_plugin::pipe::crossed().deferred_parts > before.deferred_parts, "no part waited");
}

#[test]
fn a_fence_past_the_frame_cap_keeps_the_host_view() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, None);
    let code: String = (0..30_000).map(|line| format!("line {line:05}\n")).collect();
    assert!(code.len() > 256 << 10);
    let refused = opencode_plugin::pipe::crossed().refused_sends;
    fences.answer(&format!("```probe\n{code}```\n\nAfter.\n"));
    let screen = fences.settled();
    assert_eq!(opencode_plugin::pipe::crossed().refused_sends, refused, "the part went to the queue");
    assert!(screen.contains("line 29999") && !screen.contains("| probe"), "{screen}");
    assert_eq!(drawn(), 0, "{:?}", mounted());
    assert_eq!(fences.status(), Some(opencode_plugin::Status::Active));
}

#[test]
fn a_plugin_holds_256_claims() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, Some(json!({ "many": 300 })));
    fences.answer("```x200\ntaken\n```\n\n```x290\nleft\n```\n\nAfter.\n");
    fences.settled();
    let claimed: Vec<String> = mounted().into_iter().map(|shown| shown.id.surface).collect();
    assert_eq!(claimed, ["x200"]);
}

#[test]
fn a_tree_for_a_gone_part_is_dropped() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, None);
    fences.pipe.scripts().tamper(Tamper::Hold);
    fences.answer("```probe\nlet a = 1;\n```\n\nAfter.\n");
    let app = &fences.pipe.harness.app;
    app.wait_until(Duration::from_millis(300), || {
        fences.now();
        false
    });
    hold_came(&fences);
    assert_eq!((mounted().len(), drawn()), (1, 0));
    fences.pipe.harness.tui.navigate(Route::Home);
    for _ in 0..5 {
        fences.now();
    }
    let dropped = opencode_plugin::pipe::crossed().dropped;
    fences.pipe.scripts().replay();
    fences.settled();
    assert_eq!(opencode_plugin::pipe::crossed().dropped, dropped + 1, "the tree was not dropped");
    assert_eq!(mounted(), Vec::new());
    assert_eq!(fences.status(), Some(opencode_plugin::Status::Active));
}

#[test]
fn a_parts_mount_ends_on_the_js_host_after_a_reload() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, None);
    let (app, tui) = (&fences.pipe.harness.app, &fences.pipe.harness.tui);
    fences.pipe.scripts().tamper(Tamper::Hold);
    fences.answer("```probe\nlet a = 1;\n```\n\nAfter.\n");
    app.wait_until(Duration::from_millis(300), || {
        fences.now();
        false
    });
    assert_eq!((mounted().len(), drawn()), (1, 0));
    tui.keymap.dispatch("fences.late", None);
    for _ in 0..20 {
        fences.now();
    }
    fences.pipe.scripts().replay();
    for _ in 0..20 {
        fences.now();
    }
    tui.navigate(Route::Home);
    for _ in 0..20 {
        fences.now();
    }
    assert_eq!(mounted(), Vec::new());
    assert_eq!(fences.in_flight(), Some(false), "the JS host holds a part in flight");
    assert_eq!(fences.status(), Some(opencode_plugin::Status::Active));
}

#[test]
fn a_part_whose_tree_fails_in_flight_falls_back_and_settles() {
    let Some(config) = config() else { return };
    let big: String = (0..30_000).map(|line| format!("line {line:05}\n")).collect();
    for (case, first, then, shown) in [
        ("a throw", "```boom\nfirst\n", "second\n".to_owned(), "second"),
        ("the cap", "```probe\nsmall\n", big, "line 29999"),
        ("a refusal", "```twice\nfirst\n", "second\n".to_owned(), "second"),
    ] {
        let fences = Fences::open(config.clone(), None);
        let app = &fences.pipe.harness.app;
        fences.pipe.scripts().tamper(Tamper::Hold);
        fences.answer(first);
        app.wait_until(Duration::from_millis(300), || {
            fences.now();
            false
        });
        fences.more(&then);
        for _ in 0..20 {
            fences.now();
        }
        fences.pipe.scripts().replay();
        for _ in 0..40 {
            fences.now();
        }
        assert_eq!(fences.in_flight(), Some(false), "{case}: the JS host holds a part in flight");
        let screen = fences.now();
        assert!(screen.contains(shown) && drawn() == 0, "{case}: the part did not fall back:\n{screen}");
        let crashed = fences.toasts().into_iter().filter(|toast| toast.contains("crashed")).count();
        assert_eq!(crashed, usize::from(case == "a throw"), "{case}: the renderer ran again");
        assert_eq!(fences.status(), Some(opencode_plugin::Status::Active), "{case}");
    }
}

#[test]
fn a_js_host_that_never_answers_leaves_every_fence_as_code() {
    let Some(mut config) = config() else { return };
    config.limits.ack = Duration::from_millis(500);
    let fences = Fences::open(config, None);
    fences.answer("```probe\nfirst\n```\n\n");
    let screen = fences.settled();
    assert!(screen.contains("| probe"), "{screen}");
    fences.more("```hang\nstuck\n```\n\nAfter.\n");
    let app = &fences.pipe.harness.app;
    let failed = app.wait_until(Duration::from_secs(20), || {
        app.advance(Duration::from_millis(5));
        app.render();
        matches!(fences.status(), Some(opencode_plugin::Status::Failed(_)))
    });
    let screen = fences.now();
    assert!(failed, "the plugin never failed: {:?}\n{screen}", fences.status());
    assert!(screen.contains("first") && screen.contains("stuck") && !screen.contains("| probe"), "{screen}");
    assert_eq!(drawn(), 0, "{:?}", mounted());
}

#[test]
fn a_tree_of_an_ended_mount_is_dropped_after_a_rebuild_or_a_disable() {
    let Some(config) = config() else { return };
    let fences = Fences::open(config, None);
    let tui = &fences.pipe.harness.tui;
    let held = || {
        let app = &fences.pipe.harness.app;
        app.wait_until(Duration::from_millis(300), || {
            fences.now();
            false
        });
    };
    fences.pipe.scripts().tamper(Tamper::Hold);
    fences.answer("```probe\nlet a = 1;\n```\n\nAfter.\n");
    held();
    hold_came(&fences);
    let first: Vec<_> = mounted().into_iter().map(|shown| shown.id).collect();
    tui.theme.borrow_mut().set("tokyonight");
    tui.theme_changed();
    held();
    let dropped = opencode_plugin::pipe::crossed().dropped;
    fences.pipe.scripts().replay();
    let screen = fences.settled();
    let now: Vec<_> = mounted().into_iter().map(|shown| shown.id).collect();
    assert!(now.len() == 1 && first.len() == 1 && now != first, "{first:?} {now:?}");
    assert_eq!(opencode_plugin::pipe::crossed().dropped, dropped + 1, "the old mount's tree was not dropped");
    // Each render numbers its label: the first, the old mount's, never shows.
    assert!(screen.contains("| probe") && !screen.contains("(1)") && drawn() == 1, "{screen}");
    // The plugin is disabled while its next tree is in flight.
    fences.pipe.scripts().tamper(Tamper::Hold);
    fences.answer("```probe\nlet b = 2;\n```\n\nAfter.\n");
    held();
    hold_came(&fences);
    let host = opencode_tui::plugins::host::host(tui);
    assert_eq!(tui.plugins.toggle(&host, ID, false), Some(Ok(())));
    // As the manager does: the route mounts again without the plugin's renderers.
    tui.navigate(tui.route());
    held();
    fences.pipe.scripts().replay();
    let screen = fences.settled();
    assert!(screen.contains("let b = 2;") && !screen.contains("| probe"), "{screen}");
    assert_eq!(drawn(), 0, "{:?}", mounted());
}
