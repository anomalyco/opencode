//! One terminal in the right pane: `component/terminal-pane.tsx`.
//!
//! The pane reads the terminal's snapshot, sizes the embedded terminal to the server's size, writes the snapshot's
//! checkpoint, then connects with `takeover` from the snapshot's output tail. Output, resizes, and the end of the
//! replay go through one queue in order, and wait while the embedded terminal is not yet at the server's size: a
//! resize carries a checkpoint of the screen at the new size. Input waits for the replay to end. The box's own size,
//! two columns narrower for the terminal's left offset and the scrollbar gutter, is what a controller asks the server
//! for: a size-only frame claims control and resizes the terminal.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use base64::Engine;
use opencode_api::client::RequestOptions;
use opencode_api::generated::{ExperimentalPersistentPtySnapshotInput, PtyID};
use opencode_api::pty::{self, ConnectInput, Incoming, Message, Role, Size};
use opencode_ui::bind;
use opentui::input::{KeyEvent, MouseEventKind};
use opentui::prelude::*;
use opentui::widget::{TerminalData, TerminalView};
use tokio::sync::mpsc;

use crate::app::Tui;

enum Item {
    Output(Vec<u8>),
    Resize { size: Size, checkpoint: Option<Vec<u8>> },
    Ready,
}

#[derive(Default)]
struct State {
    stream: VecDeque<Item>,
    pending_input: Vec<Vec<u8>>,
    attached: bool,
    controller: bool,
    restored: bool,
    wants_control: bool,
    exited: bool,
    /// The box's size less the offset and gutter.
    size: Option<Size>,
    /// The server's size, which the embedded terminal follows.
    canonical: Option<Size>,
    /// The embedded terminal's size.
    terminal_size: Option<Size>,
    /// The snapshot waiting for the embedded terminal to reach its size.
    waiting: Option<(Size, Vec<u8>, i64)>,
}

pub struct Pane {
    pty: String,
    root: View,
    failure: Text,
    /// The embedded terminal until the connection fails or closes.
    view: RefCell<Option<TerminalView>>,
    shown: TerminalView,
    socket: RefCell<Option<mpsc::Sender<Vec<u8>>>>,
    state: RefCell<State>,
    disposed: Cell<bool>,
    attachment: String,
    theme: Vec<u8>,
    tui: Weak<Tui>,
}

