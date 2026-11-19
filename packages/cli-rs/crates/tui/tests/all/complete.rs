//! Exercise completion through key bindings, submitted parts, and persisted recents.

use crate::support::{self, DIRECTORY, Fake, Harness, Log, WAIT, deref_harness, list};

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use opencode_tui::Deps;
use opencode_ui::path::Flavor;
use opencode_ui::prompt_input::parse::file_url;
use serde_json::{Value, json};

fn fake() -> Fake {
    Fake::new(|seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/agent") => (
            200,
            list(
                DIRECTORY,
                json!([
                    support::agent("build", "primary", false),
                    support::agent("general", "subagent", false),
                    support::agent("explore", "all", false),
                    support::agent("secret", "subagent", true),
                ]),
            ),
        ),
        ("GET", "/api/command") => {
            (200, list(DIRECTORY, json!([{ "name": "review", "description": "Review changes" }])))
        }
        ("GET", "/api/skill") => (
            200,
            list(
                DIRECTORY,
                json!([{
                    "id": "release-notes", "name": "release-notes", "description": "Write release notes.",
                    "path": "/skills/release-notes/SKILL.md", "content": "",
                }]),
            ),
        ),
        ("GET", "/api/reference") => (
            200,
            list(
                DIRECTORY,
                json!([
                    { "name": "docs", "path": "/refs/docs", "source": { "type": "local", "path": "/refs/docs" } },
                    { "name": "hidden", "path": "/refs/h", "hidden": true, "source": { "type": "local", "path": "/refs/h" } },
                ]),
            ),
        ),
        ("GET", "/api/fs/find") => (
            200,
            list(DIRECTORY, json!([{ "path": "src/main.rs", "type": "file" }, { "path": "src", "type": "directory" }])),
        ),
        // The location's directory lists as it is; a subdirectory is `path.resolve`d, `D:\project\packages` on
        // Windows.
        ("GET", "/api/fs/list") => {
            let path = seen.param("path");
            let entries = match path.as_str() {
                "/project" => json!([
                    { "path": "packages", "type": "directory" }, { "path": ".git", "type": "directory" },
                    { "path": "README.md", "type": "file" },
                ]),
                path if path == Flavor::NATIVE.resolve(&["/project/packages"]) => json!([
                    { "path": "packages/tui", "type": "directory" }, { "path": "packages/cli", "type": "directory" },
                ]),
                _ => json!([]),
            };
            (200, list(DIRECTORY, entries))
        }
        ("GET", "/api/vcs") => (200, list(DIRECTORY, json!({ "branch": { "current": "main", "default": "main" } }))),
        ("POST", path) if path.ends_with("/prompt") => {
            (200, support::prompted(seen, seen.body["delivery"].as_str().unwrap_or("steer")))
        }
        ("POST", path) if path.ends_with("/command") || path.ends_with("/move") => (204, Value::Null),
        _ => support::base(seen, DIRECTORY),
    })
}

struct Setup {
    harness: Harness,
    seen: Log,
    home: opencode_util::temp::TempDir,
}

deref_harness!(Setup);

impl Setup {
    fn new() -> Self {
        Self::with_home(opencode_util::temp::tempdir().unwrap())
    }

    fn with_home(home: opencode_util::temp::TempDir) -> Self {
        let fake = fake();
        let seen = fake.log();
        let deps =
            Deps { roots: support::roots(support::paths(home.path()), "latest"), ..support::deps(Arc::new(fake)) };
        let setup = Self { harness: support::mount(90, 30, deps), seen, home };
        setup.wait_for("Model M");
        setup
    }

