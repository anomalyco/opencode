//! Toasts (U.3): `packages/tui/src/ui/toast.tsx`, plus the theme error toast of
//! `component/theme-error-toast.tsx`.
//!
//! [`Toasts`] is the `ToastProvider` and the `<Toast />` view together: one toast at a time in the top right
//! corner, a queue behind it, a timer that dismisses it, pause while hovered, and an optional action.

use crate::theme::{Theme, ThemeError};
use opentui::prelude::*;
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

pub const DEFAULT_DURATION: Duration = Duration::from_millis(5000);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Variant {
    #[default]
    Info,
    Success,
    Warning,
    Error,
}

/// A toast's action: `› label`, run when the toast is clicked.
#[derive(Clone)]
pub struct ToastAction {
    pub label: String,
    pub run: Rc<dyn Fn()>,
}

/// `ToastOptions`; `duration` is [`DEFAULT_DURATION`] unless set.
#[derive(Clone, Default)]
pub struct ToastOptions {
    pub title: Option<String>,
    pub message: String,
    pub variant: Variant,
    pub duration: Option<Duration>,
    pub action: Option<ToastAction>,
}

impl ToastOptions {
    pub fn new(variant: Variant, message: impl Into<String>) -> Self {
        Self { variant, message: message.into(), ..Self::default() }
    }

    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn duration(mut self, duration: Duration) -> Self {
        self.duration = Some(duration);
        self
    }

    pub fn action(mut self, label: impl Into<String>, run: impl Fn() + 'static) -> Self {
        self.action = Some(ToastAction { label: label.into(), run: Rc::new(run) });
        self
    }

    fn length(&self) -> Duration {
        self.duration.unwrap_or(DEFAULT_DURATION)
    }
}

struct Inner {
    app: App,
    theme: RefCell<Theme>,
    parent: View,
    surface: RefCell<Option<View>>,
    current: RefCell<Option<ToastOptions>>,
    queue: RefCell<VecDeque<ToastOptions>>,
    timer: Cell<Option<TimerId>>,
    started: Cell<Instant>,
    remaining: Cell<Duration>,
    paused: Cell<bool>,
    hovered: Cell<bool>,
}

/// The toast queue and its view. Cloning is cheap.
#[derive(Clone)]
pub struct Toasts(Rc<Inner>);

impl Toasts {
    /// Creates the toasts. A toast floats over the top right of `parent`; the TUI uses the app's main box, which
    /// sits beneath the dialog host.
    pub fn new(app: &App, theme: Theme, parent: &View) -> Self {
        Self(Rc::new(Inner {
            app: app.clone(),
            theme: RefCell::new(theme),
            parent: parent.clone(),
            surface: RefCell::new(None),
            current: RefCell::new(None),
            queue: RefCell::new(VecDeque::new()),
            timer: Cell::new(None),
            started: Cell::new(app.now()),
            remaining: Cell::new(Duration::ZERO),
            paused: Cell::new(false),
            hovered: Cell::new(false),
        }))
    }

    pub fn set_theme(&self, theme: Theme) {
        *self.0.theme.borrow_mut() = theme;
        self.paint();
    }

    /// Shows a toast now, or queues it while one is paused or others wait.
    pub fn show(&self, options: ToastOptions) {
        let busy = self.0.current.borrow().is_some() && (self.0.paused.get() || !self.0.queue.borrow().is_empty());
        if busy {
            self.0.queue.borrow_mut().push_back(options);
            self.paint();
            return;
        }
        let duration = options.length();
        *self.0.current.borrow_mut() = Some(options);
        self.start(duration);
        self.paint();
    }

    /// `toast.error`: an error toast with the message.
    pub fn error(&self, message: impl Into<String>) {
        self.show(ToastOptions::new(Variant::Error, message));
    }

    /// The theme error toast: `Failed to load theme: {name}`.
    pub fn theme_error(&self, error: ThemeError) {
        self.show(
            ToastOptions::new(Variant::Error, error.message).title(format!("Failed to load theme: {}", error.name)),
        );
    }

    /// Hides the current toast and shows the next queued one.
    pub fn dismiss(&self) {
        self.clear_timer();
        let next = self.0.queue.borrow_mut().pop_front();
        let duration = next.as_ref().map(ToastOptions::length);
        *self.0.current.borrow_mut() = next;
        match duration {
            None => self.0.paused.set(false),
            Some(duration) => {
                self.0.remaining.set(duration);
                if !self.0.paused.get() {
                    self.start(duration);
                }
            }
        }
        self.paint();
    }

    /// Stops the timer, keeping the time left.
    pub fn pause(&self) {
        if self.0.current.borrow().is_none() || self.0.paused.get() {
            return;
        }
        self.0.paused.set(true);
        let elapsed = self.0.app.now().saturating_duration_since(self.0.started.get());
        self.0.remaining.set(self.0.remaining.get().saturating_sub(elapsed));
        self.clear_timer();
    }

    pub fn resume(&self) {
        if self.0.current.borrow().is_none() || !self.0.paused.get() {
            return;
        }
        self.0.paused.set(false);
        self.start(self.0.remaining.get());
    }

