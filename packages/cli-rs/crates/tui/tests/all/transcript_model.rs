//! The transcript under random streams, page loads, moves, resizes and session switches, against a reference
//! transcript in which each paragraph shows one marker.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Fake, Harness, Log};

use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::generated::{SessionID, V2Event};
use opencode_local::cli_config::{Bounded, Info, Scroll};
use opencode_plugin::abi::v2::TranscriptView;
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    User,
    /// An assistant step that streams.
    Open,
    /// An assistant step that ended.
    Done,
}

/// A message by number, and the marker numbers of its paragraphs by part.
#[derive(Clone, Debug)]
struct Message {
    n: u64,
    kind: Kind,
    parts: Vec<Vec<u64>>,
}

fn id(n: u64) -> String {
    format!("msg_{n:04}")
}

fn marker(n: u64) -> String {
    format!("M{n:04}")
}

impl Message {
    fn json(&self) -> Value {
        let text = |part: &Vec<u64>| part.iter().map(|&n| marker(n)).collect::<Vec<_>>().join("\n\n");
        let (id, created) = (id(self.n), self.n * 1000);
        match self.kind {
            Kind::User => support::user(&id, created, &text(&self.parts[0])),
            kind => {
                let content: Vec<_> =
                    self.parts.iter().map(|part| json!({ "type": "text", "text": text(part) })).collect();
                let mut reply = json!({ "id": id, "type": "assistant", "agent": "build", "content": content,
                    "model": { "providerID": "provider", "id": "model" }, "time": { "created": created } });
                if kind == Kind::Done {
                    reply["time"]["completed"] = json!(created + 500);
                    reply["finish"] = json!("stop");
                }
                reply
            }
        }
    }
}

/// The session's messages, as the server holds them.
type Messages = Arc<Mutex<Vec<Message>>>;

fn markers_of(messages: &[Message]) -> Vec<String> {
    messages.iter().flat_map(|message| message.parts.iter().flatten().map(|&n| marker(n))).collect()
}

/// Serves the session `ses_m`, newest page first, with a cursor that counts the messages older than the page.
fn server(messages: Messages) -> Fake {
    Fake::new(move |seen| match seen.path.trim_start_matches("/api/session") {
        "" => (200, json!({ "data": [], "cursor": {} })),
        "/ses_m" => {
            (200, json!({ "data": support::merge(support::session("ses_m", "Model"), json!({ "agent": "build" })) }))
        }
        "/ses_m/message" => {
            let messages = messages.lock().unwrap();
            let end = seen.param("cursor").parse().map_or(messages.len(), |end: usize| end.min(messages.len()));
            let start = end.saturating_sub(seen.param("limit").parse().unwrap_or(20));
            let page: Vec<_> = messages[start..end].iter().rev().map(Message::json).collect();
            (200, json!({ "data": page, "cursor": { "next": (start > 0).then(|| start.to_string()) } }))
        }
        "/ses_m/permission" | "/ses_m/form" | "/ses_m/inbox" => (200, json!({ "data": [] })),
        _ => support::not_found(),
    })
}

#[derive(Clone, Debug)]
enum Command {
    /// The session opens with this many turns of history; only as the first command.
    Open(usize),
    User,
    Assistant,
    /// A paragraph streams onto the open step.
    Delta,
    /// The open step ends, which shows its footer.
    End,
    Wheel {
        up: bool,
        steps: u16,
    },
    /// A command of the keymap, or `latest`: a click on "Jump to latest".
    Do(&'static str),
    Resize(u16, u16),
    /// Home shows, then the session again.
    Away,
}

const MOVES: &str = "session.page.up session.page.down session.line.up session.line.down session.half.page.up \
    session.half.page.down session.first session.last session.message.next session.message.previous \
    session.message.user.next session.message.user.previous latest";

struct Transcripts;

impl Model for Transcripts {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let turns = [0, 1, 3, 12, 30, 60][rng.below(6)];
        let sizes = [(40, 12), (60, 16), (80, 24), (100, 30), (120, 20), (160, 40)];
        let commands = (0..steps).map(|_| match rng.below(100) {
            0..6 => Command::User,
            6..12 => Command::Assistant,
            12..28 => Command::Delta,
            28..34 => Command::End,
            34..60 => Command::Wheel { up: rng.below(3) > 0, steps: 1 + rng.below(30) as u16 },
            60..86 => Command::Do(MOVES.split_whitespace().nth(rng.below(13)).unwrap()),
            86..94 => {
                let (width, height) = *rng.pick(&sizes);
                Command::Resize(width, height)
            }
            _ => Command::Away,
        });
        std::iter::once(Command::Open(turns)).chain(commands).collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let mut walk = Walk::open(match commands.first() {
            Some(Command::Open(turns)) => *turns,
            _ => 0,
        });
        commands.iter().enumerate().find_map(|(step, command)| {
            let (site, detail) = walk.step(command).err()?;
            Some(Failure { property: "transcript", site, step, detail })
        })
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Open(turns) if *turns > 0 => vec![Command::Open(turns / 2)],
            Command::Wheel { up, steps } if *steps > 1 => vec![Command::Wheel { up: *up, steps: steps / 2 }],
            _ => Vec::new(),
        }
    }
}