    fn requests(&self, method: &str, suffix: &str) -> Vec<(String, Value)> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|seen| seen.method == method && seen.path.ends_with(suffix))
            .map(|seen| (seen.query.clone(), seen.body.clone()))
            .collect()
    }

    fn wait_request(&self, method: &str, suffix: &str, count: usize) -> Vec<(String, Value)> {
        let found = self.app.wait_until(WAIT, || self.requests(method, suffix).len() >= count);
        assert!(found, "no {method} …{suffix}: {:?}\n{}", self.seen.lock().unwrap(), self.app.text());
        self.requests(method, suffix)
    }

    fn state_file(&self, name: &str) -> String {
        std::fs::read_to_string(self.home.path().join("state").join(name)).unwrap_or_default()
    }

    fn wait_file(&self, name: &str, text: &str) -> String {
        let found = self.app.wait_until(WAIT, || self.state_file(name).contains(text));
        assert!(found, "{name} has {:?}\n{}", self.state_file(name), self.app.text());
        self.state_file(name)
    }
}
#[test]
fn slash_lists_commands_and_enter_runs_one_without_arguments() {
    let setup = Setup::new();
    setup.app.type_text("/");
    let screen = setup.wait_for("/agents");
    for row in ["/btw", "/cd", "/compact", "Change working directory"] {
        assert!(screen.contains(row), "{row:?} missing:\n{screen}");
    }
    setup.app.type_text("re");
    setup.wait_for("Review changes");
    for _ in 0..2 {
        setup.app.press("backspace");
    }
    setup.app.type_text("sessions");
    setup.wait_gone("/agents");
    setup.app.press("return");
    setup.wait_for("Fix the parser");
    assert_eq!(setup.text(), "");
    assert!(setup.requests("POST", "/prompt").is_empty());
}

/// Commands absent from this fixture's session route.
const SLASH_ELSEWHERE: &[&str] = &["restart", "update", "highlights", "redo", "terminal"];

// Compare registered slash names and aliases with their declarations in the reference client.
#[test]
fn slash_names_and_aliases_match_the_typescript_sources() {
    let tui = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tui/src");
    let mut expected: Vec<String> = typescript_slashes(&tui);
    expected.sort();
    let setup = Setup::new();
    let mut actual: Vec<String> = setup
        .tui
        .data
        .read(|_| setup.tui.keymap.commands())
        .into_iter()
        .filter_map(|command| {
            let slash = command.slash?;
            let mut aliases = slash.aliases.clone();
            aliases.sort();
            Some(format!("{} /{} {aliases:?}", command.id, slash.name))
        })
        .collect();
    actual.sort();
    actual.dedup();
    let missing: Vec<_> = expected
        .iter()
        .filter(|entry| !actual.contains(entry))
        .filter(|entry| !SLASH_ELSEWHERE.iter().any(|name| entry.contains(&format!(" /{name} "))))
        .collect();
    let extra: Vec<_> = actual.iter().filter(|entry| !expected.contains(entry)).collect();
    assert!(missing.is_empty() && extra.is_empty(), "TypeScript only: {missing:#?}\nRust only: {extra:#?}");
}

/// Find command IDs and aliases in slash declarations, ignoring lines outside each declaration.
fn typescript_slashes(dir: &Path) -> Vec<String> {
    let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().path()).collect();
    entries.sort();
    entries
        .into_iter()
        .flat_map(|path| {
            if path.is_dir() {
                return typescript_slashes(&path);
            }
            if !path.extension().is_some_and(|extension| extension == "ts" || extension == "tsx") {
                return Vec::new();
            }
            let text = std::fs::read_to_string(&path).unwrap();
            text.match_indices("slash: {")
                .map(|(at, _)| {
                    let block = &text[at..at + text[at..].find('}').unwrap()];
                    let name = quoted_after(block, "name: ").unwrap();
                    let mut aliases: Vec<String> = block
                        .find("aliases: [")
                        .map(|start| {
                            let list = &block[start + "aliases: [".len()..];
                            list[..list.find(']').unwrap()].split('"').skip(1).step_by(2).map(str::to_owned).collect()
                        })
                        .unwrap_or_default();
                    aliases.sort();
                    let before = &text[..at];
                    let id = ["id: \"", "name: \""]
                        .iter()
                        .filter_map(|key| before.rfind(key).map(|start| start + key.len() - 1))
                        .max()
                        .and_then(|start| quoted_after(&before[start..], ""))
                        .unwrap();
                    format!("{id} /{name} {aliases:?}")
                })
                .collect()
        })
        .collect()
}