    /// Dismisses the toast and runs its action, as a click does.
    pub fn activate(&self) {
        let action = self.0.current.borrow().as_ref().and_then(|toast| toast.action.clone());
        self.dismiss();
        if let Some(action) = action {
            (action.run)();
        }
    }

    pub fn current(&self) -> Option<ToastOptions> {
        self.0.current.borrow().clone()
    }

    /// How many toasts wait behind the current one.
    pub fn pending(&self) -> usize {
        self.0.queue.borrow().len()
    }

    fn start(&self, duration: Duration) {
        self.clear_timer();
        self.0.remaining.set(duration);
        self.0.started.set(self.0.app.now());
        let weak = Rc::downgrade(&self.0);
        let timer = self.0.app.set_timeout(duration, move |_cx| {
            if let Some(inner) = weak.upgrade() {
                inner.timer.set(None);
                Toasts(inner).dismiss();
            }
        });
        self.0.timer.set(Some(timer));
    }

    fn clear_timer(&self) {
        if let Some(timer) = self.0.timer.take() {
            self.0.app.cancel_timer(timer);
        }
    }

    fn paint(&self) {
        if let Some(old) = self.0.surface.borrow_mut().take() {
            old.detach();
        }
        let current = self.0.current.borrow().clone();
        let Some(toast) = current else { return };
        let surface = surface(self, &toast, self.pending());
        self.0.parent.add(&surface);
        *self.0.surface.borrow_mut() = Some(surface);
    }
}

// `ToastSurface`.
fn surface(toasts: &Toasts, toast: &ToastOptions, pending: usize) -> View {
    let app = &toasts.0.app;
    let theme = toasts.0.theme.borrow().clone();
    let hovered = toasts.0.hovered.get();
    let width = app.size().0;
    let feedback = &theme.text.feedback;
    let border = match toast.variant {
        Variant::Info => feedback.info.base,
        Variant::Success => feedback.success.base,
        Variant::Warning => feedback.warning.base,
        Variant::Error => feedback.error.base,
    };
    let affordance = Text::new(
        app,
        match &toast.action {
            Some(action) => format!("› {}", action.label),
            None => "x".to_owned(),
        },
    )
    .shrink(0.0)
    .margin_edge(Edge::Left, 2)
    .wrap(WrapMode::None);
    let has_action = toast.action.is_some();
    let restyle = move |affordance: &Text, theme: &Theme, hovered: bool| {
        affordance
            .fg(if hovered { theme.text.action.primary.base } else { theme.text.muted })
            .attributes(if hovered && has_action { Attributes::BOLD } else { Attributes::NONE });
    };
    restyle(&affordance, &theme, hovered);
    let body = View::new(app).width(Length::percent(100.0)).padding_x(2).padding_y(1).bg(theme.background.raised.high);
    match &toast.title {
        None => {
            body.add(
                &View::new(app)
                    .row()
                    .width(Length::percent(100.0))
                    .child(
                        &Text::new(app, toast.message.as_str())
                            .fg(theme.text.base)
                            .wrap(WrapMode::Word)
                            .grow(1.0)
                            .basis(Length::Auto),
                    )
                    .child(&affordance),
            );
        }
        Some(title) => {
            body.add(
                &View::new(app)
                    .row()
                    .width(Length::percent(100.0))
                    .margin_edge(Edge::Bottom, 1)
                    .child(&Text::new(app, title.as_str()).bold().fg(theme.text.base))
                    .child(&View::new(app).grow(1.0).basis(Length::Auto))
                    .child(&affordance),
            );
            body.add(
                &Text::new(app, toast.message.as_str())
                    .fg(theme.text.base)
                    .wrap(WrapMode::Word)
                    .width(Length::percent(100.0)),
            );
        }
    }
    if pending > 0 {
        body.add(&Text::new(app, format!("+{pending} more")).fg(theme.text.muted).margin_edge(Edge::Top, 1));
    }
    let surface = View::new(app)
        .absolute()
        .position(Edge::Top, 1)
        .position(Edge::Right, 2)
        .max_width(60.min(i32::from(width) - 6))
        .justify(Justify::Center)
        .align_items(Align::Start)
        .border(BorderStyle::Heavy)
        .border_sides(Sides::LEFT | Sides::RIGHT)
        .border_color(border)
        .child(&body);
    let weak: Weak<Inner> = Rc::downgrade(&toasts.0);
    // Restyled in place: a new surface would drop a text selection that a press on the toast has started.
    surface.on_hover(move |_cx, over| {
        let Some(inner) = weak.upgrade() else { return };
        inner.hovered.set(over);
        restyle(&affordance, &inner.theme.borrow(), over);
        let toasts = Toasts(inner);
        if over {
            toasts.pause();
        } else {
            toasts.resume();
        }
    });
    let weak: Weak<Inner> = Rc::downgrade(&toasts.0);
    surface.mouse_pointer(MousePointer::POINTER).on_mouse(move |_cx, event| {
        if !matches!(event.kind, MouseEventKind::Up(_)) {
            return;
        }
        let Some(inner) = weak.upgrade() else { return };
        if inner.app.selected_text().is_some_and(|text| !text.is_empty()) {
            return;
        }
        let app = inner.app.clone();
        let toasts = Toasts(inner);
        app.defer(move |_cx| toasts.activate());
    });
    surface
}