thread_local! {
    static SEEN: RefCell<Option<TranscriptView>> = const { RefCell::new(None) };
}

fn reader(setup: &mut opencode_plugin::abi::Setup) -> Result<(), String> {
    setup.command(opencode_plugin::abi::Command::new("model.read"), |host, _| {
        SEEN.with(|seen| *seen.borrow_mut() = host.transcript());
    });
    Ok(())
}

/// What a frame shows: the markers with their rows, the "Jump to latest" hint, and the published geometry.
#[derive(Clone)]
struct Shown {
    markers: Vec<(String, usize)>,
    latest: bool,
    view: TranscriptView,
    screen: String,
}

impl Shown {
    fn at_tail(&self) -> bool {
        self.view.offset + self.view.viewport >= self.view.extent
    }

    fn row(&self, marker: &str) -> Option<usize> {
        self.markers.iter().find(|(shown, _)| shown == marker).map(|(_, row)| *row)
    }

    fn names(&self) -> Vec<&str> {
        self.markers.iter().map(|(marker, _)| marker.as_str()).collect()
    }
}

/// The markers on screen, an M and four digits, with their rows.
fn markers(screen: &str) -> Vec<(String, usize)> {
    let marked = |word: &str| word.len() == 5 && word.starts_with('M') && word[1..].bytes().all(|b| b.is_ascii_digit());
    screen
        .lines()
        .enumerate()
        .flat_map(|(row, line)| {
            line.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| marked(w)).map(move |w| (w.to_owned(), row))
        })
        .collect()
}

/// The message the last jump aligned, as far as the model knows it.
#[derive(Clone, Debug, PartialEq)]
enum Navigation {
    None,
    At(u64),
    /// A move the model does not follow may have kept or cleared it.
    Unknown,
}

struct Walk {
    harness: Harness,
    messages: Messages,
    log: Log,
    /// The next number, for a message, a marker or an event.
    next: u64,
    navigation: Navigation,
    /// The last explicit scroll left the view at the bottom, which OpenTUI's scroll box then follows.
    stuck: bool,
}

