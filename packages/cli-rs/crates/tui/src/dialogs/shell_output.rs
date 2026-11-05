//! Shell output dialog (E.13b, row DLG18): `packages/tui/src/component/dialog-shell-output.tsx`.
//!
//! The composer's Shell tab opens it for a running command. It polls the shell's info and output while it is open,
//! even after the command exits, so the last flush shows: the newest 64 KiB first, then each new page, one second
//! apart once it has caught up.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::{Client, RequestOptions};
use opencode_api::error::Error;
use opencode_api::generated::{
    LocationQueryInput, SessionMessageShellOutput, SessionMessageShellStatus, ShellGetInput, ShellInfo,
    ShellOutputInput,
};
use opencode_store::Location;
use opencode_ui::dialog::{DialogCx, DialogOptions, DialogSize, layout};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::keymap::Disposer;
use opentui::prelude::*;
use opentui::widget::ScrollEdge;

use crate::app::Tui;
use crate::routes::session::messages::shell::strip_ansi;

const PAGE_BYTES: i64 = 64 * 1024;
/// `Number.MAX_SAFE_INTEGER`: an output cursor past the end, which answers with the size alone.
const END: i64 = 9_007_199_254_740_991;

/// Opens the dialog for `shell`, read at `location` (where the shell list reported it).
pub fn show(tui: &Tui, shell: ShellInfo, location: Location) {
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| build(&weak, cx, shell, location),
        None,
        DialogOptions { size: DialogSize::XLarge, key: Some("shell-output".to_owned()) },
    );
    tui.dialogs.set_centered(true);
}

struct Poll {
    tui: Weak<Tui>,
    id: opencode_api::generated::ShellID,
    location: Location,
    info: RefCell<ShellInfo>,
    output: RefCell<Option<String>>,
    omitted: Cell<bool>,
    error: RefCell<String>,
    cursor: Cell<Option<i64>>,
    disposed: Cell<bool>,
    timer: Cell<Option<TimerId>>,
    status: Text,
    note: Text,
    text: Text,
    failure: Text,
}

/// What one load read: the info while the shell ran, the first cursor on the first load, and a page.
struct Loaded {
    info: Option<ShellInfo>,
    start: Option<i64>,
    page: SessionMessageShellOutput,
}

fn build(tui: &Weak<Tui>, cx: &Rc<DialogCx>, shell: ShellInfo, location: Location) -> View {
    let app = &cx.app;
    let theme = &cx.theme;
    let height = (i32::from(app.size().1) * 6 / 10 - 6).max(3) as u32;

    let status = Text::new(app, "").fg(theme.text.muted);
    let close = Text::new(app, "esc").fg(theme.text.muted).shrink(0.0);
    let dialogs = cx.dialogs.clone();
    close.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
        if matches!(event.kind, MouseEventKind::Up(_)) {
            dialogs.clear();
        }
    });
    let header = View::new(app)
        .row()
        .justify(Justify::SpaceBetween)
        .gap(if cx.width() < 60 { 1 } else { 2 })
        .child(&Text::new(app, "Shell output").fg(theme.text.base).bold().grow(1.0))
        .child(&status)
        .child(&close);

    let note = Text::new(app, "Earlier output omitted · showing recent output").fg(theme.text.muted).visible(false);
    let text = Text::new(app, "").fg(theme.text.base).wrap(WrapMode::Word);
    let scroll = ScrollBox::new(app).scrollbars(false).sticky(true).sticky_start(ScrollEdge::Bottom).height(height);
    scroll.add(&text);
    let failure = Text::new(app, "").fg(theme.text.feedback.error.base).visible(false);
    let body = View::new(app)
        .gap(1)
        .child(&Text::new(app, shell.command.clone()).fg(theme.text.muted).max_height(3).wrap(WrapMode::Word))
        .child(&note)
        .child(&scroll)
        .child(&failure);

    let page = f64::from(height);
    let scroll_command = |key: &str, title: &str, run: fn(&ScrollBox, f64)| {
        let scroll = scroll.clone();
        TuiCommand::inline(key, move |_, _| run(&scroll, page)).title(title).group("Shell")
    };
    cx.layer(KeymapLayer {
        commands: vec![
            scroll_command("up", "Scroll output up", |scroll, _| {
                scroll.scroll_by(0.0, -1.0);
            }),
            scroll_command("down", "Scroll output down", |scroll, _| {
                scroll.scroll_by(0.0, 1.0);
            }),
            scroll_command("pageup", "Previous output page", |scroll, page| {
                scroll.scroll_by(0.0, -page);
            }),
            scroll_command("pagedown", "Next output page", |scroll, page| {
                scroll.scroll_by(0.0, page);
            }),
            scroll_command("home", "First loaded output", |scroll, _| {
                scroll.scroll_to(0.0, 0.0);
            }),
            scroll_command("end", "Follow shell output", |scroll, _| {
                scroll.scroll_to_bottom();
            }),
        ],
        ..KeymapLayer::default()
    });

    let poll = Rc::new(Poll {
        tui: tui.clone(),
        id: shell.id.clone(),
        location,
        info: RefCell::new(shell),
        output: RefCell::new(None),
        omitted: Cell::new(false),
        error: RefCell::new(String::new()),
        cursor: Cell::new(None),
        disposed: Cell::new(false),
        timer: Cell::new(None),
        status,
        note,
        text,
        failure,
    });
    poll.render();
    let stop = poll.clone();
    let app_for_stop = app.clone();
    cx.on_close(Disposer::new(move || {
        stop.disposed.set(true);
        if let Some(timer) = stop.timer.take() {
            app_for_stop.cancel_timer(timer);
        }
    }));
    poll.poll();
    layout(cx, &header, &body, None)
}