impl Pane {
    pub fn new(tui: &Tui, pty: &str) -> Rc<Self> {
        let app = &tui.app;
        let page = tui.page();
        let background = page.background.raised.base;
        let mode = tui.theme.borrow().mode();
        let view = TerminalView::new(app)
            .mouse_pointer(MousePointer::DEFAULT)
            .absolute()
            .position(Edge::Left, 1)
            .position(Edge::Top, 0)
            .width(80)
            .height(24)
            .transparent_background(background.a == 0);
        let failure = Text::new(app, "").fg(page.text.feedback.error.base).visible(false);
        let root = View::new(app)
            .grow(1.0)
            .basis(Length::Auto)
            .min_width(0)
            .min_height(0)
            .overflow(Overflow::Hidden)
            .bg(background)
            .child(&view)
            .child(&failure);
        let pane = Rc::new(Self {
            pty: pty.to_owned(),
            root,
            failure,
            view: RefCell::new(Some(view.clone())),
            shown: view,
            socket: RefCell::default(),
            state: RefCell::new(State { terminal_size: Some(Size { cols: 80, rows: 24 }), ..State::default() }),
            disposed: Cell::new(false),
            attachment: opencode_local::id::v4(),
            theme: super::palette::osc(&page, mode, background),
            tui: tui.weak(),
        });
        pane.apply_theme();
        pane.wire();
        tui.terminals.attach_writer(pty, Rc::new(bind!(pane, |pane, data: &[u8]| pane.send_input(data.to_vec()))));
        pane.connect(tui);
        pane
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn pty(&self) -> &str {
        &self.pty
    }

    /// The embedded terminal while it is connected and has focus.
    pub fn focused(&self) -> Option<TerminalView> {
        self.view.borrow().clone().filter(|view| view.is_focused())
    }

    /// `onFocusRequest`: focuses the terminal and claims control.
    pub fn focus(&self) {
        let view = self.view.borrow().clone();
        if let Some(view) = view {
            view.focus();
            self.interact();
        }
    }

    /// The key the capture handler took while the terminal has focus.
    pub fn key(&self, view: &TerminalView, key: &KeyEvent) {
        let bytes = view.encode_key(key);
        if bytes.is_empty() {
            return;
        }
        view.scroll_to_bottom();
        self.send_input(bytes);
    }

    /// Stops the connection; the pane is leaving the frame.
    pub fn dispose(&self) {
        self.disposed.set(true);
        self.socket.borrow_mut().take();
        self.state.borrow_mut().waiting = None;
        if let Some(tui) = self.tui.upgrade() {
            tui.terminals.detach_writer(&self.pty);
        }
    }

    fn wire(self: &Rc<Self>) {
        let weak = Rc::downgrade(self);
        self.shown.on_data(move |_, data, source| {
            if let (Some(pane), TerminalData::Input) = (weak.upgrade(), source) {
                pane.send_input(data.to_vec());
            }
        });
        let weak = Rc::downgrade(self);
        self.shown.on_terminal_resize(bind!(weak, |pane, _, cols, rows| {
            pane.state.borrow_mut().terminal_size = Some(Size { cols, rows });
            pane.resume();
            pane.process();
        }));
        let weak = Rc::downgrade(self);
        self.shown.on_focus(move |_, focused| {
            if let (Some(pane), true) = (weak.upgrade(), focused)
                && let Some(tui) = pane.tui.upgrade()
            {
                crate::frame::right_focused(&tui);
            }
        });
        let weak = Rc::downgrade(self);
        self.root.on_resize(bind!(weak, |pane, _, rect| {
            let size = Size { cols: (rect.width as u16).saturating_sub(2).max(1), rows: rect.height as u16 };
            let claim = {
                let mut state = pane.state.borrow_mut();
                state.size = Some(size);
                state.controller && state.restored
            };
            if claim {
                pane.interact();
            }
        }));
        // TS composes this with the terminal's own focus handler the same way: a press anywhere claims control.
        let weak = Rc::downgrade(self);
        self.root.on_mouse(move |_, event| {
            if let (Some(pane), MouseEventKind::Down(_)) = (weak.upgrade(), event.kind) {
                pane.interact();
            }
        });
    }

    fn apply_theme(&self) {
        let view = self.view.borrow().clone();
        if let Some(view) = view {
            view.write(&self.theme);
        }
    }

    fn set_canonical(&self, size: Size) {
        self.state.borrow_mut().canonical = Some(size);
        let view = self.view.borrow().clone();
        if let Some(view) = view {
            view.width(size.cols).height(size.rows);
        }
    }

    fn send(&self, frame: Vec<u8>) {
        if !self.state.borrow().attached {
            return;
        }
        if let Some(socket) = self.socket.borrow().as_ref()
            && socket.try_send(frame).is_err()
        {
            log::warn!("terminal input dropped: the socket queue is full or closed");
        }
    }

    /// A size-only frame: claims control at the box's size. Before the replay ends it only remembers the wish.
    pub fn interact(&self) {
        let size = {
            let mut state = self.state.borrow_mut();
            if !state.restored {
                state.wants_control = true;
                return;
            }
            state.size
        };
        if let Some(size) = size {
            self.send(pty::frame(size, None));
        }
    }

    fn send_input(&self, data: Vec<u8>) {
        let size = {
            let mut state = self.state.borrow_mut();
            if !state.restored {
                state.pending_input.push(data);
                return;
            }
            state.size
        };
        if let Some(size) = size {
            self.send(pty::frame(size, Some(&data)));
        }
    }

    fn enqueue(&self, item: Item) {
        self.state.borrow_mut().stream.push_back(item);
        self.process();
    }

    /// Writes queued output while the embedded terminal is at the server's size.
    fn process(&self) {
        let Some(view) = self.view.borrow().clone() else {
            return;
        };
        if self.disposed.get() {
            return;
        }
        loop {
            let item = {
                let mut state = self.state.borrow_mut();
                if state.canonical.is_none() || state.canonical != state.terminal_size {
                    return;
                }
                let Some(item) = state.stream.pop_front() else {
                    return;
                };
                if let Item::Output(first) = item {
                    let mut output = first;
                    while let Some(Item::Output(_)) = state.stream.front() {
                        if let Some(Item::Output(next)) = state.stream.pop_front() {
                            output.extend(next);
                        }
                    }
                    Item::Output(output)
                } else {
                    item
                }
            };
            match item {
                Item::Output(output) => {
                    view.write(&output);
                }
                Item::Resize { size, checkpoint } => {
                    self.set_canonical(size);
                    let mut state = self.state.borrow_mut();
                    if state.canonical != state.terminal_size {
                        state.stream.push_front(Item::Resize { size, checkpoint });
                        return;
                    }
                    drop(state);
                    if let Some(checkpoint) = checkpoint {
                        view.write([b"\x1bc".as_slice(), &checkpoint].concat());
                        self.apply_theme();
                    }
                }
                Item::Ready => {
                    let (input, claim) = {
                        let mut state = self.state.borrow_mut();
                        state.restored = true;
                        let input = std::mem::take(&mut state.pending_input);
                        let claim = input.is_empty() && (state.controller || state.wants_control);
                        state.wants_control = false;
                        (input, claim)
                    };
                    input.into_iter().for_each(|data| self.send_input(data));
                    if claim {
                        self.interact();
                    }
                }
            }
        }
    }

    fn connect(self: &Rc<Self>, tui: &Tui) {
        let client = tui.data.client().clone();
        let input = ExperimentalPersistentPtySnapshotInput { pty_id: PtyID(self.pty.clone()) };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move { client.experimental_persistent_pty_snapshot(&input, &RequestOptions::default()).await },
            move |_, result| {
                let Some(pane) = weak.upgrade().filter(|pane| !pane.disposed.get()) else {
                    return;
                };
                let snapshot = match result {
                    Ok(snapshot) => snapshot,
                    Err(error) => return pane.fail(&error.to_string()),
                };
                let size = Size { cols: snapshot.info.size.cols as u16, rows: snapshot.info.size.rows as u16 };
                let checkpoint =
                    base64::engine::general_purpose::STANDARD.decode(&snapshot.checkpoint).unwrap_or_default();
                pane.set_canonical(size);
                pane.state.borrow_mut().waiting = Some((size, checkpoint, snapshot.info.output.tail));
                pane.resume();
            },
        );
    }