fn quoted_after(text: &str, key: &str) -> Option<String> {
    let rest = &text[text.find(key)? + key.len()..];
    let rest = &rest[rest.find('"')? + 1..];
    Some(rest[..rest.find('"')?].to_owned())
}

#[test]
fn server_commands_complete_then_send_and_can_be_queued() {
    let setup = Setup::new();
    setup.app.type_text("/rev");
    setup.wait_for("Review changes");
    setup.app.press("return");
    assert_eq!(setup.text(), "/review ");
    setup.wait_gone("Review changes");
    setup.app.type_text("now");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/command", 1);
    assert_eq!(sent[0].1["name"], "review");
    assert_eq!(sent[0].1["text"], "now");
    assert_eq!(sent[0].1["delivery"], "steer");

    // `prompt.queue` (<leader>return) on an open list completes the server command first.
    setup.app.type_text("/rev");
    setup.wait_for("Review changes");
    setup.app.press("ctrl+x");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/command", 2);
    assert_eq!(sent[1].1["name"], "review");
    assert_eq!(sent[1].1["delivery"], "queue");
}

#[test]
fn agent_mentions_are_one_unit_and_are_sent_as_parts() {
    let setup = Setup::new();
    setup.app.type_text("ask @");
    let screen = setup.wait_for("@general");
    assert!(screen.contains("@explore"), "{screen}");
    assert!(!screen.contains("@build") && !screen.contains("@secret"), "{screen}");
    setup.app.type_text("gen");
    setup.wait_gone("@explore");
    setup.app.press("return");
    assert_eq!(setup.text(), "ask @general ");
    let marks = setup.textarea().extmarks();
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].start, marks[0].end), (4, 12));
    assert!(marks[0].options.atomic && marks[0].options.style.is_some());
    setup.app.press("backspace");
    setup.app.press("backspace");
    assert_eq!(setup.text(), "ask ");
    assert!(setup.textarea().extmarks().is_empty());

    // Tab picks too; the part moves with the text typed before it.
    setup.app.type_text("@gen");
    setup.wait_for("@general");
    setup.app.press("tab");
    setup.app.type_text("now");
    setup.app.press("ctrl+a");
    setup.app.type_text("please ");
    setup.app.press("ctrl+e");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(sent[0].1["text"], "please ask @general now");
    assert_eq!(
        sent[0].1["agents"],
        json!([{ "name": "general", "mention": { "start": 11, "end": 19, "text": "@general" } }])
    );
    assert_eq!(sent[0].1["files"], json!([]));

    setup.app.press("up");
    assert_eq!(setup.text(), "please ask @general now");
    let marks = setup.textarea().extmarks();
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].start, marks[0].end), (11, 19));
}

#[test]
fn a_theme_switch_restyles_mentions_and_the_popup_in_place() {
    support::assert_restyles_in_place(
        Setup::new,
        |setup| {
            setup.app.type_text("ask @gen");
            setup.wait_for("@general");
            setup.app.press("return");
            setup.app.type_text("and @ex");
        },
        |screen| screen.contains("@explore") && screen.contains("ask @general and @ex"),
    );
}