type Check = Result<(), (&'static str, String)>;

impl Walk {
    fn open(turns: usize) -> Self {
        let mut next = 1;
        let mut take = || {
            next += 1;
            next - 1
        };
        let mut messages = Vec::new();
        for turn in 0..turns {
            messages.push(Message { n: take(), kind: Kind::User, parts: vec![vec![take()]] });
            let n = take();
            let parts = (0..1 + turn % 3).map(|_| (0..1 + turn / 3 % 3).map(|_| take()).collect()).collect();
            messages.push(Message { n, kind: Kind::Done, parts });
        }
        let messages = Messages::new(Mutex::new(messages));
        let fake = server(messages.clone());
        let log = fake.log();
        let info = Info { scroll: Some(Scroll { speed: Some(Bounded(1.0)), ..Scroll::default() }), ..support::still() };
        let mut deps = Deps {
            config: support::config(info),
            route: support::session_route("ses_m"),
            ..support::deps(Arc::new(fake))
        };
        deps.builtins.push(opencode_plugin::abi::Plugin { id: "test.reader", setup: reader }.into());
        let harness = support::mount_still(80, 24, deps);
        Self { harness, messages, log, next, navigation: Navigation::None, stuck: true }
    }

    fn messages(&self) -> Vec<Message> {
        self.messages.lock().unwrap().clone()
    }

    fn edit(&self, change: impl FnOnce(&mut Vec<Message>)) {
        change(&mut self.messages.lock().unwrap());
    }

    fn take(&mut self) -> u64 {
        self.next += 1;
        self.next - 1
    }

    /// Applies event `kind` about message `n`.
    fn event(&mut self, kind: &str, n: u64, data: Value) {
        let seq = self.take();
        let event: V2Event = serde_json::from_value(json!({
            "id": format!("evt_{seq}"), "created": n * 1000, "type": kind, "data": data,
            "durable": { "aggregateID": "ses_m", "seq": seq, "version": 1 },
        }))
        .unwrap();
        self.harness.tui.data.apply(&[event]);
    }

    /// Runs the app until no read is answered, the store's flushes reached the views, and the frame stops changing;
    /// what it shows of the transcript, if one shows.
    fn settle(&self) -> Result<Option<Shown>, (&'static str, String)> {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        let session = SessionID("ses_m".into());
        let (mut last, mut stable, mut answered) = (String::new(), 0, usize::MAX);
        for _ in 0..3000 {
            app.advance(Duration::from_millis(1));
            let screen = app.render().text();
            let requests = self.log.lock().unwrap().len();
            let loading = tui.data.read(|state| state.messages_loading(&session))
                || !tui.synced()
                || std::mem::replace(&mut answered, requests) != requests;
            stable = if !loading && !app.needs_frame() && screen == last { stable + 1 } else { 0 };
            if stable == 3 {
                tui.keymap.dispatch("model.read", None);
                let Some(view) = SEEN.with(|seen| seen.borrow_mut().take()) else { return Ok(None) };
                let latest = screen.contains("Jump to latest");
                return Ok(Some(Shown { markers: markers(&screen), latest, view, screen }));
            }
            if loading {
                std::thread::sleep(Duration::from_millis(1));
            }
            last = screen;
        }
        Err(("settle", format!("the frame never settled:\n{last}")))
    }

    fn shown(&self) -> Result<Shown, (&'static str, String)> {
        Ok(self.settle()?.expect("the transcript is published"))
    }

    /// The last message when it is an open step.
    fn open_step(&self) -> Option<Message> {
        self.messages().pop().filter(|last| last.kind == Kind::Open)
    }

    /// Runs `command` on the TUI and the model; whether it added rows at the end.
    fn apply(&mut self, command: &Command) -> Result<bool, (&'static str, String)> {
        let sid = "ses_m";
        match command {
            Command::User => {
                let (n, m) = (self.take(), self.take());
                self.edit(|messages| messages.push(Message { n, kind: Kind::User, parts: vec![vec![m]] }));
                let item = json!({ "type": "user", "delivery": "steer", "payload": { "text": marker(m) } });
                self.event("session.inbox.enqueued", n, json!({ "sessionID": sid, "inboxID": id(n), "item": item }));
                self.event("session.inbox.delivered", n, json!({ "sessionID": sid, "inboxID": id(n) }));
            }
            Command::Assistant => {
                let (n, m) = (self.take(), self.take());
                self.edit(|messages| {
                    for message in messages.iter_mut().filter(|message| message.kind == Kind::Open) {
                        message.kind = Kind::Done;
                    }
                    messages.push(Message { n, kind: Kind::Open, parts: vec![vec![m]] })
                });
                let step = json!({ "sessionID": sid, "assistantMessageID": id(n), "ordinal": 0 });
                let model = json!({ "providerID": "provider", "id": "model" });
                let started = json!({ "agent": "build", "model": model, "started": n * 1000 });
                self.event("session.step.started", n, support::merge(step.clone(), started));
                self.event("session.text.started", n, step.clone());
                self.event("session.text.delta", n, support::merge(step, json!({ "delta": marker(m) })));
            }
            Command::Delta if let Some(step) = self.open_step() => {
                let m = self.take();
                self.edit(|messages| messages.last_mut().unwrap().parts[0].push(m));
                let delta = format!("\n\n{}", marker(m));
                let data = json!({ "sessionID": sid, "assistantMessageID": id(step.n), "ordinal": 0, "delta": delta });
                self.event("session.text.delta", step.n, data);
            }
            Command::End if let Some(step) = self.open_step() => {
                self.edit(|messages| messages.last_mut().unwrap().kind = Kind::Done);
                let tokens = json!({ "input": 10, "output": 20, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
                let data = json!({ "sessionID": sid, "assistantMessageID": id(step.n), "finish": "stop", "cost": 0, "tokens": tokens });
                self.event("session.step.ended", step.n, data);
            }
            Command::Wheel { up, steps } => (0..*steps).for_each(|_| self.harness.app.scroll(10, 3, !up)),
            Command::Do("latest") => {
                if let Some((x, y)) = support::at(&self.harness.app.text(), "Jump to latest") {
                    self.harness.app.click(x + 2, y);
                }
            }
            Command::Do(command) => drop(self.harness.tui.keymap.dispatch(command, None)),
            Command::Resize(width, height) => self.harness.app.resize(*width, *height),
            Command::Away => {
                self.harness.tui.navigate(Route::Home);
                self.settle()?;
                self.harness.tui.show_session(SessionID("ses_m".into()));
            }
            _ => return Ok(false),
        }
        Ok(matches!(command, Command::User | Command::Assistant | Command::Delta | Command::End))
    }

    fn step(&mut self, command: &Command) -> Check {
        let log = self.log.clone();
        let older = move || log.lock().unwrap().iter().filter(|seen| !seen.param("cursor").is_empty()).count();
        let before = self.shown()?;
        let read = older();
        let following = self.stuck && self.navigation == Navigation::None && before.at_tail() && !before.latest;
        // OpenTUI's scroll box also follows from one row short of the bottom, a program scroll that lands at the bottom
        // follows it again, and one that does not follow can still sit there: such a view may follow or hold.
        let resting = before.at_tail() && !before.latest && self.navigation == Navigation::None;
        let either = !following && (resting || self.stuck && !matches!(self.navigation, Navigation::At(_)));
        let added = !matches!(command, Command::Open(_)) && self.apply(command)?;
        let after = self.shown()?;
        let messages = self.messages();
        let all = markers_of(&messages);
        let fail = |site, detail: String| {
            Err((site, format!("{detail}\nbefore:\n{}\nafter:\n{}", before.screen, after.screen)))
        };
        window(&all, &after).or_else(|detail| fail("window", detail))?;
        let latest = after.names().last().copied() == all.last().map(String::as_str);
        let tail =
            || if after.at_tail() && latest && !after.latest { Ok(()) } else { fail("tail", "not at the tail".into()) };
        let jump = matches!(command, Command::Do(name) if name.contains("message"));
        match command {
            Command::Open(_) => tail()?,
            _ if added && following => tail()?,
            _ if added && !either => {
                if let Some((marker, row)) = before.markers.iter().find(|(marker, row)| after.row(marker) != Some(*row))
                {
                    return fail("held", format!("{marker} left row {row}"));
                }
            }
            Command::Resize(..) | Command::Away if following => tail()?,
            Command::Wheel { up: false, .. } if following => tail()?,
            Command::Wheel { up, steps } => {
                rigid(&before, &after, *up, Some(f64::from(*steps))).or_else(|detail| fail("rigid", detail))?
            }
            Command::Do("session.last") => tail()?,
            Command::Do("latest") if before.latest => tail()?,
            Command::Do("latest") => {}
            // It loads every older page in one read.
            Command::Do("session.first") if after.view.offset != 0 || older() > read + 1 => {
                return fail("first", "not at the top in one read".into());
            }
            Command::Do("session.first") => {}
            Command::Do(name) if jump => {
                self.jump(name, &messages, &before, &after).or_else(|detail| fail("jump", detail))?
            }
            Command::Do(name) => {
                let up = name.ends_with(".up");
                // A line, half a page and a page: one row, a quarter and half of the view. A move drops a jump's slack
                // first, so from past the rows' end it goes further.
                let view = f64::from(before.view.viewport);
                let rows = [(".line.", 1.0), (".half.", view / 4.0), ("", view / 2.0)]
                    .into_iter()
                    .find(|(kind, _)| name.contains(kind));
                if self.navigation == Navigation::None {
                    rigid(&before, &after, up, rows.map(|(_, rows)| rows)).or_else(|detail| fail("rigid", detail))?;
                }
            }
            Command::Away if !after.latest && before.names() != after.names() => {
                return fail("restore", "the rows changed".into());
            }
            _ => {}
        }
        // An explicit scroll leaves the view following when it reached the bottom or the range is at most one row.
        let reached = after.at_tail() || after.view.extent - after.view.viewport <= 1;
        match command {
            Command::Do(_) if jump && before.view.offset == after.view.offset => {}
            Command::Do("latest") if !before.latest => {}
            Command::Wheel { .. } | Command::Do(_) => self.stuck = reached,
            Command::Away if !following => self.stuck = reached,
            _ => {}
        }
        match command {
            Command::Do(name) if !jump => self.navigation = Navigation::None,
            Command::Resize(..) => self.navigation = Navigation::None,
            // A new view's restored row may have slack under it.
            Command::Away if self.navigation != Navigation::None || after.latest => {
                self.navigation = Navigation::Unknown
            }
            _ => {}
        }
        // "Jump to latest" shows exactly away from the latest rows, or while a jump or its slack holds the view.
        if self.navigation == Navigation::None && after.at_tail() && latest && after.latest {
            return fail("hint", "the hint shows at the latest rows".into());
        }
        if !after.at_tail() && !after.latest {
            return fail("hint", "no hint away from the bottom".into());
        }
        if !after.latest {
            self.navigation = Navigation::None;
        }
        Ok(())
    }

    /// A jump from the one before lands its target's first row at the top.
    fn jump(&mut self, name: &str, messages: &[Message], before: &Shown, after: &Shown) -> Result<(), String> {
        let users = name.contains(".user.");
        let stops: Vec<&Message> = messages.iter().filter(|message| !users || message.kind == Kind::User).collect();
        let first = |message: &Message| marker(message.parts[0][0]);
        let from = match self.navigation {
            Navigation::At(n) => stops.iter().position(|message| message.n == n),
            _ => None,
        };
        let Some(from) = from else {
            // From the view's top: what it lands on, when it moved.
            let landed = after.names().first().and_then(|top| stops.iter().find(|message| first(message) == *top));
            if before.screen != after.screen || landed.is_some() {
                self.navigation = landed
                    .filter(|_| before.screen != after.screen)
                    .map_or(Navigation::Unknown, |message| Navigation::At(message.n));
            }
            return Ok(());
        };
        let target = if name.ends_with("next") {
            stops.get(from + 1)
        } else {
            from.checked_sub(1).and_then(|index| stops.get(index))
        };
        let Some(target) = target else { return Ok(()) };
        // Under the title, a user message's border or the blank row above a reply.
        if after.row(&first(target)) != Some(2) {
            return Err(format!("{} is not at the top", first(target)));
        }
        self.navigation = Navigation::At(target.n);
        Ok(())
    }
}

/// The markers on screen are a gapless run of the model's.
fn window(all: &[String], shown: &Shown) -> Result<(), String> {
    let names = shown.names();
    let Some(first) = names.first() else { return Ok(()) };
    let start = all.iter().position(|marker| marker == first).ok_or(format!("{first} is not in the model"))?;
    let expected: Vec<&str> = all[start..].iter().take(names.len()).map(String::as_str).collect();
    if expected != names {
        return Err(format!("shown {names:?}, the model {expected:?}"));
    }
    Ok(())
}

/// A move shifts every row on screen by `rows`, unless an end stops it.
fn rigid(before: &Shown, after: &Shown, up: bool, rows: Option<f64>) -> Result<(), String> {
    let offset = f64::from(before.view.offset);
    let Some(target) = rows.map(|rows| if up { offset - rows } else { offset + rows }.round()) else { return Ok(()) };
    if !(0.0..=f64::from(before.view.extent - before.view.viewport)).contains(&target) {
        return Ok(());
    }
    // Under the title row, a marker that stays in view is where the move puts it.
    let shift = (offset - target) as i64;
    let moved = before.markers.iter().find(|(marker, row)| {
        let want = *row as i64 + shift;
        (1..i64::from(before.view.viewport)).contains(&want) && after.row(marker) != Some(want as usize)
    });
    match moved {
        Some((marker, row)) => Err(format!("{marker} moved from row {row}, not by {shift}")),
        None => Ok(()),
    }
}

#[test]
fn any_walk_shows_a_window_of_the_transcript() {
    model::check(&Transcripts, 4, 24);
}

/// Shrunk walks of the defects the model found: a resize ends a jump, a jump in rows that fit lands at the top, and
/// new rows keep a view a jump holds.
#[test]
fn the_found_walks_pass() {
    use Command::*;
    let walks: [&[Command]; 5] = [
        &[User, Do("session.message.user.next"), Resize(160, 40), Wheel { up: false, steps: 1 }],
        &[Open(6), Resize(160, 40), Do("session.messages_last_user"), Wheel { up: true, steps: 1 }, Resize(60, 16)],
        &[Open(1), Do("session.message.next"), User, Do("session.message.next")],
        &[Open(30), Do("session.message.user.next"), Wheel { up: false, steps: 1 }, User],
        &[Open(11), Do("session.message.user.next"), User],
    ];
    for walk in walks {
        assert_eq!(Transcripts.run(walk), None, "{walk:?}");
    }
}