    /// Goes on with the snapshot once the embedded terminal has its size.
    fn resume(self: &Rc<Self>) {
        let ready = {
            let mut state = self.state.borrow_mut();
            match &state.waiting {
                Some((size, ..)) if Some(*size) == state.terminal_size => state.waiting.take(),
                _ => None,
            }
        };
        let Some((_, checkpoint, cursor)) = ready else {
            return;
        };
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let view = self.view.borrow().clone();
        if let Some(view) = view {
            view.write(&checkpoint);
        }
        self.apply_theme();
        let client = tui.data.client().clone();
        let connector = tui.terminals.connector();
        let input = ConnectInput {
            pty_id: PtyID(self.pty.clone()),
            cursor,
            attachment_id: self.attachment.clone(),
            takeover: true,
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(async move { pty::connect(&client, connector.as_ref(), &input).await }, move |cx, result| {
            let Some(pane) = weak.upgrade().filter(|pane| !pane.disposed.get()) else {
                return;
            };
            match result {
                Ok((_, socket)) => {
                    *pane.socket.borrow_mut() = Some(socket.outgoing);
                    pane.receive(cx.app(), socket.incoming);
                }
                Err(error) => pane.fail(&error.to_string()),
            }
        });
    }

    /// Reads the socket on the UI thread, one wake per batch of messages.
    fn receive(self: &Rc<Self>, app: &App, mut incoming: mpsc::Receiver<Incoming>) {
        let weak = Rc::downgrade(self);
        app.spawn(
            async move {
                let first = incoming.recv().await;
                (incoming, first)
            },
            move |cx, (mut incoming, first)| {
                let Some(pane) = weak.upgrade().filter(|pane| !pane.disposed.get()) else {
                    return;
                };
                let mut items = vec![first.unwrap_or(Incoming::Closed)];
                while let Ok(item) = incoming.try_recv() {
                    items.push(item);
                }
                for item in items {
                    if !pane.handle(item) {
                        return;
                    }
                }
                pane.receive(cx.app(), incoming);
            },
        );
    }

    /// Handles one message; returns whether the socket is still open.
    fn handle(&self, item: Incoming) -> bool {
        let text = match item {
            Incoming::Binary(data) => {
                self.enqueue(Item::Output(data));
                return true;
            }
            Incoming::Text(text) => text,
            Incoming::Closed => {
                let exited = self.state.borrow().exited;
                // The removal event arrives separately; keep the terminal visible until then.
                self.disconnect((!exited).then_some("Terminal disconnected"));
                return false;
            }
            Incoming::Failed(_) => {
                self.disconnect(Some("Terminal connection failed"));
                return false;
            }
        };
        let Some(message) = pty::decode(&text) else {
            return true;
        };
        match message {
            Message::Exited { .. } => self.state.borrow_mut().exited = true,
            Message::Resized { size, checkpoint } => self.enqueue(Item::Resize {
                size,
                checkpoint: Some(base64::engine::general_purpose::STANDARD.decode(checkpoint).unwrap_or_default()),
            }),
            Message::ReplayComplete => self.enqueue(Item::Ready),
            Message::ControllerChanged { attachment_id } => {
                let claim = {
                    let mut state = self.state.borrow_mut();
                    let previous = state.controller;
                    state.controller = attachment_id.flatten().as_deref() == Some(self.attachment.as_str());
                    state.controller && !previous && state.restored
                };
                if claim {
                    self.interact();
                }
            }
            Message::Attached { input_protocol, size, role } => {
                if input_protocol != Some(1.0) {
                    self.fail("Persistent terminal server is out of date; restart OpenCode");
                    self.socket.borrow_mut().take();
                    return false;
                }
                self.enqueue(Item::Resize { size, checkpoint: None });
                let mut state = self.state.borrow_mut();
                state.controller = role == Some(Role::Controller);
                state.attached = true;
            }
            Message::TitleChanged { .. } | Message::ForegroundProcessChanged { .. } => {}
        }
        true
    }

    /// The socket ended: the terminal stops taking input, and focus goes back to the session if it was here.
    fn disconnect(&self, failure: Option<&str>) {
        let focused = self.focused().is_some();
        self.view.borrow_mut().take();
        self.socket.borrow_mut().take();
        if let Some(failure) = failure {
            self.fail(failure);
        }
        if focused && let Some(tui) = self.tui.upgrade() {
            tui.terminals.disconnected(&tui);
        }
    }

    fn fail(&self, message: &str) {
        self.shown.visible(false);
        self.failure.set_text(message);
        self.failure.visible(true);
        if let Some(tui) = self.tui.upgrade() {
            tui.app.request_redraw();
        }
    }
}