#[test]
fn a_mention_keeps_its_part_through_a_theme_switch() {
    let setup = Setup::new();
    setup.app.type_text("ask @gen");
    setup.wait_for("@general");
    setup.app.press("return");
    let before = setup.textarea().extmarks()[0];
    assert!(setup.tui.theme.borrow_mut().set("tokyonight"));
    setup.tui.theme_changed();
    let after = setup.textarea().extmarks();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].range(), before.range());
    assert!(after[0].options.atomic);
    let style = opencode_ui::code::syntax_theme(&setup.tui.page()).get("extmark.agent");
    assert_eq!(after[0].options.style, style);
    assert_ne!(after[0].options.style, before.options.style);
    setup.app.type_text("now");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(sent[0].1["text"], "ask @general now");
    assert_eq!(
        sent[0].1["agents"],
        json!([{ "name": "general", "mention": { "start": 4, "end": 12, "text": "@general" } }])
    );
}

// Undo restores the mention and its attachment (#63989's `rebindChip`).
#[test]
fn undo_brings_a_mention_back_with_its_attachment() {
    let setup = Setup::new();
    setup.app.type_text("ask @gen");
    setup.wait_for("@general");
    setup.app.press("return");
    let mark = setup.textarea().extmarks()[0];
    setup.app.press("backspace");
    setup.app.press("backspace");
    assert_eq!(setup.text(), "ask ");
    setup.app.press("super+z");
    assert_eq!(setup.text(), "ask @general");
    assert_eq!(setup.textarea().extmarks(), [mark]);
    // The space too, which closes the completion the restored mention opened.
    setup.app.press("super+z");
    assert_eq!(setup.text(), "ask @general ");
    setup.wait_gone("@explore");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(sent[0].1["text"], "ask @general ");
    assert_eq!(
        sent[0].1["agents"],
        json!([{ "name": "general", "mention": { "start": 4, "end": 12, "text": "@general" } }])
    );
}

#[test]
fn file_mentions_search_record_frecency_and_carry_line_ranges() {
    let setup = Setup::new();
    setup.app.type_text("@ma");
    setup.wait_for("src/main.rs");
    // `m`'s results can show before the search for `ma` goes out.
    let searched = setup.app.wait_until(WAIT, || {
        setup
            .requests("GET", "/api/fs/find")
            .iter()
            .any(|(query, _)| query.contains("query=ma") && query.contains("limit=20"))
    });
    assert!(searched, "{:?}", setup.requests("GET", "/api/fs/find"));
    setup.app.press("return");
    assert_eq!(setup.text(), "@src/main.rs ");
    // `path.resolve(cwd, path)`: `D:\project\src\main.rs` on Windows, with the working directory's drive.
    let main = Flavor::NATIVE.resolve(&[DIRECTORY, "src/main.rs"]);
    let frecency = setup.wait_file("frecency.jsonl", &serde_json::to_string(&main).unwrap());
    let line: Value = serde_json::from_str(frecency.lines().next().unwrap()).unwrap();
    assert_eq!(line["path"], main);
    assert_eq!(line["frequency"], 1);

    setup.app.type_text("@src/main.rs#3-5");
    // The list's row, not the typed text: until the search for it lands, Enter picks `#3`.
    setup.wait_for("┃ src/main.rs#3-5 ");
    setup.app.press("return");
    setup.app.type_text("fix");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(sent[0].1["text"], "@src/main.rs @src/main.rs#3-5 fix");
    assert_eq!(
        sent[0].1["files"],
        json!([
            { "uri": file_url(Flavor::NATIVE, &main), "name": "src/main.rs",
              "mention": { "start": 0, "end": 12, "text": "@src/main.rs" } },
            { "uri": format!("{}?start=3&end=5", file_url(Flavor::NATIVE, &main)), "name": "src/main.rs#3-5",
              "mention": { "start": 13, "end": 29, "text": "@src/main.rs#3-5" } },
        ])
    );
}