impl Poll {
    /// Reads once, then schedules the next read: at once while pages remain, after a second once caught up, and never
    /// after the shell is gone.
    fn poll(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let client = tui.data.client().clone();
        let running = self.info.borrow().status == SessionMessageShellStatus::Running;
        let future = load(client, self.id.clone(), self.location.directory.clone(), running, self.cursor.get());
        let poll = self.clone();
        tui.app.spawn(future, move |cx, result| {
            if poll.disposed.get() {
                return;
            }
            let (more, missing) = match result {
                Ok(loaded) => (poll.apply(loaded), false),
                Err(error) => {
                    let missing = error.reason() == "ShellNotFoundError";
                    *poll.error.borrow_mut() = if missing {
                        "Shell output is no longer available.".to_owned()
                    } else {
                        "Unable to read shell output. Retrying…".to_owned()
                    };
                    (false, missing)
                }
            };
            poll.render();
            if missing {
                return;
            }
            let next = poll.clone();
            let delay = if more { Duration::ZERO } else { Duration::from_secs(1) };
            poll.timer.set(Some(cx.set_timeout(delay, move |_| next.poll())));
        });
    }

    /// Takes a load in; returns whether more output is waiting.
    fn apply(&self, loaded: Loaded) -> bool {
        if let Some(info) = loaded.info {
            *self.info.borrow_mut() = info;
        }
        if let Some(start) = loaded.start {
            self.omitted.set(start > 0);
        }
        self.cursor.set(Some(loaded.page.cursor));
        let mut output = self.output.borrow_mut();
        let mut next = output.take().unwrap_or_default();
        next.push_str(&loaded.page.output);
        let length = next.chars().count();
        if length > PAGE_BYTES as usize {
            self.omitted.set(true);
            next = next.chars().skip(length - PAGE_BYTES as usize).collect();
        }
        *output = Some(next);
        self.error.borrow_mut().clear();
        loaded.page.cursor < loaded.page.size
    }

    fn render(&self) {
        let info = self.info.borrow();
        let status = match &info.status {
            SessionMessageShellStatus::Running => "Running".to_owned(),
            SessionMessageShellStatus::Timeout => "Timed out".to_owned(),
            SessionMessageShellStatus::Killed => "Killed".to_owned(),
            _ => match info.exit {
                Some(code) => format!("Exited · code {code}"),
                None => "Exited".to_owned(),
            },
        };
        self.status.set_text(status);
        self.note.visible(self.omitted.get());
        let output = self.output.borrow();
        let text = strip_ansi(output.as_deref().unwrap_or_default()).replace("\r\n", "\n").replace('\r', "\n");
        self.text.set_text(if !text.is_empty() {
            text
        } else if output.is_none() {
            "Loading output…".to_owned()
        } else {
            "No captured output. Output redirected to files is not shown here.".to_owned()
        });
        let error = self.error.borrow();
        self.failure.set_text(error.as_str());
        self.failure.visible(!error.is_empty());
        if let Some(tui) = self.tui.upgrade() {
            tui.app.request_redraw();
        }
    }
}

async fn load(
    client: Client,
    id: opencode_api::generated::ShellID,
    directory: String,
    running: bool,
    cursor: Option<i64>,
) -> Result<Loaded, Error> {
    let options = RequestOptions::default();
    let location = || Some(LocationQueryInput { directory: Some(directory.clone()) });
    let info = match running {
        true => Some(client.shell_get(&ShellGetInput { id: id.clone(), location: location() }, &options).await?.data),
        false => None,
    };
    let (cursor, start) = match cursor {
        Some(cursor) => (cursor, None),
        None => {
            let head = client
                .shell_output(
                    &ShellOutputInput { id: id.clone(), location: location(), cursor: Some(END), limit: None },
                    &options,
                )
                .await?;
            let start = (head.data.size - PAGE_BYTES).max(0);
            (start, Some(start))
        }
    };
    let page = client
        .shell_output(
            &ShellOutputInput { id, location: location(), cursor: Some(cursor), limit: Some(PAGE_BYTES) },
            &options,
        )
        .await?
        .data;
    Ok(Loaded { info, start, page })
}