#[test]
fn skills_and_references_are_listed_and_sent() {
    let setup = Setup::new();
    setup.app.type_text("@");
    let rows = ["@release-notes", "Write release notes.", "@docs", "/refs/docs", "skill", "reference", "agent"];
    let listed = setup.app.wait_until(WAIT, || {
        let screen = setup.app.text();
        rows.iter().all(|row| screen.contains(row))
    });
    let screen = setup.app.text();
    assert!(listed, "{rows:?} missing:\n{screen}");
    assert!(!screen.contains("@hidden"), "{screen}");
    let finds = setup.requests("GET", "/api/fs/find").len();
    setup.app.type_text("docs");
    setup.wait_gone("@release-notes");
    setup.app.press("return");
    setup.app.type_text("@rel");
    setup.wait_for("@release-notes");
    setup.app.press("return");
    assert_eq!(setup.text(), "@docs @release-notes ");
    assert!(setup.requests("GET", "/api/fs/find").iter().all(|(query, _)| !query.contains("query=docs")), "{finds}");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(
        sent[0].1["files"],
        json!([{ "uri": file_url(Flavor::NATIVE, "/refs/docs"), "name": "docs",
                 "mention": { "start": 0, "end": 5, "text": "@docs" } }])
    );
    assert_eq!(
        sent[0].1["skills"],
        json!([{ "id": "release-notes", "mention": { "start": 6, "end": 20, "text": "@release-notes" } }])
    );
}

#[test]
fn cd_completes_directories_moves_the_session_and_keeps_recents() {
    let setup = Setup::new();
    setup.app.type_text("/cd ");
    let screen = setup.wait_for("packages/");
    assert!(!screen.contains(".git") && !screen.contains("README"), "{screen}");
    let lists = setup.wait_request("GET", "/api/fs/list", 1);
    assert!(lists[0].0.contains("path=%2Fproject"), "{lists:?}");
    // Tab opens the directory; Enter takes the first row (the typed directory itself).
    setup.app.press("tab");
    assert_eq!(setup.text(), "/cd packages/");
    setup.wait_for("packages/tui/");
    setup.app.press("down");
    setup.app.press("return");
    assert_eq!(setup.text(), "/cd packages/tui/");
    setup.wait_gone("packages/cli/");
    setup.app.press("return");
    let moves = setup.wait_request("POST", "/api/session/ses_a/move", 1);
    assert_eq!(moves[0].1["directory"], "packages/tui/");
    let tui = Flavor::NATIVE.resolve(&[DIRECTORY, "packages/tui/"]);
    let recents = setup.wait_file("latest/tui/directory-recents.json", &serde_json::to_string(&tui).unwrap());
    let recents: Value = serde_json::from_str(&recents).unwrap();
    assert_eq!(recents["projects"]["project"][0]["directory"], tui);

    // An empty argument lists recents first; Ctrl+D twice forgets one.
    setup.app.type_text("/cd ");
    setup.wait_for("recent");
    setup.app.press("ctrl+d");
    setup.wait_for("Press ctrl+d to confirm");
    setup.app.press("ctrl+d");
    setup.wait_gone("recent");
    setup.wait_file("latest/tui/directory-recents.json", "\"project\":[]");
}

#[test]
fn an_open_cd_picker_shows_the_recents_a_write_merges_back() {
    use opencode_local::lock;

    let home = opencode_util::temp::tempdir().unwrap();
    let state = home.path().join("state");
    std::fs::create_dir_all(state.join("latest/tui")).unwrap();
    std::fs::write(
        state.join("latest/tui/directory-recents.json"),
        r#"{"projects":{"project":[{"directory":"/legacy-dir","usedAt":1}]}}"#,
    )
    .unwrap();
    let acquire =
        |locks: &Path, file: &Path| lock::acquire(locks, &file.to_string_lossy(), &lock::Options::default()).unwrap();
    // The startup load waits on the frecency file first, so the touch runs before it reads the recents.
    let frecency = acquire(&state.join("locks"), &state.join("frecency.jsonl"));
    let setup = Setup::with_home(home);
    let recents = acquire(&state.join("latest/locks"), &state.join("latest/tui/directory-recents.json"));
    setup.tui.prompt.complete.touch(&setup.tui, "project", "/new-dir");
    frecency.release().unwrap();
    setup.app.type_text("/cd ");
    setup.wait_for("packages/");
    let screen = setup.wait_for("/new-dir");
    assert!(!screen.contains("/legacy-dir"), "{screen}");
    recents.release().unwrap();
    setup.wait("the merged recents show", || setup.tui.prompt.complete.recents("project").len() == 2);
    setup.wait_for("/legacy-dir");
}

#[test]
fn escape_hides_and_ctrl_c_dismisses_the_command() {
    let setup = Setup::new();
    setup.app.type_text("/xyz");
    setup.wait_for("No matching commands");
    setup.app.press("escape");
    setup.wait_gone("No matching commands");
    assert_eq!(setup.text(), "/xyz");
    setup.app.press("backspace");
    setup.wait_for("No matching commands");
    setup.app.press("ctrl+c");
    setup.wait_gone("No matching commands");
    assert_eq!(setup.text(), "");
    // Up wraps to the last command and scrolls to it; Down wraps back to the first.
    setup.app.type_text("/");
    setup.wait_for("/agents");
    setup.app.press("up");
    setup.wait_gone("/agents");
    assert!(setup.app.text().contains("/variants"), "{}", setup.app.text());
    setup.app.press("down");
    setup.wait_for("/agents");
}

#[test]
fn an_open_list_stays_open_when_the_route_mounts_again() {
    let setup = Setup::new();
    setup.app.type_text("/se");
    setup.wait_for("/sessions");
    setup.app.press("down");
    let before = setup.app.render().text();
    opencode_plugin::Host::remount(&*opencode_tui::plugins::host::host(&setup.tui));
    assert_eq!(setup.app.render().text(), before);
    setup.app.type_text("ssions");
    setup.wait_for("/sessions");
    setup.app.press("return");
    setup.wait_for("Fix the parser");
    assert_eq!(setup.text(), "");
}

#[test]
fn a_list_typed_before_a_remounted_composer_lays_out_shows_every_row() {
    let screen = |remount: bool| {
        let setup = Setup::new();
        setup.app.render();
        if remount {
            opencode_plugin::Host::remount(&*opencode_tui::plugins::host::host(&setup.tui));
        }
        setup.app.type_text("/se");
        setup.wait_for("Open settings");
        setup.app.render();
        setup.app.advance(Duration::from_millis(50));
        setup.app.render().text()
    };
    let twin = screen(false);
    assert!(twin.contains("/sessions") && twin.contains("/settings"), "{twin}");
    assert_eq!(screen(true), twin);
}

#[test]
fn the_replay_settles_a_list_typed_before_its_composer_laid_out() {
    let screen = |remount: bool| {
        let setup = Setup::new();
        setup.app.render();
        if remount {
            opencode_plugin::Host::remount(&*opencode_tui::plugins::host::host(&setup.tui));
        }
        setup.app.type_text("/se");
        setup.wait_for("Open settings");
        let settled = crate::app::settle(&setup.app, &|| 0, None, |_| true);
        (settled, setup.app.render().text())
    };
    let (twin, text) = screen(false);
    assert!(text.contains("/sessions") && text.contains("/settings"), "{text}");
    let (remounted, after) = screen(true);
    assert!(remounted == twin, "{after}\nthe twin:\n{text}");
}

#[test]
fn an_open_list_keeps_its_height_across_two_remounts_in_one_turn() {
    let setup = Setup::new();
    setup.app.type_text("/se");
    setup.wait_for("/sessions");
    setup.app.press("down");
    let before = setup.app.render().text();
    let host = opencode_tui::plugins::host::host(&setup.tui);
    opencode_plugin::Host::remount(&*host);
    opencode_plugin::Host::remount(&*host);
    assert_eq!(setup.app.render().text(), before);
}

#[test]
fn a_dialog_over_an_open_list_keeps_its_keys_across_a_remount() {
    let setup = Setup::new();
    let remount = || opencode_plugin::Host::remount(&*opencode_tui::plugins::host::host(&setup.tui));
    setup.app.type_text("/se");
    setup.wait_for("/sessions");
    for close in ["escape", "ctrl+c"] {
        setup.dispatch("plugins.list");
        setup.wait_for("show internal");
        remount();
        assert_eq!(setup.tui.keymap.mode(), "modal", "{close}");
        setup.app.press(close);
        assert!(!setup.tui.dialogs.is_open(), "{close} left the dialog open:\n{}", setup.app.text());
        assert!(!setup.app.app().is_quitting(), "{close} ended the client");
        setup.wait_for("/sessions");
        assert_eq!(setup.text(), "/se");
    }
}

#[test]
fn a_file_list_keeps_its_results_and_selection_across_a_remount() {
    let picked = |remount: bool| {
        let setup = Setup::new();
        setup.app.type_text("@ma");
        let searched = setup.app.wait_until(WAIT, || {
            setup.requests("GET", "/api/fs/find").iter().any(|(query, _)| query.contains("query=ma"))
        });
        assert!(searched, "{:?}", setup.requests("GET", "/api/fs/find"));
        setup.wait_for("src/main.rs");
        let searches = setup.requests("GET", "/api/fs/find").len();
        setup.app.press("down");
        if remount {
            opencode_plugin::Host::remount(&*opencode_tui::plugins::host::host(&setup.tui));
        }
        let again =
            setup.app.wait_until(Duration::from_millis(200), || setup.requests("GET", "/api/fs/find").len() > searches);
        assert!(!again, "searched again: {:?}", setup.requests("GET", "/api/fs/find"));
        setup.app.press("return");
        setup.text()
    };
    let twin = picked(false);
    assert_ne!(twin, "@src/main.rs ", "row 1 is another row than the first");
    assert_eq!(picked(true), twin);
}

fn mention_main(setup: &Setup) {
    setup.app.type_text("@ma");
    setup.wait_for("src/main.rs");
    setup.app.press("return");
    setup.app.press("ctrl+c");
}

#[test]
fn frecency_file_is_shared_with_typescript() {
    let Some(root) = support::ts_root() else { return };
    let setup = Setup::new();
    mention_main(&setup);
    mention_main(&setup);
    let rust = setup.wait_file("frecency.jsonl", "\"frequency\":2");
    assert_eq!(rust.lines().count(), 2, "{rust}");
    let state = setup.home.path().join("state");

    // The last frequency line for a path wins.
    let frequencies = support::solid_oracle(
        "E.3-frecency.ts",
        &root,
        &[&state, Path::new("/project")],
        &json!(["src/main.rs", "README.md"]),
    );
    assert_eq!(frequencies, json!({ "/project/src/main.rs": 3, "/project/README.md": 1 }));
    let typescript = std::fs::read_to_string(state.join("frecency.jsonl")).unwrap();
    assert_eq!(typescript.lines().next(), rust.lines().nth(1));
    assert_eq!(typescript.lines().count(), 3, "{typescript}");

    let home = opencode_util::temp::TempDir::new().unwrap();
    std::fs::create_dir_all(home.path().join("state")).unwrap();
    std::fs::copy(state.join("frecency.jsonl"), home.path().join("state/frecency.jsonl")).unwrap();
    let again = Setup::with_home(home);
    mention_main(&again);
    let written = again.wait_file("frecency.jsonl", "\"frequency\":4");
    let last: Value = serde_json::from_str(written.lines().last().unwrap()).unwrap();
    assert_eq!((last["path"].clone(), last["frequency"].clone()), (json!("/project/src/main.rs"), json!(4)));
    assert_eq!(written.lines().count(), 3, "{written}");
}
